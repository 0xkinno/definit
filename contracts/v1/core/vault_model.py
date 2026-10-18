"""The v2 vault as an executable specification.

Plain Python, no GenLayer imports, no storage, no clock. One function decides what
the vault does with one event, and returns the new state, the refusal code if any,
and the value that moves. It exists for three jobs:

* the property suite runs thousands of random lifecycles against both this model
  and the real vault and requires them to agree;
* the TypeScript guard mirror (lib/guard/vault-v2.ts) is checked against it, so
  the UI warns before signing exactly when the contract would refuse;
* the mutation check weakens the contract and requires some test to notice.

It is deliberately small. Anything the contract does that this file does not
describe is a difference the property suite will find.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

OPEN = "OPEN"
SETTLED = "SETTLED"
REFUNDABLE = "REFUNDABLE"
EXPIRED_REFUNDABLE = "EXPIRED_REFUNDABLE"
RECLAIMED = "RECLAIMED"
WITHDRAWN = "WITHDRAWN"
STATES = (OPEN, SETTLED, REFUNDABLE, EXPIRED_REFUNDABLE, RECLAIMED, WITHDRAWN)

# Roles, not addresses: the model reasons about who is allowed, not who is who.
GATE = "gate"
FUNDER = "funder"
OTHER = "other"

EVENTS = ("authorize_release", "close_refused", "note_provisional", "withdraw_refund", "reclaim_after_deadline")


@dataclass(frozen=True)
class Escrow:
    state: str
    amount: int
    deadline: int
    provisional: str = ""
    provisional_count: int = 0


@dataclass(frozen=True)
class Delivery:
    """What a gate delivery carries, reduced to the facts the guards compare."""

    fields_match: bool = True  # every delivered field equals the escrow record
    commitment_matches: bool = True  # the recomputed intent hash equals the delivered one
    verdict: str = "APPROVE"  # only for note_provisional


@dataclass(frozen=True)
class Outcome:
    state: str
    refusal: str = ""  # a revert code, or "" for no revert
    noop: bool = False  # a recorded no-op
    status: str = ""
    to_recipient: int = 0
    to_funder: int = 0
    escrow: Escrow | None = None


def step(escrow: Escrow, event: str, sender: str, now: int, delivery: Delivery | None = None) -> Outcome:
    """Apply one event to one escrow. Pure: the same inputs always give the same output."""
    delivery = delivery or Delivery()

    def refuse(code: str) -> Outcome:
        return Outcome(state=escrow.state, refusal=code, escrow=escrow)

    def noop() -> Outcome:
        return Outcome(state=escrow.state, noop=True, status="NOOP", escrow=escrow)

    def go(new_state: str, **kw) -> Outcome:
        updated = replace(escrow, state=new_state)
        return Outcome(state=new_state, status=new_state, escrow=updated, **kw)

    if event in ("authorize_release", "close_refused", "note_provisional"):
        if sender != GATE:
            return refuse("UNAUTHORIZED_SENDER")  # I1, before anything else is read
        if event == "note_provisional":
            if delivery.verdict not in ("APPROVE", "REJECT"):
                return refuse("BAD_VERDICT")
            if escrow.state != OPEN:
                return noop()
            marker = "PROVISIONAL_APPROVE" if delivery.verdict == "APPROVE" else "PROVISIONAL_REJECT"
            updated = replace(escrow, provisional=marker, provisional_count=escrow.provisional_count + 1)
            return Outcome(state=OPEN, status="MARKED", escrow=updated)  # I5: a marker, nothing else
        if escrow.state != OPEN:
            return noop()  # I4, I11
        if event == "close_refused":
            return go(REFUNDABLE)  # I6
        if now > escrow.deadline:
            return go(EXPIRED_REFUNDABLE)  # I7, deny-only
        if not delivery.fields_match or not delivery.commitment_matches:
            return refuse("COMMITMENT_MISMATCH")  # I3
        return go(SETTLED, to_recipient=escrow.amount)

    if event == "withdraw_refund":
        if sender != FUNDER:
            return refuse("NOT_FUNDER")
        if escrow.state not in (REFUNDABLE, EXPIRED_REFUNDABLE):
            return refuse("BAD_STATE")
        return go(WITHDRAWN, to_funder=escrow.amount)

    if event == "reclaim_after_deadline":
        if sender != FUNDER:
            return refuse("NOT_FUNDER")
        if escrow.state != OPEN:
            return refuse("BAD_STATE")
        if now <= escrow.deadline:
            return refuse("DEADLINE_NOT_PASSED")
        return go(RECLAIMED, to_funder=escrow.amount)  # I9: a clock only returns value to the funder

    raise ValueError(f"unknown event {event}")
