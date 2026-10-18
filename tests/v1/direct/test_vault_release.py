"""The release path of the v1 vault.

Release authority is a delivery: the only way value can leave toward the
recipient is `authorize_release`, called with the bound gate as sender. These
tests drive that method directly, so every guard on it is reachable offline.
(In v0 the decisive guard was a cross-contract read, which this runner cannot
execute; that is the point of moving authority onto calldata.)

Each test changes exactly one thing, so a failure names the guard that stopped
holding.
"""

import pytest

from v1.harness import (
    contract_path,
    AMOUNT, DEADLINE, EVIDENCE_DIGEST, FUNDER, GATE, LATE, NOW, OWNER, POLICY_HASH, RECIPIENT, STRANGER,
    RevertedWith, Scenario, golden, intent_hash, iso,
)

VAULT = "contracts/v1/finality_vault.py"


@pytest.fixture
def s(direct_vm, direct_deploy, repo_root):
    return Scenario(direct_vm, direct_deploy, contract_path(repo_root, VAULT)).ready()


# ------------------------------------------------------- I1: only the gate


def test_the_gate_can_release(s):
    out = s.deliver_release()
    assert out["status"] == "SETTLED"
    assert s.state() == "SETTLED"
    assert s.transferred_to("recipient") == AMOUNT


@pytest.mark.parametrize("who", ["stranger", "funder", "recipient", "owner"])
def test_nobody_but_the_gate_can_release(s, who):
    """I1. An EOA with a perfectly formed payload is refused. This includes the
    funder, which is the v0 defect C2: the funder could trigger a release."""
    with pytest.raises(RevertedWith) as refused:
        s.deliver_release(who)
    assert refused.value.code == "UNAUTHORIZED_SENDER"
    assert s.state() == "OPEN"
    assert s.transfers() == []


def test_the_sender_is_checked_before_anything_is_read(s):
    """A non-gate sender naming an unknown escrow still gets the sender refusal,
    so a stranger cannot probe which escrows exist."""
    with pytest.raises(RevertedWith) as refused:
        s.call("stranger", "authorize_release", "no-such", "d", "h", "e", "p", 1, RECIPIENT, 1)
    assert refused.value.code == "UNAUTHORIZED_SENDER"


def test_the_gate_names_an_unknown_escrow(s):
    with pytest.raises(RevertedWith) as refused:
        s.call("gate", "authorize_release", "no-such", "d", "h", "e", "p", 1, RECIPIENT, 1)
    assert refused.value.code == "ESCROW_UNKNOWN"


def test_there_is_no_public_method_that_releases_on_a_callers_request(s):
    """C2, structurally. The only methods that can send value to the recipient
    are the gate-only ones. Every other value-moving method sends it home."""
    abi = [name for name in dir(s.vault) if not name.startswith("_") and callable(getattr(s.vault, name))]
    assert "settle" not in abi
    assert "release" not in abi
    assert "finalize_decision" not in abi


# ------------------------------------------------- I3: the commitment


@pytest.mark.parametrize(
    "field,value",
    [
        ("recipient", "0x" + "66" * 20),
        ("amount", AMOUNT + 1),
        ("policy_hash", "0x" + "00" * 32),
        ("nonce", 8),
    ],
)
def test_one_changed_delivered_field_is_refused(s, field, value):
    """I3. Each delivered field is compared with the escrow's own record."""
    with pytest.raises(RevertedWith) as refused:
        s.deliver_release(**{field: value})
    assert refused.value.code == "COMMITMENT_MISMATCH"
    assert s.state() == "OPEN"
    assert s.transfers() == []


def test_a_forged_intent_hash_is_refused(s):
    """I3. The vault recomputes the commitment itself. A hash the gate did not
    derive from the escrow's fields plus the delivered digest does not pass."""
    with pytest.raises(RevertedWith) as refused:
        s.deliver_release(intent_hash="0x" + "ee" * 32)
    assert refused.value.code == "COMMITMENT_MISMATCH"
    assert s.transfers() == []


def test_a_different_evidence_digest_cannot_reuse_the_hash(s):
    """The hash binds the evidence. A valid hash for one digest fails for another."""
    good_for_other = intent_hash(FUNDER, RECIPIENT, AMOUNT, "GEN", POLICY_HASH, "0x" + "cd" * 32, 7, DEADLINE)
    with pytest.raises(RevertedWith) as refused:
        s.deliver_release(intent_hash=good_for_other)
    assert refused.value.code == "COMMITMENT_MISMATCH"


