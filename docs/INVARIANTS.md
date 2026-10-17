# Invariants

Eleven named invariants. For each: the predicate, the guard in the contract that
enforces it, the tests that attack it, and the check in `npm run verify:offline`
that confirms it from recorded evidence. A claim with no row here is not a claim
this project makes.

Test files are under `tests/v2/direct/`. The corpus is
`tests/v2/fixtures/cases-v2.json`. Corpus counts per invariant are generated into
`docs/evidence/milestone/proof-v2-report.json`.

| ID | Name | Predicate |
| --- | --- | --- |
| I1 | Delivery | Value leaves the vault toward the recipient only inside a transaction whose `sender_address` is the bound gate and which was created by an `on='finalized'` emission |
| I2 | No clock | Neither v2 contract contains a wall-clock comparison that authorizes a release |
| I3 | Commitment | The vault recomputes `intent_hash` from its own escrow record plus the delivered `evidence_digest`; it must equal the delivered `intent_hash` |
| I4 | Once | An escrow releases at most once. A duplicate delivery is a recorded no-op, never a second transfer |
| I5 | Provisional is inert | A provisional notice can change only a display marker. It can never move value or close an escrow, and it is idempotent under repetition |
| I6 | Refusal closes | A finalized REJECT delivery moves the escrow to `REFUNDABLE`. Only the funder can withdraw it, and only after that delivery |
| I7 | Expiry | A release delivery that arrives after the deadline does not release. It marks `EXPIRED_REFUNDABLE` |
| I8 | Order | For every release in the evidence, the deciding transaction was Finalized no later than the release child's creation |
| I9 | Liveness | Escrowed value is never stranded. A clock may only authorize a return to the funder, never a release to the recipient |
| I10 | No false refusal | A finalized APPROVE delivered before the deadline with a matching commitment is always released |
| I11 | Race closure | Of a finalized release and a funder reclaim, whichever executes first wins; the other is a recorded no-op. No sequence of the two produces two transfers |

## I1 Delivery

