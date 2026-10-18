"""Every edge and every forbidden edge of the vault state machine.

The edges are read out of `docs/milestone/VAULT_STATE_MACHINE.md`, so the
document and the contract cannot drift: a row added to the document with no test
here fails, and a handler here with no row in the document fails.
"""

import re
from pathlib import Path

import pytest

from v1.harness import contract_path, AMOUNT, GATE, LATE, NOW, RevertedWith, Scenario, golden

VAULT = "contracts/v1/finality_vault.py"
DOC = Path(__file__).resolve().parents[3] / "docs" / "milestone" / "VAULT_STATE_MACHINE.md"
STATES = ["OPEN", "SETTLED", "REFUNDABLE", "EXPIRED_REFUNDABLE", "RECLAIMED", "WITHDRAWN"]


# ------------------------------------------------------------- the document


def table_after(heading: str) -> list[list[str]]:
    lines = DOC.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == heading)
    rows = []
    for line in lines[start + 1 :]:
        if line.startswith("|"):
            cells = [c.replace("`", "").strip() for c in line.strip().strip("|").split("|")]
            rows.append(cells)
        elif rows:
            break
    return [r for r in rows[2:]]  # drop header and the --- separator


EDGES = table_after("## Edges")
FORBIDDEN = table_after("## Forbidden edges (each is a test)")


# ------------------------------------------------------------- reaching states


def fresh(direct_vm, direct_deploy, repo_root) -> Scenario:
    return Scenario(direct_vm, direct_deploy, contract_path(repo_root, VAULT))


def reach(s: Scenario, state: str) -> Scenario:
    s.ready()
    if state == "OPEN":
        return s
    if state == "SETTLED":
        s.deliver_release()
    elif state == "REFUNDABLE":
        s.deliver_refusal()
    elif state == "EXPIRED_REFUNDABLE":
        s.world.set_time(LATE)
        s.deliver_release()
    elif state == "RECLAIMED":
        s.world.set_time(LATE)
        s.call("funder", "reclaim_after_deadline", s.action_id)
    elif state == "WITHDRAWN":
        s.deliver_refusal()
        s.call("funder", "withdraw_refund", s.action_id)
    assert s.state() == state, f"could not reach {state}"
    return s


def reverts(code, fn, *args, **kwargs):
    with pytest.raises(RevertedWith) as r:
        fn(*args, **kwargs)
    assert r.value.code == code, f"expected {code}, the contract said {r.value.code}"


def is_noop(result, state):
    assert result["status"] == "NOOP"
    assert result["state"] == state


# ------------------------------------------------------------- the edges


def edge_open_escrow(s):
    s.bind_gate()
    s.teach_gate_the_action()
    s.fund()
    assert s.state() == "OPEN"


def edge_note(s):
    reach(s, "OPEN")
    s.deliver_note()
    assert s.state() == "OPEN" and s.escrow()["provisional"] == "PROVISIONAL_APPROVE"


def edge_release(s):
    reach(s, "OPEN")
    s.deliver_release()
    assert s.state() == "SETTLED" and s.transferred_to("recipient") == AMOUNT


def edge_release_late(s):
    reach(s, "OPEN")
    s.world.set_time(LATE)
    s.deliver_release()
    assert s.state() == "EXPIRED_REFUNDABLE" and s.transfers() == []


def edge_refuse(s):
    reach(s, "OPEN")
    s.deliver_refusal()
    assert s.state() == "REFUNDABLE" and s.transfers() == []


def edge_reclaim(s):
    reach(s, "OPEN")
    s.world.set_time(LATE)
    s.call("funder", "reclaim_after_deadline", s.action_id)
    assert s.state() == "RECLAIMED" and s.transferred_to("funder") == AMOUNT


def edge_withdraw_refundable(s):
    reach(s, "REFUNDABLE")
    s.call("funder", "withdraw_refund", s.action_id)
    assert s.state() == "WITHDRAWN" and s.transferred_to("funder") == AMOUNT


def edge_withdraw_expired(s):
    reach(s, "EXPIRED_REFUNDABLE")
    s.call("funder", "withdraw_refund", s.action_id)
    assert s.state() == "WITHDRAWN" and s.transferred_to("funder") == AMOUNT


