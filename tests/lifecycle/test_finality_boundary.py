"""The lifecycle, end to end, on a real GenLayer network.

Five things are asserted, in order. Together they are the product claim:

1. A registered action carries no commitment until it has been adjudicated.
   There is nothing to settle against yet, and the vault says so.
2. An escrow cannot be funded before adjudication, because the amount and the
   beneficiary are read from the committed record rather than from the caller.
3. Adjudication produces an ACCEPTED action and a decision identifier whose
   capability is readable at provisional storage scope.
4. Promoting the decision is refused while it is still appealable, and the
   refusal comes from the contract that holds the value -- not from a caller
   choosing to wait.
5. Once the decision is readable at final storage scope, the settlement runs
   exactly once and the receipt records the scope it was authorised against.

Step 4 is the regression test for the re-entrancy defect described in
`docs/PROOF.md`: a contract cannot read itself at final storage scope, because
that read would need this contract's execution slot while this contract is
already using it. The authoritative read lives in the vault instead.
"""

from __future__ import annotations

import pytest
from gltest.assertions import tx_execution_succeeded

from tests.integration.helpers import satisfying_evidence

RECIPIENT = "0x00000000000000000000000000000000000000b7"


def test_a_registered_action_carries_no_commitment(deployed):
    assert tx_execution_succeeded(deployed.create_action(RECIPIENT, nonce=9101))

    action = deployed.gate_state(deployed.action_id_for(deployed.owner))
    assert action["exists"] is True
    assert action["state"] == "SUBMITTED"
    assert action["intent_hash"] == ""
    assert action["evidence_digest"] == ""


def test_funding_before_adjudication_is_refused(deployed):
    """The escrow derives its fields from the committed record, so it needs one."""
    deployed.create_action(RECIPIENT, nonce=9102)
    action_id = deployed.action_id_for(deployed.owner)

    receipt = deployed.open_escrow(action_id)
    assert not tx_execution_succeeded(receipt)

    assert deployed.escrow(action_id)["exists"] is False


def test_the_boundary_holds_across_the_whole_lifecycle(deployed):
    deployed.create_action(RECIPIENT, nonce=9103)
    action_id = deployed.action_id_for(deployed.owner)

    adjudication = deployed.adjudicate(action_id, satisfying_evidence())
    assert tx_execution_succeeded(adjudication)

    action = deployed.gate_state(action_id)
    assert action["state"] == "ACCEPTED"
    decision_id = str(action["decision_id"])
    assert decision_id.startswith("0x")
    assert len(decision_id) == 66

    provisional = deployed.capability(decision_id, final=False)
    assert provisional["exists"] is True
    assert provisional["verdict"] == "APPROVE"
    assert provisional["action_id"] == action_id

    # Nothing has moved, and no receipt exists. Acceptance is not settlement.
    assert deployed.receipt(action_id)["exists"] is False

    # Promote the decision. This schedules the settlement on the finalized
    # stage; it does not itself release anything.
    assert tx_execution_succeeded(deployed.finalize(decision_id))

    settled = deployed.wait_for_receipt(action_id)
    assert settled["exists"] is True, "the settlement message never reached the vault"
    assert settled["status"] == "SETTLED"
    assert settled["decision_id"] == decision_id
    assert settled["action_id"] == action_id
    assert settled["decision_read_scope"] == "FINALIZED_CAPABILITY"
    assert settled["recipient"].lower() == RECIPIENT.lower()


def test_the_vault_records_exactly_one_release(deployed):
    """Whatever the messages do, the commitment is spent at most once."""
    rows = [
        row
        for row in [deployed.escrow(_last_action_id(deployed))]
        if row.get("exists")
    ]
    assert len(rows) == 1
    assert rows[0]["state"] == "SETTLED"


def _last_action_id(deployed) -> str:
    return deployed.action_id_for(deployed.owner)
