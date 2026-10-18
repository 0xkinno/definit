"""The v1 decision gate.

What matters here is what the gate emits and what it refuses to do. Release
authority is a message the adjudicating transaction emits on the finalized
stage, so these tests assert the stage, the target, the method and every
argument, and recompute the hashes independently of the contract.
"""

import json
from pathlib import Path

import pytest

from v1.harness import (
    contract_path,
    AGENT, AMOUNT, APPROVE_JSON, DEADLINE, EVIDENCE_TEXT, EVIDENCE_URL, FUNDER, GateScenario, LATE, NOW,
    POLICY_HASH, POLICY_ID, RECIPIENT, REJECT_JSON, RevertedWith, VAULT_ADDR, evidence_digest_of, intent_hash,
    keccak_hex, iso, golden,
)

GATE = "contracts/v1/decision_gate.py"
VECTOR = Path(__file__).resolve().parents[3] / "docs" / "evidence" / "milestone" / "gate-emission-vector.json"


def record_vector(g, message):
    """Write what the gate actually emitted, with every input it was given, so
    scripts/verify-offline.mjs can recompute each hash with the TypeScript
    module and compare. The Python contract and the TypeScript mirror are two
    independent implementations of one encoding."""
    VECTOR.parent.mkdir(parents=True, exist_ok=True)
    action = g.gate.get_action(g.action_id)
    VECTOR.write_text(
        json.dumps(
            {
                "about": "The message the v1 gate emitted in direct mode, with its inputs. Recomputed offline by scripts/verify-offline.mjs.",
                "inputs": {
                    "agent": AGENT, "recipient": RECIPIENT, "amount": AMOUNT, "asset": "GEN", "policy_hash": POLICY_HASH,
                    "nonce": 7, "deadline_unix": DEADLINE, "created_at": NOW, "adjudicated_at": NOW,
                    "evidence_text": EVIDENCE_TEXT, "attempt": 1,
                },
                "emitted": {"stage": message.stage, "target": message.target, "method": message.method, "args": message.args},
                "recorded_action": {"intent_hash": action["intent_hash"], "evidence_digest": action["evidence_digest"], "decision_id": action["decision_id"]},
            },
            indent=2,
        ),
        encoding="utf-8",
    )


@pytest.fixture
def g(direct_vm, direct_deploy, repo_root):
    return GateScenario(direct_vm, direct_deploy, contract_path(repo_root, GATE))


@pytest.fixture
def ready(g):
    g.create()
    g.mock_evidence()
    return g


def refused(code, fn, *args, **kwargs):
    with pytest.raises(RevertedWith) as r:
        fn(*args, **kwargs)
    assert r.value.code == code, f"expected {code}, the contract said {r.value.code}"


# ------------------------------------------------------------ create_action


def test_an_action_is_registered_with_its_commitment_fields(g):
    action_id = g.create()
    action = g.gate.get_action(action_id)
    assert action["exists"] is True
    assert action["state"] == "SUBMITTED"
    assert action["agent"] == AGENT
    assert action["recipient"] == RECIPIENT
    assert action["amount"] == AMOUNT
    assert action["policy_hash"] == POLICY_HASH
    assert action["deadline_unix"] == DEADLINE
    assert action["intent_hash"] == ""  # not derivable until the evidence has been seen
    assert action["attempts"] == 0
    assert g.gate.describe()["total_actions"] == 1


@pytest.mark.parametrize(
    "code,override",
    [
        ("BAD_AMOUNT", {"amount": 0}),
        ("BAD_ASSET", {"asset": ""}),
        ("BAD_EVIDENCE_URL", {"evidence_url": "http://example.invalid/e.txt"}),
        ("BAD_DEADLINE", {"deadline_unix": 1}),
        ("BAD_NONCE", {"nonce": 0}),
        ("BAD_RECIPIENT", {"recipient": "not-an-address"}),
        ("POLICY_UNKNOWN", {"policy_id": "no-such-policy"}),
    ],
)
def test_a_malformed_action_is_refused_with_a_named_code(g, code, override):
    refused(code, g.create, **override)
    assert g.gate.describe()["total_actions"] == 0


def test_the_actions_of_one_agent_are_listed(g):
    first = g.create(nonce=1)
    second = g.create(nonce=2)
    listed = g.gate.list_actions_for(AGENT)
    assert [a["action_id"] for a in listed] == [first, second]
    assert g.gate.list_actions_for("0x" + "00" * 20) == []


def test_an_unknown_action_reads_as_an_explicit_absence(g):
    absent = g.gate.get_action("nothing")
    assert absent["exists"] is False
    assert absent["reason_code"] == "ACTION_UNKNOWN"
    assert g.gate.get_decision("nothing")["exists"] is False


