# Guarantee ledger

> **PRIMARY GUARANTEE: No value leaves the vault unless the protocol has delivered
> a finalized approval from the deciding transaction, and no value is ever stranded.**

The first half is **safety** (nothing moves early). The second is **liveness**
(nothing is stuck forever). Every component in this milestone must strengthen one
half, and must name the test or evidence that shows it. A component that cannot
fill its row is out of scope.

| Component | Half | How it strengthens it | Test or evidence |
| --- | --- | --- | --- |
| `DecisionGate v1` emits release authority on the finalized stage | safety | The authority is a child transaction the protocol creates only after the deciding transaction survives its appeal window, so it cannot exist earlier | `tests/v1/direct/test_gate.py`; spike E1 (`npm run spike`); `verify:offline` V4, V7 |
| `FinalityVault v1` accepts release only from the bound gate (I1) | safety | No caller, funder or reader can substitute for the delivery; the v0 funder path is removed | `test_vault_release.py::test_nobody_but_the_gate_can_release`; corpus `i1-*`; spike E5 and E6 |
| Vault recomputes the commitment itself (I3) | safety | A delivery cannot name a different recipient, amount, policy, nonce or evidence than the escrow committed to | `test_vault_release.py::test_one_changed_delivered_field_is_refused`; `verify:offline` V1 |
| Duplicate deliveries are recorded no-ops (I4) | safety | The same finalized message cannot pay twice | `test_a_duplicate_delivery_is_a_recorded_noop`; corpus `i4-*` |
| Provisional notice is inert (I5) | safety | A repeated or contradictory notice cannot move value or close an escrow | `test_vault_provisional_refusal.py`; limited to direct mode (see `INVARIANTS.md`, I5) |
| Late release routes to a refund (I7) | liveness | An expired authorization cannot pay late, and the funder recovers the value | `test_a_release_after_the_deadline_does_not_release`; corpus `i7-*` |
| Finalized refusal closes to the funder (I6) | liveness | A rejected payment returns to its funder instead of waiting | `test_vault_provisional_refusal.py`; live run R2 |
| `reclaim_after_deadline` (I9) | liveness | If the finalized child never arrives or fails at execution, the funder reclaims; time only ever returns value to the funder | `test_vault_liveness.py`; spike E4b (a failing child leaves the parent successful and the effect unapplied) |
| Release against reclaim race closure (I11) | safety and liveness | Whichever executes first wins, the other is a no-op, so no ordering pays twice or strands value | `test_release_then_reclaim_yields_exactly_one_transfer`, `test_reclaim_then_release_yields_exactly_one_transfer` |
| `check-no-clock` (I2) | safety | Fails the build if any clock comparison could authorize a release | `npm run check:no-clock`; `verify:offline` V3 |
| Escrow must exist before adjudication | liveness | A finalized delivery to a missing escrow cannot be retried, so the gate refuses to produce it | `test_gate.py::test_the_escrow_must_exist_before_adjudication` |
| Offline verifier | safety | Recomputes every hash and ordering claim from recorded evidence, so a claim cannot outrun its record | `npm run verify:offline`; negative control (tampering fails it) |
| Fee profile and Transaction Kit | liveness | Funds each branch, including the release child, so a message is not stranded for want of a budget; fails closed on a stale quote | `fee-profile.json`; fault F10 |
| Finality Clock and appeal arm | safety | Shows, from the protocol's own projection, that release followed finality; a contested decision holds the money until the appeal resolves | live run R3; `/actions/[id]` |
| Counterfactual and differential | safety | Measures, on the same recorded timelines, how many payments each rule executes against a non-final verdict | `counterfactual.json`; `PROOF_V1.md` |
| `definit-guard` package and agent skill | safety | Gives other builders the rule: never trigger an irreversible effect from an Accepted result | package tests; skill validation |
| Public proof page corrections (C7 to C9) | safety | A judge sees addresses and a refusal breakdown that sums, without a wallet | `/proof` e2e |

## Removed under this rule

- **Developer NFT rewards panel.** It decorates the proof page but strengthens
  neither half.
