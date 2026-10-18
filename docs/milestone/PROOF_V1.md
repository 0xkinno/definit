# Counterfactual proof design

A green demo proves little. This is the experiment that could disprove DEFINIT
v1, designed before v1 exists. Its numbers are written by
`scripts/counterfactual.mjs` into `docs/evidence/milestone/counterfactual.json`.
Nothing in this file states a result.

## Question

If the same real protocol timelines are shown to four different payment rules,
how many payments does each rule execute against a verdict that was not final,
and how many legitimate payments does each refuse?

## Matched conditions

All four arms are evaluated against the same recorded timelines: the runs R1 to
R4, every E1 and E2 sample from the spike, and every fault run. A timeline is a
sequence of real lifecycle snapshots with real timestamps. For each timeline and
each arm the script finds the moment the arm's rule would have executed the
payment, then asks whether the deciding transaction was Finalized at that
moment.

## Arms

| Arm | Rule |
| --- | --- |
| Baseline | Pay when the deciding transaction is `Accepted` and its execution succeeded |
| Control | Pay a fixed delay after `Accepted`. The delay is the median appeal window measured in Phase 0. This is the best a timer can do |
| v0 | Pay once the application's own elapsed-time rule has passed and the promotion has run. The rule is the v0 constant, restated in the replay code |
| v1 | Pay only on the delivery of the finalized-stage release message |

## Metrics

- **Primary (safety):** unsafe executions, meaning payments executed while the
  deciding transaction was not `Finalized`, or against a verdict later changed by
  appeal.
- **Counter-metric (liveness):** legitimate releases refused or never executed,
  and the median delay from `Finalized` to payment. The honest cost of v1 is
  reported, not hidden.

## Falsifier, stated in advance

A single timeline in which v1 executes before `Finalized`, or refuses a finalized
legitimate approval, disproves the claim. The control arm is there to show that
the obvious engineering fix (a well-chosen timer) still fails whenever an appeal
pauses or replaces the window.

## The replay rules, in full

Each rule is a few lines so a skeptical reviewer can audit it in one minute. They
live in `scripts/counterfactual.mjs`, and a unit test asserts that the code in
that file is the code reproduced in this section once Phase 4 fills it in.

```text
timeline = ordered snapshots { atMs, projectedStatus, resolutionAction, decisionId, ... }
accepted = first snapshot with projectedStatus == "Accepted"
final    = first snapshot with projectedStatus == "Finalized"

baseline.executeAtMs = accepted.atMs
control.executeAtMs  = accepted.atMs + medianAppealWindowMs
v0.executeAtMs       = accepted.atMs + v1ConstantMs
v1.executeAtMs       = deliveryMs   (the child transaction creation time)

unsafe(arm)  = arm.executeAtMs < final.atMs  OR  decisionId changed after arm.executeAtMs
refused(arm) = timeline is a legitimate approval AND arm never executes
```

## Scope and honesty

The timelines are real but few. The result is a count over those timelines, not
a statistic over all possible timelines. Appeal outcomes are whatever the
committee returned and are not engineered. The README states these limits next
to the counts.