# ------------------------------------------------------------ guards on request_adjudication


def test_an_unknown_action_cannot_be_adjudicated(ready):
    refused("ACTION_UNKNOWN", ready.adjudicate, action_id="0x" + "00" * 32)


@pytest.mark.parametrize("who", ["stranger", "recipient", "owner"])
def test_only_the_actions_agent_can_request_adjudication(ready, who):
    refused("NOT_AUTHORIZED", ready.adjudicate, who)
    assert ready.messages() == []


def test_an_expired_action_is_not_adjudicated(ready):
    ready.world.set_time(LATE)
    refused("EXPIRED", ready.adjudicate)
    assert ready.messages() == []


def test_the_escrow_must_exist_before_adjudication(ready):
    """A finalized delivery to an escrow that does not exist cannot be retried,
    so the gate refuses to produce a verdict that could never be acted on."""
    ready.fund_state(None)
    refused("ESCROW_NOT_FUNDED", ready.adjudicate)
    assert ready.messages() == []
    assert ready.gate.get_action(ready.action_id)["state"] == "SUBMITTED"


@pytest.mark.parametrize("state", ["SETTLED", "REFUNDABLE", "EXPIRED_REFUNDABLE", "RECLAIMED", "WITHDRAWN"])
def test_an_escrow_that_is_not_open_blocks_adjudication(ready, state):
    ready.fund_state(state)
    refused("ESCROW_NOT_FUNDED", ready.adjudicate)


def test_an_action_is_adjudicated_once(ready):
    ready.adjudicate()
    refused("BAD_STATE", ready.adjudicate)
    assert len(ready.messages()) == 1  # a second adjudication cannot emit a second message


# ------------------------------------------------------------ APPROVE: one finalized message


def test_an_approval_emits_exactly_one_message_on_the_finalized_stage(ready):
    out = ready.adjudicate()
    assert out["verdict"] == "APPROVE"
    assert out["state"] == "ACCEPTED"
    [message] = ready.messages()
    assert message.stage == "finalized"
    assert message.target == VAULT_ADDR
    assert message.method == "authorize_release"


def test_an_approval_delivers_the_complete_commitment(ready):
    out = ready.adjudicate()
    digest = evidence_digest_of(EVIDENCE_TEXT)
    expected_hash = intent_hash(AGENT, RECIPIENT, AMOUNT, "GEN", POLICY_HASH, digest, 7, DEADLINE)
    [message] = ready.messages()
    action_id, decision_id, delivered_hash, delivered_digest, policy_hash, nonce, recipient, amount = message.args
    assert action_id == ready.action_id
    assert decision_id == out["decision_id"]
    assert delivered_hash == expected_hash == out["intent_hash"]
    assert delivered_digest == digest == out["evidence_digest"]
    assert policy_hash == POLICY_HASH
    assert nonce == 7
    assert recipient == RECIPIENT
    assert amount == AMOUNT


def test_the_gates_message_is_exactly_the_golden_message(ready):
    """Composition with the vault: the vault suite delivers this same vector and
    expects a release, so what the gate emits is what the vault accepts."""
    ready.adjudicate()
    [message] = ready.messages()
    assert ready.action_id == golden()["action_id"]
    assert message.args == golden()["args"]
    record_vector(ready, message)


def test_the_commitment_encoding_is_byte_identical_to_v0(ready):
    """The v0 encoding is restated here and in the TypeScript mirror. The gate's
    hash must equal an independent computation, so v0 receipts still verify."""
    ready.adjudicate()
    digest = evidence_digest_of(EVIDENCE_TEXT)
    payload = "|".join(
        (
            "DEFINIT-COMMITMENT-v1",
            "agent=" + AGENT,
            "recipient=" + RECIPIENT,
            "amount=" + str(AMOUNT),
            "asset=GEN",
            "policy_hash=" + POLICY_HASH,
            "evidence_digest=" + digest,
            "nonce=7",
            "deadline=" + str(DEADLINE),
        )
    )
    assert ready.gate.get_action(ready.action_id)["intent_hash"] == keccak_hex(payload)


def test_the_decision_id_uses_the_v1_domain(ready):
    """A v0 and a v1 decision id can never collide."""
    out = ready.adjudicate()
    expected = keccak_hex(
        "|".join(("DEFINIT-DECISION-v2", "action=" + ready.action_id, "attempt=1", "intent_hash=" + out["intent_hash"], "adjudicated_at=" + NOW))
    )
    assert out["decision_id"] == expected
    v0 = keccak_hex(
        "|".join(("DEFINIT-DECISION-v1", "action=" + ready.action_id, "attempt=1", "intent_hash=" + out["intent_hash"], "adjudicated_at=" + NOW))
    )
    assert out["decision_id"] != v0