- **Guard.** `FinalityVault.authorize_release`, `close_refused` and `note_provisional` each begin with `gl.message.sender_address != self.gate` and refuse with `UNAUTHORIZED_SENDER` before reading anything else. The gate emits only on the finalized stage in `DecisionGate._record_outcome`. There is no public method that releases on a caller's request.
- **Tests.** `test_vault_release.py`: `test_nobody_but_the_gate_can_release` (stranger, funder, recipient and owner), `test_the_sender_is_checked_before_anything_is_read`, `test_there_is_no_public_method_that_releases_on_a_callers_request`. `test_gate.py`: `test_an_approval_emits_exactly_one_message_on_the_finalized_stage`. `test_state_machine.py`: `test_no_non_gate_sender_can_deliver_in_any_state` (every state). Corpus: seven `i1-*` cases.
- **Offline.** V4 (a finalized message is a child of the deciding transaction, sent by the emitting contract), V5 (a direct call shows the caller's own address), V7 (each live run: the delivery was sent by the gate, to the vault, triggered by the adjudicating transaction).
- **Measured basis.** Spike E5: the sink recorded the emitting contract's address for delivered messages and the caller's address for a direct call.

## I2 No clock

- **Guard.** Five clock comparisons exist in the v2 contracts, each deny-only or return-to-funder: `create_action` and `open_escrow` (a deadline must lie in the future), `request_adjudication` (an expired action is not adjudicated), `authorize_release` (a late delivery routes to a refund), `reclaim_after_deadline` (the funder may reclaim only after the deadline).
- **Test.** `npm run check:no-clock` parses `contracts/v2/*.py` and fails on any other clock use, any arithmetic on the clock and any numeric appeal-window-style constant. It is part of `npm test`.
- **Offline.** V3 re-reads `docs/evidence/milestone/no-clock-check.json` and re-checks every comparison's verdict.

## I3 Commitment

- **Guard.** `authorize_release` compares each delivered field with the escrow's own record (`COMMITMENT_MISMATCH`), then recomputes the v1 commitment encoding from the escrow plus the delivered evidence digest and compares it with the delivered hash.
- **Tests.** `test_one_changed_delivered_field_is_refused` (recipient, amount, policy hash, nonce), `test_a_forged_intent_hash_is_refused`, `test_a_different_evidence_digest_cannot_reuse_the_hash`, `test_the_recomputed_commitment_and_the_receipt_agree`. `test_gate.py`: `test_the_commitment_encoding_is_byte_identical_to_v1`, `test_the_gates_message_is_exactly_the_golden_message`. Corpus: six `i3-*` cases.
- **Offline.** V1 recomputes the gate's action id, evidence digest, intent hash and v2 decision id with the TypeScript module and compares them with the Python gate's emission. V7 repeats it for live runs.

## I4 Once

- **Guard.** A gate delivery that finds the escrow in any state other than `OPEN` returns `status: NOOP`, leaves the state unchanged and increments `noop_count`. The effect is written before the transfer is emitted.
- **Tests.** `test_a_duplicate_delivery_is_a_recorded_noop`, `test_many_duplicate_deliveries_never_make_a_second_transfer`, `test_state_is_written_before_the_transfer_is_emitted`. Corpus: `i4-duplicate-delivery`, `i4-five-duplicates`.
- **Offline.** V2 re-derives each case's recorded outcome.

## I5 Provisional is inert

- **Guard.** `FinalityVault.note_provisional` is gate-only, rewrites a marker and a counter on an `OPEN` escrow, and is a recorded no-op on any other state.
- **Tests.** `test_vault_provisional_refusal.py`: `test_alternating_verdicts_change_the_marker_and_nothing_else`, `test_a_repeated_identical_notice_is_idempotent_in_effect`, `test_a_notice_can_never_release_value`, `test_a_notice_after_the_escrow_closed_is_a_recorded_noop`. Corpus: three `i5-*` cases.
- **Offline.** V2.
- **Stated limit.** On Studio-dev, `emit(on='accepted')` raised an execution error in the VM under the pinned runner (observation O5), so the gate does not emit a provisional notice and I5 is exercised in direct mode only. Whether accepted-stage messages repeat across appeal rounds (E3) is UNKNOWN.

## I6 Refusal closes

- **Guard.** `close_refused` (gate-only) moves `OPEN` to `REFUNDABLE`. `withdraw_refund` is funder-only and accepts only `REFUNDABLE` or `EXPIRED_REFUNDABLE`.
- **Tests.** `test_a_finalized_refusal_makes_the_escrow_refundable`, `test_the_funder_withdraws_after_a_refusal`, `test_nobody_but_the_funder_can_withdraw_a_refund`, `test_a_refund_cannot_be_withdrawn_twice`, `test_an_open_escrow_cannot_be_withdrawn`. `test_gate.py`: `test_a_rejection_emits_exactly_one_close_refused_message`. Corpus: eight `i6-*` cases.
- **Offline.** V2; V7 for the live reject run.

## I7 Expiry

- **Guard.** In `authorize_release`, a delivery with `now > deadline_unix` sets `EXPIRED_REFUNDABLE` and returns. The comparison is strictly "after".
- **Tests.** `test_a_release_after_the_deadline_does_not_release`, `test_a_release_exactly_at_the_deadline_is_still_a_release`, `test_a_late_escrow_can_be_withdrawn_by_the_funder`. Corpus: `i7-*`.
- **Offline.** V2.

## I8 Order

- **Guard.** Structural: the gate emits only on the finalized stage, and a finalized-stage message is a child transaction the protocol creates after the deciding transaction survives its appeal window. Nothing in the contracts can make it earlier.
- **Tests.** Not decidable in direct mode, which has no protocol. It is decided by the live records.
- **Offline.** V4 over every recorded spike decision (the child's creation time is at or after the decision's appeal deadline, the sink never shows the delivery before that deadline, the child is triggered by the deciding transaction). V7 repeats the check for each live v2 run, and also fails if the vault shows a moved state before the delivery was created.
- **Measured basis.** Spike E1: the finalized child was created at the appeal deadline in every recorded decision.

## I9 Liveness

- **Guard.** `reclaim_after_deadline` (funder-only, `OPEN` only, strictly after the deadline) returns value to the funder. `withdraw_refund` returns value after a refusal or a late delivery. Both only ever pay the funder.
- **Tests.** `test_vault_liveness.py`: `test_a_funder_reclaims_after_the_deadline_when_nothing_was_delivered`, `test_a_funder_cannot_reclaim_at_the_deadline`, `test_a_clock_never_authorizes_a_release_to_the_recipient`, `test_the_state_machine_never_allows_value_out_twice`. Corpus: seven `i9-*` cases.
- **Offline.** V2; V3 for the clock direction.
- **Measured basis.** Spike E4b: a finalized child that fails at execution leaves the parent successful and the effect unapplied. Without this path the escrow would be stranded.

## I10 No false refusal

- **Guard.** No guard on `authorize_release` refuses a matching, in-time, gate-sent delivery to an `OPEN` escrow.
- **Tests.** `test_a_valid_finalized_approval_before_the_deadline_is_always_released`, `test_a_release_is_not_blocked_by_a_marker_left_by_a_provisional_notice`, `test_the_gates_golden_message_is_accepted_and_releases`. Corpus: `i10-*`.
- **Offline.** V2; V7 for the live approve run.

## I11 Race closure

- **Guard.** Both `authorize_release` and `reclaim_after_deadline` require the escrow to be `OPEN`, and both close it before emitting a transfer.
- **Tests.** `test_release_then_reclaim_yields_exactly_one_transfer`, `test_reclaim_then_release_yields_exactly_one_transfer`, `test_no_ordering_of_the_two_can_produce_two_transfers`. Corpus: three `i11-*` cases.
- **Offline.** V2.

## Why I9 to I11 are here

Moving authority onto protocol delivery creates a failure v1 never had: if the
finalized-stage child is never delivered or fails at execution, the money has no
path out. A finality firewall that can strand funds has swapped a safety bug for a
liveness bug. v2 closes both, and the asymmetry is the design: time can only send
money home, never forward.
