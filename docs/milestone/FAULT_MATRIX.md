# Fault matrix

Written before any v2 product code, so the system is attacked by a plan that
could not have been shaped to fit it. Each row is run by `scripts/faults.mjs`
(Phase 4) on the target network, or in direct mode where a fault cannot be
produced on chain. The harness records which, per row, in
`docs/evidence/milestone/faults.json`.

Format of every row: agent action, then fault, then the response the system must
give, then the evidence that shows it, then the invariant it attacks.

| # | Agent action | Fault | Required response | Evidence | Invariant |
| --- | --- | --- | --- | --- | --- |
| F1 | Agent submits a payment | An EOA calls `authorize_release` with a perfectly formed payload | Refused with `UNAUTHORIZED_SENDER`. No value moves | direct-mode test plus an on-chain attempt recorded with its refusal | I1 |
| F2 | Funder wants its payment released early | The funder looks for any public method that releases on its own request | No such method exists. The only release entry point is gate-only. The v1 funder path is gone | ABI listing plus a direct-mode test that calls every public method as the funder | I1, C2 |
| F3 | A finalized release delivery is processed | The same delivery is processed a second time | Second delivery is a recorded no-op. One transfer exists | direct-mode replay test, receipt count | I4 |
| F4 | A finalized release delivery is processed | One byte of one commitment field is altered in the payload | Refused with `COMMITMENT_MISMATCH`, for each field in turn | direct-mode test, one case per field | I3 |
| F5 | The gate reports provisional outcomes | Repeated `note_provisional` with alternating verdicts | Display marker changes. Balance and escrow state are identical before and after | direct-mode test. On chain: only if the network can emit the accepted stage (see O5, may be UNKNOWN) | I5 |
| F6 | An approved payment is contested | An appeal is submitted inside the window | Release is held until the decision that finalizes. No release child exists before then | R3 lifecycle record | I8 |
| F7 | An approved payment is released | The release child fails at execution (E4b) | The parent stays successful and the escrow stays open. The funder reclaims after the deadline. Value is never stranded | E4b spike record plus the direct-mode reclaim test | I9 |
| F8 | Release and reclaim race around the deadline | Both are attempted either side of `deadline_unix` | Exactly one wins. The other is a recorded no-op. Never two transfers | direct-mode ordering test, both orders | I11 |
| F9 | Evidence source cannot be read | The evidence URL is unreachable | Verdict is REJECT with `SOURCE_UNAVAILABLE`. A finalized `close_refused` follows and the funder can withdraw | live record on the target network | I6 |
| F10 | A write is signed against a stale fee quote | The quote verification returns `mismatch` | The Transaction Kit blocks signing. Nothing is submitted | integration test against the committed fee profile | liveness |
| F11 | Release is attempted after the deadline | A finalized APPROVE arrives after `deadline_unix` | No release. Escrow becomes `EXPIRED_REFUNDABLE` | direct-mode test | I7 |
| F12 | A legitimate payment | A finalized APPROVE, matching commitment, before the deadline | It is always released. A guard that blocks this is an outage | direct-mode test, plus R1 | I10 |

## What a pass means and what it does not

A row passes only when the recorded evidence shows the required response. A row
that cannot be produced where claimed is reported as such. The matrix is a list
of attacks the authors thought of. It is not a proof that no other attack exists.
That limit is repeated in `docs/LIMITATIONS.md`.