def test_the_decision_is_recorded(ready):
    out = ready.adjudicate()
    decision = ready.gate.get_decision(out["decision_id"])
    assert decision["exists"] is True
    assert decision["verdict"] == "APPROVE"
    assert decision["reason_code"] == "EVIDENCE_SATISFIES_POLICY"
    assert decision["confidence"] == 93
    assert decision["attempt"] == 1
    assert decision["intent_hash"] == out["intent_hash"]
    assert ready.gate.get_action(ready.action_id)["decision_id"] == out["decision_id"]


def test_the_adjudication_message_carries_no_value(ready):
    ready.adjudicate()
    assert all(m.value == 0 for m in ready.messages())


# ------------------------------------------------------------ REJECT: a different method


def test_a_rejection_emits_exactly_one_close_refused_message(g):
    g.create()
    g.mock_evidence(verdict_json=REJECT_JSON)
    out = g.adjudicate()
    assert out["verdict"] == "REJECT"
    assert out["state"] == "REJECTED"
    [message] = g.messages()
    assert message.stage == "finalized"
    assert message.target == VAULT_ADDR
    assert message.method == "close_refused"
    action_id, decision_id, reason = message.args
    assert action_id == g.action_id
    assert decision_id == out["decision_id"]
    assert reason == "EVIDENCE_MISSING"


def test_the_two_outcomes_target_different_vault_methods(g):
    """Measured: two messages to the same method collide in the fee allocation
    (AllocationDuplicateKey), so each branch must emit one message of its own kind."""
    g.create(nonce=1)
    g.mock_evidence()
    g.adjudicate()
    first = g.messages()[0].method
    g.create(nonce=2)
    g.mock_evidence(verdict_json=REJECT_JSON)
    g.adjudicate()
    second = g.messages()[1].method
    assert {first, second} == {"authorize_release", "close_refused"}


def test_an_unreachable_source_is_a_rejection_with_its_own_reason(g):
    g.create()
    g.mock_evidence(text="")
    out = g.adjudicate()
    assert out["verdict"] == "REJECT"
    assert out["reason_code"] == "SOURCE_UNAVAILABLE"
    [message] = g.messages()
    assert message.method == "close_refused"
    assert message.args[2] == "SOURCE_UNAVAILABLE"
    assert out["evidence_digest"] == evidence_digest_of("")


def test_an_unrecognised_model_answer_defaults_to_a_rejection(g):
    g.create()
    g.mock_evidence(verdict_json='{"verdict": "MAYBE", "reason_code": "WHATEVER", "confidence": 500}')
    out = g.adjudicate()
    assert out["verdict"] == "REJECT"
    assert out["reason_code"] == "INVALID_REQUEST"
    assert out["confidence"] == 100  # clamped
    assert g.messages()[0].method == "close_refused"


# ------------------------------------------------------------ no promotion, no clock


def test_there_is_no_promotion_step(g):
    """C4. v0 needed a second, agent-driven transaction to promote a decision.
    In v1 the adjudicating transaction schedules the release itself."""
    names = [n for n in dir(g.gate) if not n.startswith("_")]
    for removed in ("finalize_decision", "get_capability", "mark_settled"):
        assert removed not in names


def test_describe_states_the_rule_and_has_no_window(g):
    d = g.gate.describe()
    assert d["finality_rule"] == "protocol-finalized-delivery"
    assert d["settlement_message_stage"] == "finalized"
    assert d["clock"] == "none"
    assert d["decision_domain"] == "DEFINIT-DECISION-v2"
    assert "appeal_window_seconds" not in d


# ------------------------------------------------------------ mark_held


def test_an_agent_can_hold_an_action_before_adjudication(g):
    g.create()
    out = g.call("funder", "mark_held", g.action_id, "changed my mind")
    assert out["state"] == "HELD"
    assert g.gate.get_action(g.action_id)["state"] == "HELD"


def test_a_held_action_cannot_be_adjudicated(g):
    g.create()
    g.call("funder", "mark_held", g.action_id, "x")
    g.mock_evidence()
    refused("BAD_STATE", g.adjudicate)


def test_an_action_cannot_be_held_after_adjudication(ready):
    """A finalized message is already scheduled, and a HELD label would misdescribe it."""
    ready.adjudicate()
    refused("BAD_STATE", ready.call, "funder", "mark_held", ready.action_id, "late")


@pytest.mark.parametrize("who", ["stranger", "recipient", "owner"])
def test_only_the_agent_can_hold_an_action(g, who):
    g.create()
    refused("NOT_AUTHORIZED", g.call, who, "mark_held", g.action_id, "x")
