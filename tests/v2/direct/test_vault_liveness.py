"""Liveness (I9) and the release-versus-reclaim race (I11).

Moving release authority onto a protocol delivery creates a failure v1 did not
have: if the finalized child never arrives, or arrives and fails at execution
(spike E4b), the escrow has no way out. These tests show the way out, and that a
clock can only ever authorize a return to the funder.
"""

import pytest

from v2.harness import contract_path, AMOUNT, DEADLINE, LATE, NOW, RevertedWith, Scenario, iso

VAULT = "contracts/v2/finality_vault.py"
AT_DEADLINE = iso(DEADLINE)
AFTER_DEADLINE = iso(DEADLINE + 1)


@pytest.fixture
def s(direct_vm, direct_deploy, repo_root):
    return Scenario(direct_vm, direct_deploy, contract_path(repo_root, VAULT)).ready()


def refused(code, fn, *args, **kwargs):
    with pytest.raises(RevertedWith) as r:
        fn(*args, **kwargs)
    assert r.value.code == code, f"expected {code}, the contract said {r.value.code}"


# ------------------------------------------------------- I9: never stranded


def test_a_funder_cannot_reclaim_before_the_deadline(s):
    refused("DEADLINE_NOT_PASSED", s.call, "funder", "reclaim_after_deadline", s.action_id)
    assert s.state() == "OPEN"
    assert s.transfers() == []


def test_a_funder_cannot_reclaim_at_the_deadline(s):
    """The comparison is 'strictly after'. The deadline instant is still the release's."""
    s.world.set_time(AT_DEADLINE)
    refused("DEADLINE_NOT_PASSED", s.call, "funder", "reclaim_after_deadline", s.action_id)


def test_a_funder_reclaims_after_the_deadline_when_nothing_was_delivered(s):
    """The E4b case: the finalized child never arrived or failed. Value comes home."""
    s.world.set_time(AFTER_DEADLINE)
    out = s.call("funder", "reclaim_after_deadline", s.action_id)
    assert out["status"] == "RECLAIMED"
    assert s.state() == "RECLAIMED"
    assert s.transferred_to("funder") == AMOUNT
    assert s.transferred_to("recipient") == 0
    [transfer] = s.transfers()
    assert transfer.stage == "finalized"


@pytest.mark.parametrize("who", ["stranger", "recipient", "owner", "gate"])
def test_only_the_funder_can_reclaim(s, who):
    s.world.set_time(LATE)
    refused("NOT_FUNDER", s.call, who, "reclaim_after_deadline", s.action_id)
    assert s.transfers() == []


def test_a_clock_never_authorizes_a_release_to_the_recipient(s):
    """I9 stated as a test: however late it gets, no sequence of calls by anyone
    other than a gate delivery sends value to the recipient."""
    s.world.set_time(LATE)
    for who in ["funder", "stranger", "recipient", "owner"]:
        for method, args in [
            ("reclaim_after_deadline", (s.action_id,)),
            ("withdraw_refund", (s.action_id,)),
        ]:
            try:
                s.call(who, method, *args)
            except RevertedWith:
                pass
    assert s.transferred_to("recipient") == 0


def test_reclaiming_an_unknown_escrow_is_refused(s):
    s.world.set_time(LATE)
    refused("ESCROW_UNKNOWN", s.call, "funder", "reclaim_after_deadline", "nothing")


def test_a_reclaimed_escrow_cannot_be_reclaimed_again(s):
    s.world.set_time(LATE)
    s.call("funder", "reclaim_after_deadline", s.action_id)
    refused("BAD_STATE", s.call, "funder", "reclaim_after_deadline", s.action_id)
    assert len(s.transfers()) == 1


# ------------------------------------------------------- I11: race closure


def test_release_then_reclaim_yields_exactly_one_transfer(s):
    """The release executes first. The reclaim is refused. One transfer, to the recipient."""
    s.deliver_release()
    s.world.set_time(LATE)
    refused("BAD_STATE", s.call, "funder", "reclaim_after_deadline", s.action_id)
    assert len(s.transfers()) == 1
    assert s.transferred_to("recipient") == AMOUNT
    assert s.transferred_to("funder") == 0


def test_reclaim_then_release_yields_exactly_one_transfer(s):
    """The reclaim executes first. The late release delivery is a recorded no-op."""
    s.world.set_time(LATE)
    s.call("funder", "reclaim_after_deadline", s.action_id)
    before = s.describe()["noop_count"]
    out = s.deliver_release()
    assert out["status"] == "NOOP"
    assert out["state"] == "RECLAIMED"
    assert len(s.transfers()) == 1
    assert s.transferred_to("funder") == AMOUNT
    assert s.transferred_to("recipient") == 0
    assert s.describe()["noop_count"] == before + 1


@pytest.mark.parametrize("order", ["release_first", "reclaim_first"])
def test_no_ordering_of_the_two_can_produce_two_transfers(s, order):
    s.world.set_time(LATE)
    if order == "release_first":
        # A release that is late routes to a refund, so it cannot beat a reclaim to a transfer.
        s.deliver_release()
        try:
            s.call("funder", "reclaim_after_deadline", s.action_id)
        except RevertedWith:
            pass
        s.call("funder", "withdraw_refund", s.action_id)
    else:
        s.call("funder", "reclaim_after_deadline", s.action_id)
        s.deliver_release()
    assert len(s.transfers()) == 1
    assert s.transferred_to("funder") == AMOUNT


def test_a_late_release_does_not_beat_the_deadline_but_the_funder_still_recovers(s):
    s.world.set_time(AFTER_DEADLINE)
    s.deliver_release()
    assert s.state() == "EXPIRED_REFUNDABLE"
    refused("BAD_STATE", s.call, "funder", "reclaim_after_deadline", s.action_id)
    s.call("funder", "withdraw_refund", s.action_id)
    assert s.state() == "WITHDRAWN"
    assert s.transferred_to("funder") == AMOUNT


def test_the_state_machine_never_allows_value_out_twice(s):
    """Run every method every actor can reach, in a fixed order, after a release.
    Total value out can never exceed what was put in."""
    s.deliver_release()
    s.world.set_time(LATE)
    for who in ["gate", "funder", "stranger", "recipient", "owner"]:
        for attempt in (
            lambda w=who: s.call(w, "withdraw_refund", s.action_id),
            lambda w=who: s.call(w, "reclaim_after_deadline", s.action_id),
            lambda w=who: s.deliver_release(w),
            lambda w=who: s.deliver_refusal(w),
        ):
            try:
                attempt()
            except RevertedWith:
                pass
    assert sum(t.value for t in s.transfers()) == AMOUNT
