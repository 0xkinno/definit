"""Provisional notices (I5) and finalized refusals (I6).

A provisional notice may only ever change a display marker. It can be repeated
and contradicted across appeal rounds, so it must be inert: it cannot move value
and it cannot take an escrow out of OPEN. A finalized refusal is the opposite
kind of message: it closes the escrow, and only the funder may take the value
back, and only after it.
"""

import pytest

from v1.harness import contract_path, AMOUNT, FUNDER, RECIPIENT, RevertedWith, Scenario

VAULT = "contracts/v1/finality_vault.py"


@pytest.fixture
def s(direct_vm, direct_deploy, repo_root):
    return Scenario(direct_vm, direct_deploy, contract_path(repo_root, VAULT)).ready()


def refused(code, fn, *args, **kwargs):
    with pytest.raises(RevertedWith) as r:
        fn(*args, **kwargs)
    assert r.value.code == code, f"expected {code}, the contract said {r.value.code}"


def without_marker(escrow):
    return {k: v for k, v in escrow.items() if k not in ("provisional", "provisional_count")}


# ------------------------------------------------------- I5: provisional is inert


def test_a_notice_sets_only_a_display_marker(s):
    before = s.escrow()
    out = s.deliver_note(verdict="APPROVE")
    assert out["status"] == "MARKED"
    after = s.escrow()
    assert after["provisional"] == "PROVISIONAL_APPROVE"
    assert without_marker(after) == without_marker(before)
    assert s.transfers() == []


def test_alternating_verdicts_change_the_marker_and_nothing_else(s):
    """I5, the accepted storm: repeated notices with alternating verdicts."""
    baseline = without_marker(s.escrow())
    for verdict in ["APPROVE", "REJECT"] * 4:
        s.deliver_note(verdict=verdict)
        assert without_marker(s.escrow()) == baseline
        assert s.state() == "OPEN"
    assert s.escrow()["provisional"] == "PROVISIONAL_REJECT"
    assert s.escrow()["provisional_count"] == 8
    assert s.transfers() == []


def test_a_repeated_identical_notice_is_idempotent_in_effect(s):
    for _ in range(3):
        s.deliver_note(verdict="APPROVE")
    assert s.escrow()["provisional"] == "PROVISIONAL_APPROVE"
    assert s.state() == "OPEN"
    assert s.transfers() == []


@pytest.mark.parametrize("who", ["stranger", "funder", "recipient", "owner"])
def test_only_the_gate_can_send_a_notice(s, who):
    refused("UNAUTHORIZED_SENDER", s.deliver_note, who)


def test_a_notice_with_an_unknown_verdict_is_refused(s):
    refused("BAD_VERDICT", s.call, "gate", "note_provisional", s.action_id, "d", "MAYBE")


def test_a_notice_for_an_unknown_escrow_is_refused(s):
    refused("ESCROW_UNKNOWN", s.call, "gate", "note_provisional", "nothing", "d", "APPROVE")


def test_a_notice_after_the_escrow_closed_is_a_recorded_noop(s):
    s.deliver_release()
    before = s.describe()["noop_count"]
    out = s.deliver_note(verdict="REJECT")
    assert out["status"] == "NOOP"
    assert out["state"] == "SETTLED"
    assert s.state() == "SETTLED"
    assert s.describe()["noop_count"] == before + 1


def test_a_notice_can_never_release_value(s):
    for verdict in ("APPROVE", "REJECT"):
        s.deliver_note(verdict=verdict)
    assert s.transferred_to("recipient") == 0
    assert s.describe()["release_count"] == 0


# ------------------------------------------------------- I6: refusal closes


def test_a_finalized_refusal_makes_the_escrow_refundable(s):
    out = s.deliver_refusal(reason="EVIDENCE_CONTRADICTS")
    assert out["status"] == "REFUNDABLE"
    escrow = s.escrow()
    assert escrow["state"] == "REFUNDABLE"
    assert escrow["close_reason"] == "EVIDENCE_CONTRADICTS"
    assert escrow["decision_id"] == "0x" + "d2" * 32
    assert s.transfers() == []


@pytest.mark.parametrize("who", ["stranger", "funder", "recipient", "owner"])
def test_only_the_gate_can_close_an_escrow_as_refused(s, who):
    refused("UNAUTHORIZED_SENDER", s.deliver_refusal, who)
    assert s.state() == "OPEN"


def test_a_refusal_for_an_unknown_escrow_is_refused(s):
    refused("ESCROW_UNKNOWN", s.call, "gate", "close_refused", "nothing", "d", "EVIDENCE_MISSING")


def test_the_funder_withdraws_after_a_refusal(s):
    s.deliver_refusal()
    out = s.call("funder", "withdraw_refund", s.action_id)
    assert out["status"] == "WITHDRAWN"
    assert s.state() == "WITHDRAWN"
    assert s.transferred_to("funder") == AMOUNT
    [transfer] = s.transfers()
    assert transfer.stage == "finalized"


@pytest.mark.parametrize("who", ["stranger", "recipient", "owner", "gate"])
def test_nobody_but_the_funder_can_withdraw_a_refund(s, who):
    s.deliver_refusal()
    refused("NOT_FUNDER", s.call, who, "withdraw_refund", s.action_id)
    assert s.transfers() == []


def test_a_refund_cannot_be_withdrawn_twice(s):
    s.deliver_refusal()
    s.call("funder", "withdraw_refund", s.action_id)
    refused("BAD_STATE", s.call, "funder", "withdraw_refund", s.action_id)
    assert len(s.transfers()) == 1


def test_an_open_escrow_cannot_be_withdrawn(s):
    """Only a closed refusal opens the withdrawal. OPEN is not refundable by request."""
    refused("BAD_STATE", s.call, "funder", "withdraw_refund", s.action_id)


def test_a_release_after_a_refusal_is_a_recorded_noop(s):
    s.deliver_refusal()
    out = s.deliver_release()
    assert out["status"] == "NOOP"
    assert out["state"] == "REFUNDABLE"
    assert s.transferred_to("recipient") == 0


def test_a_second_refusal_is_a_recorded_noop(s):
    s.deliver_refusal()
    assert s.deliver_refusal()["status"] == "NOOP"
    assert s.state() == "REFUNDABLE"


def test_withdrawing_an_unknown_escrow_is_refused(s):
    refused("ESCROW_UNKNOWN", s.call, "funder", "withdraw_refund", "nothing")