# the (From, Event, To, key condition word) of each handler; matched to the document
EDGE_HANDLERS = {
    ("(none)", "open_escrow", "OPEN"): edge_open_escrow,
    ("OPEN", "note_provisional", "OPEN (marker only)"): edge_note,
    ("OPEN", "authorize_release", "SETTLED"): edge_release,
    ("OPEN", "authorize_release", "EXPIRED_REFUNDABLE"): edge_release_late,
    ("OPEN", "close_refused", "REFUNDABLE"): edge_refuse,
    ("OPEN", "reclaim_after_deadline", "RECLAIMED"): edge_reclaim,
    ("REFUNDABLE", "withdraw_refund", "WITHDRAWN"): edge_withdraw_refundable,
    ("EXPIRED_REFUNDABLE", "withdraw_refund", "WITHDRAWN"): edge_withdraw_expired,
}


def test_the_document_lists_exactly_the_edges_that_are_tested():
    documented = {(r[0], r[1], r[4]) for r in EDGES}
    assert documented == set(EDGE_HANDLERS), "VAULT_STATE_MACHINE.md and test_state_machine.py disagree about the edges"


@pytest.mark.parametrize("edge", sorted(EDGE_HANDLERS), ids=lambda e: " -> ".join(e))
def test_every_documented_edge(edge, direct_vm, direct_deploy, repo_root):
    EDGE_HANDLERS[edge](fresh(direct_vm, direct_deploy, repo_root))


@pytest.mark.parametrize("state", STATES)
def test_every_state_in_the_document_is_reachable(state, direct_vm, direct_deploy, repo_root):
    reach(fresh(direct_vm, direct_deploy, repo_root), state)


# ------------------------------------------------------------- the forbidden edges


def non_gate_in(s, state):
    reach(s, state)
    before = (s.state(), len(s.transfers()))
    for who in ("stranger", "funder", "recipient", "owner"):
        reverts("UNAUTHORIZED_SENDER", s.deliver_release, who)
        reverts("UNAUTHORIZED_SENDER", s.deliver_refusal, who)
        reverts("UNAUTHORIZED_SENDER", s.deliver_note, who)
    assert (s.state(), len(s.transfers())) == before


@pytest.mark.parametrize("state", STATES)
def test_no_non_gate_sender_can_deliver_in_any_state(state, direct_vm, direct_deploy, repo_root):
    """The first forbidden row, across every state, one VM per state."""
    non_gate_in(fresh(direct_vm, direct_deploy, repo_root), state)


