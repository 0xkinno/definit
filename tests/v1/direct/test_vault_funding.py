"""Binding the gate and funding an escrow.

`open_escrow` takes the commitment fields from the funder's own arguments and
reads the gate once to confirm they equal the action the gate registered. That
read is a consistency check at funding time. It is never release authority.
"""

import pytest

from v1.harness import (
    contract_path,
    AMOUNT, DEADLINE, FUNDER, GATE, NOW, OWNER, POLICY_HASH, RECIPIENT, STRANGER,
    RevertedWith, Scenario,
)

VAULT = "contracts/v1/finality_vault.py"


@pytest.fixture
def fresh(direct_vm, direct_deploy, repo_root):
    return Scenario(direct_vm, direct_deploy, contract_path(repo_root, VAULT))


@pytest.fixture
def bound(fresh):
    fresh.bind_gate()
    fresh.teach_gate_the_action()
    return fresh


def refused(code, fn, *args, **kwargs):
    with pytest.raises(RevertedWith) as r:
        fn(*args, **kwargs)
    assert r.value.code == code, f"expected {code}, the contract said {r.value.code}"


# ------------------------------------------------------------- set_gate


def test_the_owner_binds_the_gate_once(fresh):
    out = fresh.bind_gate()
    assert out == {"gate": GATE, "state": "BOUND"}
    assert fresh.describe()["gate"] == GATE


@pytest.mark.parametrize("who", ["funder", "stranger", "recipient"])
def test_only_the_owner_can_bind_the_gate(fresh, who):
    refused("NOT_OWNER", fresh.call, who, "set_gate", GATE)
    assert fresh.describe()["gate"] == "0x" + "00" * 20


def test_the_gate_cannot_be_rebound(fresh):
    fresh.bind_gate()
    refused("GATE_ALREADY_SET", fresh.call, "owner", "set_gate", "0x" + "77" * 20)
    assert fresh.describe()["gate"] == GATE


def test_no_escrow_can_be_opened_before_a_gate_is_bound(fresh):
    fresh.teach_gate_the_action()
    refused("GATE_NOT_SET", fresh.fund)


# ------------------------------------------------------------- open_escrow


def test_a_matching_escrow_opens(bound):
    out = bound.fund()
    assert out == {"action_id": bound.action_id, "amount": AMOUNT, "state": "OPEN"}
    escrow = bound.escrow()
    assert escrow["funder"] == FUNDER
    assert escrow["recipient"] == RECIPIENT
    assert escrow["amount"] == AMOUNT
    assert escrow["policy_hash"] == POLICY_HASH
    assert escrow["deadline_unix"] == DEADLINE
    assert escrow["provisional"] == ""
    assert escrow["intent_hash"] == ""  # not known until a delivery carries the evidence digest


def test_the_commitment_fields_come_from_the_funder_not_from_the_gate(bound):
    """The gate is consulted for consistency only. The stored record is the
    funder's own statement, which the gate's action had to equal."""
    bound.fund()
    assert bound.escrow()["funder"] == FUNDER
    assert any(call[1] == "get_action" for call in bound.world.view_calls)


def test_an_escrow_for_the_same_action_cannot_be_opened_twice(bound):
    bound.fund()
    refused("ESCROW_EXISTS", bound.fund)


def test_the_value_sent_must_equal_the_amount(bound):
    refused("BAD_VALUE", bound.fund, value=AMOUNT - 1)
    refused("BAD_VALUE", bound.fund, value=AMOUNT + 1)
    refused("BAD_VALUE", bound.fund, value=0)
    assert bound.escrow()["exists"] is False


def test_a_zero_amount_is_refused(bound):
    refused("BAD_AMOUNT", bound.fund, amount=0, value=0)


def test_a_deadline_in_the_past_is_refused(bound):
    refused("BAD_DEADLINE", bound.fund, deadline_unix=1)


def test_an_action_the_gate_does_not_know_is_refused(bound):
    bound.world.answer(GATE, "get_action", {"exists": False})
    refused("ACTION_MISMATCH", bound.fund)


def test_only_the_actions_own_agent_can_fund_it(bound):
    refused("NOT_FUNDER", bound.fund, who="stranger")
    refused("NOT_FUNDER", bound.fund, who="recipient")


@pytest.mark.parametrize(
    "field,gate_value",
    [
        ("recipient", "0x" + "66" * 20),
        ("amount", AMOUNT + 1),
        ("asset", "OTHER"),
        ("policy_hash", "0x" + "01" * 32),
        ("nonce", 99),
        ("deadline_unix", DEADLINE + 1),
    ],
)
def test_a_field_that_differs_from_the_gates_action_is_refused(bound, field, gate_value):
    """Each commitment field is compared on its own, so the failure names it."""
    key = "deadline_unix" if field == "deadline_unix" else field
    bound.teach_gate_the_action(**{key: gate_value})
    refused("ACTION_MISMATCH", bound.fund)
    assert bound.escrow()["exists"] is False


def test_an_unknown_escrow_reads_as_an_explicit_absence(bound):
    absent = bound.vault.get_escrow("nothing")
    assert absent["exists"] is False
    assert absent["reason_code"] == "ESCROW_UNKNOWN"
    assert bound.vault.get_receipt("nothing")["exists"] is False


def test_describe_states_the_v1_rule(bound):
    d = bound.describe()
    assert d["finality_rule"] == "protocol-finalized-delivery"
    assert d["release_message_stage"] == "finalized"
    assert d["clock"] == "return-to-funder-only"
    # The deployed contract reports its frozen on-chain label; the milestone is named v1.
    assert d["version"] == "v2"
