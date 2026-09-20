# Proof

This document is the argument the submission makes, and the evidence that
supports it. It is written so that every claim can be checked, and every number
can be regenerated, from a clean checkout.

## Hypothesis

GenLayer decisions become readable before they stop being reversible. A
settlement path that treats a decision as executable as soon as it is decided
will therefore release value against a judgment that can still be overturned.

H1 (the defect): a naive settlement path settles on a decision that is only
provisional.

H2 (the fix): gating the same settlement on the decision having cleared its
appeal window removes that class of release, without blocking any settlement
that should succeed.

The two hypotheses are stated as a pair so that the fix cannot be proven by
simply refusing everything. Every arm is measured on both a case that must be
blocked and a case that must be allowed.

## Test corpus

The corpus lives in `tests/fixtures/cases.json`. Each case states the invariant
it exercises, the outcome a correct implementation must produce, and how the
outcome is observed.

This document does not state how many cases there are, and neither does any
other. `npm run proof` counts them from the file and writes the result into
`caseCounts` in `docs/evidence/proof-report.json`, which is what the evidence
page and the proof lab render. The counts are generated because a count written
into prose is a claim that goes stale the first time a case is added, and this
document previously carried exactly that defect.

The cases are of two kinds:

- **Release cases** -- a settlement that satisfies every guard and must be
  allowed through. They are what stop a guard that refuses everything from
  scoring identically to a correct one.
- **Refusal cases** -- each names the invariant it breaks and the exact refusal
  code a correct implementation must return: `DECISION_NOT_FINAL`,
  `VERDICT_NOT_APPROVE`, `COMMITMENT_MISMATCH`, `ALREADY_SETTLED`,
  `REPLAY_BLOCKED`, `EXPIRED`.

The corpus is executed twice: once against the control contract in
`contracts/control/unsafe_release.py`, and once against the pair in
`contracts/decision_gate.py` and `contracts/finality_vault.py`.

## Baseline

The baseline is `contracts/control/unsafe_release.py`. It is a working
settlement contract with one property removed: it consults the decision at
provisional storage scope. Nothing else about it is weakened. It commits to the
same payload, checks the same nonce, enforces the same deadline, and moves the
same value.

Removing exactly one property is what makes the result attributable. If the
baseline differed in several ways, a difference in outcome could be caused by
any of them.

## Intervention

The intervention is the DEFINIT pair. `DecisionGate` records the action and
performs the adjudication, then refuses to promote the decision until its appeal
window has elapsed. `FinalityVault` accepts an escrow and settles only when the
decision has been promoted, only when the window it re-derives from the gate's
own adjudication stamp has closed, and only when the caller reproduces the exact
commitment the gate recorded.

The intervention does **not** use a final-scoped storage read, and it must not
be described as though it did. The in-contract cross-contract read scoped to
`StorageView.LATEST_FINALIZED` never returns on this network, and the client-side
`latest-final` variant, while it executes, resolves against transaction
finality rather than against the appeal window -- so it also sees an appealable
decision. Both measurements are recorded in
`docs/evidence/final-scope-probe.json` and `artifacts/vm-capabilities.json`, and
`docs/LIMITATIONS.md` states the consequence.

The behavioural difference between baseline and intervention is therefore the
appeal-window requirement plus the commitment comparison, and nothing else. The
`lib/guard/finality.ts` arm is a line-for-line mirror of
`contracts/finality_vault.py`, so the corpus measures the logic that is
deployed rather than a retelling of it.

## Control

The control arm is a negative control on the corpus itself: the release cases
are run against the intervention and must all be released. If the intervention
blocked them, the refusal results would be uninformative, because a guard that
always refuses would produce them.

The control is generated, not narrated. Its description and its measured detail
are produced by `npm run proof` and read back from the report, so the sentence
above cannot drift away from the numbers beside it. The current control also
reports how many refusal cases the baseline released, which is what makes the
attribution visible: the baseline is not a straw man that does nothing.

## Expected

- Baseline: settles in every case that supplies a readable provisional
  decision, including the appealable one. Expected provisional settlements
  observed: greater than zero.
- Intervention: settles in every acceptance case and in none of the refusal
  cases. Expected provisional settlements observed: zero.
- Both arms: no duplicate settlement in any case.
- Both arms: the beneficiary and amount actually paid match the committed
  beneficiary and amount in every accepted case.

## Observed

Numbers are produced by `npm run proof` into `docs/evidence/proof-report.json`
and read from there by the evidence page and the proof lab. Nothing here is
typed by hand, and nothing here is copied: this document deliberately quotes no
case count, because the report is the only place a count is allowed to live.

The live boundary itself is measured separately and recorded in
`docs/evidence/live-lifecycle.json`. The run attempts the promotion *first*, on
purpose, while the appeal window is open: the chain refuses it with
`APPEAL_WINDOW_OPEN` and the transaction rolls back. Only after the window has
elapsed does the promotion return, and only then does the vault release. The
escrow opened against the action sits funded but unreleasable throughout.

## Artifacts

- `tests/fixtures/cases.json` -- the corpus, with each case's expected outcome.
- `tests/attacks/` -- the corpus runner, one test per case.
- `docs/evidence/final-scope-probe.json` -- the fresh read-scope measurement.
- `scripts/probe-final-scope.mjs` -- `npm run probe:final-scope`, which writes it.
- `docs/evidence/proof-report.json` -- machine-generated metrics and per-case results.
- `artifacts/live-lifecycle.json` -- the on-chain lifecycle against the deployed contracts.
- `artifacts/deployment.json` -- addresses, transaction hashes and the pinned runner.
- `docs/evidence/isolation-audit.json` -- the shipped-tree vocabulary audit.

## Limitations

- The corpus is authored, not fuzzed. It enumerates the failure modes that were
  derived from the sponsor primitive; it does not claim to be exhaustive.
- The live lifecycle is a single end-to-end run on GenLayer Studio Next. It is
  a demonstration that the boundary exists on a real network, not a statistical
  sample of network behaviour.
- The integration is proven for the one asset and the one policy family used in
  the demo scenario. Asset behaviour outside that family is not covered.
- Rationale for these boundaries is in `docs/LIMITATIONS.md`.