def forbidden_handlers():
    def non_gate(direct_vm, direct_deploy, repo_root):
        # One state here; the parametrized test below runs every state.
        non_gate_in(fresh(direct_vm, direct_deploy, repo_root), "OPEN")

    def named_roles_release(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "OPEN")
        for who in ("funder", "recipient", "owner"):
            reverts("UNAUTHORIZED_SENDER", s.deliver_release, who)

    def open_withdraw(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "OPEN")
        reverts("BAD_STATE", s.call, "funder", "withdraw_refund", s.action_id)

    def open_reclaim_early(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "OPEN")
        reverts("DEADLINE_NOT_PASSED", s.call, "funder", "reclaim_after_deadline", s.action_id)

    def open_reclaim_other(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "OPEN")
        s.world.set_time(LATE)
        for who in ("stranger", "recipient", "owner", "gate"):
            reverts("NOT_FUNDER", s.call, who, "reclaim_after_deadline", s.action_id)

    def settled_funder(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "SETTLED")
        s.world.set_time(LATE)
        reverts("BAD_STATE", s.call, "funder", "withdraw_refund", s.action_id)
        reverts("BAD_STATE", s.call, "funder", "reclaim_after_deadline", s.action_id)

    def noop_all(state):
        def run(direct_vm, direct_deploy, repo_root):
            s = reach(fresh(direct_vm, direct_deploy, repo_root), state)
            n = len(s.transfers())
            is_noop(s.deliver_release(), state)
            is_noop(s.deliver_refusal(), state)
            is_noop(s.deliver_note(), state)
            assert len(s.transfers()) == n and s.state() == state

        return run

    def noop_release(state):
        def run(direct_vm, direct_deploy, repo_root):
            s = reach(fresh(direct_vm, direct_deploy, repo_root), state)
            n = len(s.transfers())
            is_noop(s.deliver_release(), state)
            assert len(s.transfers()) == n and s.state() == state

        return run

    def refundable_reclaim(state):
        def run(direct_vm, direct_deploy, repo_root):
            s = reach(fresh(direct_vm, direct_deploy, repo_root), state)
            s.world.set_time(LATE)
            reverts("BAD_STATE", s.call, "funder", "reclaim_after_deadline", s.action_id)

        return run

    def reclaimed_withdraw(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "RECLAIMED")
        reverts("BAD_STATE", s.call, "funder", "withdraw_refund", s.action_id)

    def withdrawn_funder(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "WITHDRAWN")
        reverts("BAD_STATE", s.call, "funder", "withdraw_refund", s.action_id)
        reverts("BAD_STATE", s.call, "funder", "reclaim_after_deadline", s.action_id)

    def existing_escrow(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "OPEN")
        reverts("ESCROW_EXISTS", s.fund)

    def unknown_escrow(direct_vm, direct_deploy, repo_root):
        s = reach(fresh(direct_vm, direct_deploy, repo_root), "OPEN")
        reverts("ESCROW_UNKNOWN", s.call, "gate", "authorize_release", "nothing", "d", "h", "e", "p", 1, "0x" + "44" * 20, 1)
        reverts("ESCROW_UNKNOWN", s.call, "gate", "close_refused", "nothing", "d", "r")
        reverts("ESCROW_UNKNOWN", s.call, "gate", "note_provisional", "nothing", "d", "APPROVE")
        reverts("ESCROW_UNKNOWN", s.call, "funder", "withdraw_refund", "nothing")
        reverts("ESCROW_UNKNOWN", s.call, "funder", "reclaim_after_deadline", "nothing")

    # (From, a distinctive phrase of the Attempt column) -> handler
    return {
        ("any", "from a non-gate sender"): non_gate,
        ("any", "from the funder, the recipient or the owner"): named_roles_release,
        ("OPEN", "`withdraw_refund`".strip("`")): open_withdraw,
        ("OPEN", "before the deadline"): open_reclaim_early,
        ("OPEN", "by anyone but the funder"): open_reclaim_other,
        ("SETTLED", "`withdraw_refund`, `reclaim_after_deadline`".replace("`", "")): settled_funder,
        ("SETTLED", "any gate delivery"): noop_all("SETTLED"),
        ("REFUNDABLE", "authorize_release"): noop_release("REFUNDABLE"),
        ("REFUNDABLE", "reclaim_after_deadline"): refundable_reclaim("REFUNDABLE"),
        ("EXPIRED_REFUNDABLE", "authorize_release"): noop_release("EXPIRED_REFUNDABLE"),
        ("EXPIRED_REFUNDABLE", "reclaim_after_deadline"): refundable_reclaim("EXPIRED_REFUNDABLE"),
        ("RECLAIMED", "authorize_release"): noop_release("RECLAIMED"),
        ("RECLAIMED", "withdraw_refund"): reclaimed_withdraw,
        ("WITHDRAWN", "any funder method"): withdrawn_funder,
        ("WITHDRAWN", "any gate delivery"): noop_all("WITHDRAWN"),
        ("(none)", "for an existing action"): existing_escrow,
        ("(none)", "naming an unknown escrow"): unknown_escrow,
    }


HANDLERS = forbidden_handlers()


def handler_for(row):
    matches = [key for key in HANDLERS if key[0] == row[0] and key[1] in row[1].replace("`", "")]
    assert len(matches) == 1, f"forbidden row {row[:2]} matched {len(matches)} handlers"
    return matches[0]


def test_every_forbidden_row_in_the_document_has_exactly_one_test():
    used = [handler_for(row) for row in FORBIDDEN]
    assert sorted(used) == sorted(HANDLERS), "VAULT_STATE_MACHINE.md and test_state_machine.py disagree about the forbidden edges"


@pytest.mark.parametrize("row", FORBIDDEN, ids=lambda r: f"{r[0]}|{r[1][:50]}")
def test_every_forbidden_edge(row, direct_vm, direct_deploy, repo_root):
    HANDLERS[handler_for(row)](direct_vm, direct_deploy, repo_root)