def test_the_recomputed_commitment_and_the_receipt_agree(s):
    s.deliver_release()
    receipt = s.vault.get_receipt(s.action_id)
    expected = intent_hash(FUNDER, RECIPIENT, AMOUNT, "GEN", POLICY_HASH, EVIDENCE_DIGEST, 7, DEADLINE)
    assert receipt["intent_hash"] == expected
    assert s.escrow()["intent_hash"] == expected


def test_the_receipt_names_protocol_delivery_and_the_delivering_gate(s):
    """The receipt records which finalized decision released it, and that the
    source was a delivery, not a read."""
    s.deliver_release()
    receipt = s.vault.get_receipt(s.action_id)
    assert receipt["exists"] is True
    assert receipt["finality_source"] == "protocol-delivery"
    assert receipt["delivered_by"] == GATE
    assert receipt["message_stage"] == "finalized"
    assert receipt["status"] == "SETTLED"
    assert receipt["decision_id"] == golden()["decision_id"]


# -------------------------------------------- the transfer is on the finalized stage


def test_the_outbound_transfer_is_emitted_on_the_finalized_stage(s):
    s.deliver_release()
    [transfer] = s.transfers()
    assert transfer.stage == "finalized"
    assert transfer.target == RECIPIENT
    assert transfer.value == AMOUNT


def test_state_is_written_before_the_transfer_is_emitted(s):
    """Checks, effects, then interaction: a replay finds the escrow closed."""
    s.deliver_release()
    assert s.state() == "SETTLED"
    assert len(s.transfers()) == 1


# ------------------------------------------------------- I4: once


def test_a_duplicate_delivery_is_a_recorded_noop(s):
    """I4. The second delivery returns NOOP, moves nothing, and is counted."""
    s.deliver_release()
    before = s.describe()
    again = s.deliver_release()
    assert again["status"] == "NOOP"
    assert again["state"] == "SETTLED"
    assert len(s.transfers()) == 1
    assert s.transferred_to("recipient") == AMOUNT
    assert s.describe()["noop_count"] == before["noop_count"] + 1
    assert s.describe()["release_count"] == before["release_count"]


def test_many_duplicate_deliveries_never_make_a_second_transfer(s):
    s.deliver_release()
    for _ in range(5):
        assert s.deliver_release()["status"] == "NOOP"
    assert len(s.transfers()) == 1


# ------------------------------------------------- I7: expiry


def test_a_release_after_the_deadline_does_not_release(s):
    """I7. The late delivery routes the escrow to a refund for the funder."""
    s.world.set_time(LATE)
    out = s.deliver_release()
    assert out["status"] == "EXPIRED"
    assert s.state() == "EXPIRED_REFUNDABLE"
    assert s.transfers() == []


def test_a_release_exactly_at_the_deadline_is_still_a_release(s):
    """The comparison is strictly 'after'. At the deadline the release stands."""
    s.world.set_time(iso(DEADLINE))
    out = s.deliver_release()
    assert out["status"] == "SETTLED"


def test_a_late_escrow_can_be_withdrawn_by_the_funder(s):
    s.world.set_time(LATE)
    s.deliver_release()
    s.call("funder", "withdraw_refund", s.action_id)
    assert s.state() == "WITHDRAWN"
    assert s.transferred_to("funder") == AMOUNT
    assert s.transferred_to("recipient") == 0


# ------------------------------------------------- I10: no false refusal


def test_a_valid_finalized_approval_before_the_deadline_is_always_released(s):
    """I10. A guard that blocks this is an outage, not a guard."""
    for _ in range(3):
        s.world.set_time(NOW)
    assert s.deliver_release()["status"] == "SETTLED"
    assert s.transferred_to("recipient") == AMOUNT


def test_a_release_is_not_blocked_by_a_marker_left_by_a_provisional_notice(s):
    """I10 with I5: a notice (even a contradictory one) must not stop a release."""
    s.deliver_note(verdict="REJECT")
    assert s.deliver_release()["status"] == "SETTLED"


# ---------------------------------------------- composition with the gate


def test_the_gates_golden_message_is_accepted_and_releases(s):
    """The vault accepts exactly the message the gate suite proves the gate emits."""
    out = s.call("gate", "authorize_release", *golden()["args"])
    assert out["status"] == "SETTLED"
    assert s.vault.get_receipt(s.action_id)["decision_id"] == golden()["decision_id"]
    assert s.transferred_to("recipient") == AMOUNT
