"""Attack cases against the shipped guard surface.

Each test drives one guard and asserts the *named* refusal. The point of the
suite is attribution: a case that fails tells you which guard stopped holding,
not merely that something went wrong.

What is deliberately *not* here
-------------------------------
Two guards cannot be falsified in this runner, and saying so is part of the
result rather than a gap in it.

* **The finality guard.** `FinalityVault.settle` decides finality by a
  cross-contract read of the decision contract. The direct runner does not
  implement cross-contract reads -- the read returns `None` -- so the guard is
  unreachable here. It is covered on chain instead: `docs/evidence/live-lifecycle.json`
  records a promotion attempted inside the appeal window, refused with
  `APPEAL_WINDOW_OPEN`, and a release that only lands after the window closes.
* **Caller identity, in both directions.** The runner pins `gl.message` to the
  account that loaded the contract and does not re-resolve it when
  `direct_vm.sender` is reassigned, so a test cannot become a different
  account part-way through. Ownership is therefore attacked from the outside
  (a vault owned by a foreign account refuses the test's account) rather than
  by impersonation, which is the form the refusal can be attributed in.

Everything below is decided by a guard that reads nothing but its own storage
and the message context. That is why each one is independently falsifiable.
"""

from __future__ import annotations

import pytest

from tests.attacks.conftest import AGENT, RECIPIENT, VAULT_ADDR, as_sender

# --------------------------------------------------------------------- helpers

# A fully valid action. Every negative case changes exactly one field, so a
# refusal is attributable to that field and to nothing else.
VALID = {
    "recipient": RECIPIENT,
    "amount": 10,
    "asset": "GEN",
    "policy_id": "delivery-milestone-v3",
    "evidence_url": "https://example.invalid/evidence.txt",
    "deadline_unix": 4_000_000_000,
    "nonce": 7,
}


def submit(gate, direct_vm, **overrides):
    sender = overrides.pop("_sender", AGENT)
    fields = {**VALID, **overrides}
    direct_vm.sender = as_sender(sender)
    return gate.create_action(
        fields["recipient"],
        fields["amount"],
        fields["asset"],
        fields["policy_id"],
        fields["evidence_url"],
        fields["deadline_unix"],
        fields["nonce"],
    )


# ----------------------------------------------- DecisionGate: action creation


def test_amount_must_be_positive(gate, direct_vm):
    with direct_vm.expect_revert("BAD_AMOUNT"):
        submit(gate, direct_vm, amount=0)


def test_a_zero_asset_is_refused(gate, direct_vm):
    with direct_vm.expect_revert("BAD_ASSET"):
        submit(gate, direct_vm, asset="")


def test_evidence_must_be_https(gate, direct_vm):
    with direct_vm.expect_revert("BAD_EVIDENCE_URL"):
        submit(gate, direct_vm, evidence_url="http://example.invalid/evidence.txt")


def test_a_deadline_in_the_past_is_refused(gate, direct_vm):
    with direct_vm.expect_revert("BAD_DEADLINE"):
        submit(gate, direct_vm, deadline_unix=1)


def test_a_non_positive_nonce_is_refused(gate, direct_vm):
    with direct_vm.expect_revert("BAD_NONCE"):
        submit(gate, direct_vm, nonce=0)


def test_a_malformed_recipient_is_refused(gate, direct_vm):
    with direct_vm.expect_revert("BAD_RECIPIENT"):
        submit(gate, direct_vm, recipient="not-an-address")


# ------------------------------------------------- DecisionGate: promotion


def test_an_unknown_decision_cannot_be_promoted(gate, direct_vm):
    """Promotion is keyed to a decision the gate actually recorded."""
    with direct_vm.expect_revert("DECISION_UNKNOWN"):
        gate.finalize_decision("0x" + "ab" * 32)


# ---------------------------------------------------------- FinalityVault


def test_a_foreign_owner_cannot_bind_the_gate(vault, direct_vm):
    """Ownership is checked before anything is written. The vault below is
    owned by `OUTSIDER` and the test runs as a different account, so this
    refusal is attributable to the ownership check and nothing else."""
    with direct_vm.expect_revert("NOT_OWNER"):
        vault.set_gate(VAULT_ADDR)


def test_settling_an_unknown_escrow_is_refused(vault, direct_vm):
    """There is no path that creates a receipt out of nothing."""
    with direct_vm.expect_revert("ESCROW_UNKNOWN"):
        vault.settle(
            "0x" + "01" * 32,
            "0x" + "02" * 32,
            "0x" + "03" * 32,
            "0x" + "04" * 32,
            "0x" + "05" * 32,
            7,
            RECIPIENT,
            10,
        )


def test_escrow_cannot_be_opened_before_a_gate_is_bound(vault, direct_vm):
    """With no gate bound the vault has no authority to read a commitment from,
    so it refuses rather than trusting the caller for one."""
    direct_vm.value = 10
    with direct_vm.expect_revert("UNAUTHORIZED_CALLER"):
        vault.open_escrow("0x" + "06" * 32)


# ------------------------------------------------------ cross-contract facts


def test_gate_and_vault_agree_on_the_appeal_window(gate, vault):
    """The boundary is two contracts agreeing on one number and one rule. If
    they ever disagree, one of them is measuring a different window and the
    seam between them is the bug."""
    gate_description = gate.describe()
    vault_description = vault.describe()

    assert gate_description["appeal_window_seconds"] == vault_description["appeal_window_seconds"]
    assert gate_description["finality_rule"] == vault_description["finality_rule"]


def test_the_window_is_not_vanishingly_short(gate, vault):
    """A window of zero would satisfy the previous test and mean nothing."""
    assert gate.describe()["appeal_window_seconds"] >= 60
    assert vault.describe()["appeal_window_seconds"] >= 60


def test_neither_contract_advertises_a_final_storage_read(gate, vault):
    """Regression guard. Both contracts used to declare a final-scoped
    cross-contract read, which cannot execute on this network -- see
    docs/LIMITATIONS.md. The declared scope must not drift back to it."""
    for description in (gate.describe(), vault.describe()):
        declared = str(description.get("capability_read_scope", description.get("final_read_scope", "")))
        assert "LATEST_FINALIZED" not in declared
        assert declared == "FINALIZED_CAPABILITY"
