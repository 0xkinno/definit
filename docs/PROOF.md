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

The corpus is a fixed set of twelve cases in `tests/fixtures/cases.json`. Each
case states the invariant it exercises, the outcome a correct implementation
must produce, and how the outcome is observed. Nine cases must be refused and
three must be accepted.

- Refusal cases: `accepted-not-final`, `wrong-recipient`, `wrong-amount`,
  `wrong-policy`, `wrong-evidence`, `replay`, `duplicate-message`, `expiry`,
  `rejected-decision`.
- Acceptance cases: `valid-finalization`, `appeal-simulation`,
  `malformed-capability`.

`malformed-capability` and `rejected-decision` are the two cases that keep the
corpus honest. A guard that refuses everything passes the refusal set and fails
these. They are the reason a refusal count alone is not reported as a result.

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
performs the adjudication, then exposes a capability record. `FinalityVault`
accepts an escrow and settles only when it can read that capability from final
storage state, and only when the caller reproduces the exact commitment the
gate recorded.

The only behavioural difference between baseline and intervention is the
storage scope of the capability read, plus the commitment comparison that the
read makes possible. That is the whole change.

## Control

The control arm is a negative control on the corpus itself: the three
acceptance cases are run against the intervention and must all succeed. If the
intervention blocked them, the refusal results would be uninformative, because
a guard that always refuses would produce them.

A second control is run inside the same corpus. Case `appeal-simulation`
records a decision at provisional scope and then presents the final-scope read
of the same decision. The intervention must treat these as different
authorities.

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
and reproduced verbatim in `docs/EVIDENCE.md`. Nothing here is typed by hand.

The live boundary itself is measured separately and recorded in
`docs/evidence/live-lifecycle.json`. The run attempts the promotion *first*, on
purpose, while the appeal window is open: the chain refuses it with
`APPEAL_WINDOW_OPEN` and the transaction rolls back. Only after the window has
elapsed does the promotion return, and only then does the vault release. The
escrow opened against the action sits funded but unreleasable throughout.

## Artifacts

- `tests/fixtures/cases.json` -- the twelve-case corpus, with expected outcomes.
- `tests/attacks/` -- the corpus runner, one test per case.
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
