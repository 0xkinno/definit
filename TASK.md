# TASK.md -- DEFINIT executable build plan

Every task below has: ID, phase, goal, files, acceptance criteria, verification
command, evidence produced, status.

Status values: `TODO` | `DOING` | `DONE` | `BLOCKED` | `N/A`

Phases:

| Phase | Name |
| --- | --- |
| P0 | Discovery |
| P1 | Mechanism spike |
| P2 | Contracts |
| P3 | Product flow |
| P4 | Proof lab |
| P5 | UI |
| P6 | Integration |
| P7 | Responsive / accessibility |
| P8 | Documentation |
| P9 | Deployment |
| P10 | Submission |

---

## P0 -- Discovery

### T-P0-001 -- Study the sponsor primitive in source
- **Goal:** Read the GenVM/IC specification and SDK source, not marketing pages.
- **Files:** `research/SOURCES.md`, `docs/DISCOVERY.md`
- **Acceptance:** `docs/DISCOVERY.md` records (1) sponsor primitive, (2) observed constraint, (3) evidence with file-level citations, (4) why common implementations fail, (5) new capability, (6) one invariant, (7) one failure mode, (8) one reproducible demo.
- **Verification:** `npm run docs:check`
- **Evidence:** `research/SOURCES.md`
- **Status:** DONE

### T-P0-002 -- Survey the sample field
- **Goal:** Review every sample repository for problem, user, primitive, contract architecture, lifecycle, validator design, evidence model, tests, UI, live proof, limitations.
- **Files:** `research/SAMPLE_MATRIX.md`
- **Acceptance:** one row per sample with columns: Project, Primitive, Human, Problem, Core Mechanism, Proof Method, Strongest Pattern, Weakness / Gap, DEFINIT Lesson. No verbatim copying.
- **Verification:** `npm run research:matrix`
- **Evidence:** `research/SAMPLE_MATRIX.md`
- **Status:** DONE

### T-P0-003 -- Pin the SDK and runner versions
- **Goal:** Record exact SDK generation, runner dependency hash and chain identifiers.
- **Files:** `docs/DISCOVERY.md`, `.env.example`
- **Acceptance:** runner `Depends` hash, SDK import convention and network parameters recorded with the source they came from.
- **Verification:** `npm run docs:check`
- **Evidence:** `docs/DISCOVERY.md` section "Pinned surface"
- **Status:** DONE

---

## P1 -- Mechanism spike

### T-P1-001 -- Encode the finality boundary in contract form
- **Goal:** Build the smallest possible pair of contracts that proves: accepted does not settle, finalized does settle.
- **Files:** `contracts/decision_gate.py`, `contracts/finality_vault.py`
- **Acceptance:** gate records a bounded decision; gate emits an IC-to-IC message with the finality stage; vault re-reads the gate's final storage state before releasing.
- **Verification:** `npm run lifecycle` (proves it on chain)
- **Evidence:** `docs/evidence/live-lifecycle.json`, `tests/lifecycle/test_finality_boundary.py`
- **Status:** DONE -- proven on chain. The local-network suite that would have
  proved it offline (`tests/lifecycle/`) does not execute here; see "Suites that
  do not execute in this environment".

### T-P1-002 -- Prove the read-scope primitive
- **Goal:** Prove that a cross-contract read scoped to latest-final cannot observe a non-final decision.
- **Files:** `artifacts/vm-capabilities.json`, `docs/LIMITATIONS.md`
- **Acceptance:** a decision written in non-final state is invisible to the vault; the same decision becomes visible once final.
- **Verification:** `npm run docs:check`
- **Evidence:** `artifacts/vm-capabilities.json`
- **Status:** N/A -- **falsified by the network**. The scoped read does not
  return a refusal; it stops returning and the leader is killed with
  `Leader execution exceeded 600.000s`. An isolation run against a throwaway
  probe contract shows a plain cross-contract read answering in full while the
  final-scoped read of the same method never answers. The deployed pair
  therefore drops every use of `LATEST_FINALIZED` and enforces the boundary with
  the gate's promotion rule plus the appeal window. See `docs/LIMITATIONS.md`.

---

## P2 -- Contracts

### T-P2-001 -- Implement the action commitment
- **Goal:** Canonical, deterministic commitment over agent, recipient, amount, asset, policy, evidence digest, nonce, deadline.
- **Files:** `contracts/decision_gate.py`, `lib/commitments/commitment.ts`
- **Acceptance:** identical input produces identical intent hash in contract and in the TypeScript client.
- **Verification:** `npm run test:commitments`
- **Evidence:** `tests/unit/commitment.test.ts`, `docs/EVIDENCE.md`
- **Status:** DONE

### T-P2-002 -- Implement the hard invariant in the vault
- **Goal:** Settlement requires finalized decision + exact commitment binding + unused nonce + unexpired deadline + authorized caller.
- **Files:** `contracts/finality_vault.py`
- **Acceptance:** every guard independently rejects; fail-closed.
- **Verification:** `npm run test:attacks`
- **Evidence:** `tests/attacks/test_guards.py` -- 13 cases
- **Status:** DONE for every guard that decides from its own storage. The
  finality guard requires a cross-contract read, which the direct runner does
  not implement, so it is driven on chain by `npm run lifecycle` instead.

### T-P2-003 -- Implement one-time settlement and replay protection
- **Goal:** A settled action can never settle again; a used nonce can never be reused.
- **Files:** `contracts/finality_vault.py`
- **Acceptance:** first settlement succeeds, every subsequent attempt fails.
- **Verification:** `npm run test:attacks`, `npm run proof`
- **Evidence:** `tests/attacks/test_guards.py`, `tests/unit/guard.test.ts`
- **Status:** DONE

### T-P2-004 -- Implement the finality receipt
- **Goal:** Structured, machine-readable receipt emitted only by a successful settlement.
- **Files:** `contracts/finality_vault.py`, `lib/receipts/`
- **Acceptance:** receipt references action, decision, commitment fields, nonce, timestamps, status.
- **Verification:** `npm run lifecycle`
- **Evidence:** `docs/evidence/live-lifecycle.json` (settlement record, scope
  `FINALIZED_CAPABILITY`, `settlement_count: 1`), `app/receipts/[id]/page.tsx`
- **Status:** DONE

### T-P2-005 -- Optional scenario registry
- **Goal:** Reusable policy templates so the product is a platform, not a single hardcoded demo.
- **Files:** `contracts/scenario_registry.py`
- **Acceptance:** policies are versioned and hash-addressable; the gate binds a real policy hash.
- **Verification:** `npm run test:direct`
- **Evidence:** `tests/direct/test_scenario_registry.py`
- **Status:** DONE

---

## P3 -- Product flow

### T-P3-001 -- Lifecycle adapter
- **Goal:** One place that maps raw network status onto product states.
- **Files:** `lib/lifecycle/state.ts`, `lib/lifecycle/map.ts`
- **Acceptance:** no status string is interpreted anywhere else in the UI.
- **Verification:** `npm run test:unit`
- **Evidence:** `tests/unit/lifecycle.test.ts`
- **Status:** DONE

### T-P3-002 -- Transaction lifecycle client
- **Goal:** Persist transaction ids, poll lifecycle, never blind-resubmit on timeout.
- **Files:** `lib/genlayer/client.ts`, `lib/genlayer/transactions.ts`
- **Acceptance:** timeout is surfaced as still-pending, never as failure and never re-submitted.
- **Verification:** `npm run test:unit`
- **Evidence:** `tests/unit/lifecycle.test.ts` -- the timeout and
  uninitialised-status cases
- **Status:** DONE

### T-P3-003 -- Single primary journey
- **Goal:** create policy -> create action -> show evidence -> request judgment -> accepted -> wait -> finalized -> release -> receipt.
- **Files:** `app/console/`, `app/actions/`, `app/receipts/`
- **Acceptance:** journey works end to end from the UI; no other product category is offered.
- **Verification:** `npm run test:e2e`
- **Evidence:** `public/shots/`
- **Status:** DONE

---

## P4 -- Proof lab

### T-P4-001 -- Attack corpus
- **Goal:** twelve deterministic cases including binding, replay, duplicate delivery, expiry, wrong decision, malformed capability.
- **Files:** `tests/fixtures/cases.json`, `tests/attacks/`
- **Acceptance:** every case has expected outcome and machine-checked actual outcome.
- **Verification:** `npm run proof`
- **Evidence:** `docs/evidence/proof-report.json` -- 13/13 cases as expected,
  control PASS
- **Status:** DONE

### T-P4-002 -- Baseline, intervention and control arms
- **Goal:** a deliberate unsafe variant settles on the provisional stage; the product holds; the control changes the commitment after adjudication.
- **Files:** `contracts/control/unsafe_release.py`, `docs/PROOF.md`
- **Acceptance:** baseline loses funds under adversarial conditions; product does not.
- **Verification:** `npm run proof`
- **Evidence:** `docs/evidence/proof-report.json`
- **Status:** DONE

### T-P4-003 -- Evidence ledger generator
- **Goal:** generate `docs/CLAIMS.json` numbers from test output, never by hand.
- **Files:** `scripts/evidence.mjs`
- **Acceptance:** headline metrics come from machine output.
- **Verification:** `npm run evidence`
- **Evidence:** `docs/CLAIMS.json`
- **Status:** DONE

---

## P5 -- UI

### T-P5-001 -- Landing experience
- **Goal:** 20-second comprehension: contradiction, mechanism, live entry point.
- **Files:** `app/page.tsx`, `components/landing/`
- **Acceptance:** hero states the contradiction in one sentence; primary call to action starts the live protection run.
- **Verification:** `npm run test:e2e`
- **Evidence:** `public/shots/landing-*.png`
- **Status:** DONE

### T-P5-002 -- Operating console
- **Goal:** premium console showing state machine, commitment, lifecycle and locked funds.
- **Files:** `app/console/`, `components/console/`
- **Acceptance:** the provisional state is a first-class visual state and never offers a release action.
- **Verification:** `npm run test:e2e`
- **Evidence:** `public/shots/console-*.png`
- **Status:** DONE

### T-P5-003 -- Receipt document
- **Goal:** audit-grade printable receipt.
- **Files:** `app/receipts/[id]/page.tsx`
- **Acceptance:** printable, shareable, hash-anchored.
- **Verification:** `npm run test:e2e`
- **Evidence:** `public/shots/receipt-*.png`
- **Status:** DONE

---

## P6 -- Integration

### T-P6-001 -- Deployment script
- **Goal:** network check, chain id check, source check, deploy, artifact write, read verification.
- **Files:** `scripts/deploy.mjs`
- **Acceptance:** refuses to run on the wrong chain; writes `artifacts/deployment.json`.
- **Verification:** `npm run deploy:dry`
- **Evidence:** `artifacts/deployment.json`
- **Status:** DONE

### T-P6-002 -- Live lifecycle recording
- **Goal:** run one real action end to end on the target network and record transaction ids for every stage.
- **Files:** `scripts/lifecycle.mjs`, `docs/EVIDENCE.md`
- **Acceptance:** accepted transaction id and finalized transaction id both recorded with explorer links.
- **Verification:** `npm run lifecycle`
- **Evidence:** `docs/evidence/live-lifecycle.json` -- `outcome: complete`,
  seven recorded stages, and a deliberate in-window promotion refused with
  `APPEAL_WINDOW_OPEN`
- **Status:** DONE

### T-P6-003 -- Programmatic surface
- **Goal:** compact API so DEFINIT is infrastructure, not only a website.
- **Files:** `app/api/`
- **Acceptance:** the API constructs transactions and reads receipts; it never decides.
- **Verification:** `npm run test:unit`
- **Evidence:** `tests/unit/api.test.ts`
- **Status:** DONE

---

## P7 -- Responsive / accessibility

### T-P7-001 -- Viewport matrix
- **Goal:** no broken state at 320, 390, 768, 1440.
- **Files:** `tests/e2e/responsive.spec.ts`
- **Acceptance:** no horizontal scroll, no overlap, no clipped text, 44x44 touch targets.
- **Verification:** `npm run test:e2e`
- **Evidence:** `playwright-report/`
- **Status:** DONE

### T-P7-002 -- Keyboard, focus, reduced motion
- **Goal:** semantic headings, labelled controls, visible focus, reduced-motion honoured.
- **Files:** `tests/e2e/a11y.spec.ts`
- **Acceptance:** every interactive element reachable and labelled.
- **Verification:** `npm run test:e2e`
- **Evidence:** `playwright-report/`
- **Status:** DONE

---

## P8 -- Documentation

### T-P8-001 -- Core documents
- **Files:** `docs/DISCOVERY.md`, `docs/ARCHITECTURE.md`, `docs/PROOF.md`, `docs/EVIDENCE.md`, `docs/LIMITATIONS.md`, `docs/CLAIMS.json`, `docs/JUDGING_MAP.md`, `README.md`, `CONTRIBUTIONS.md`
- **Acceptance:** every public claim has an evidence reference; limitations are explicit.
- **Verification:** `npm run docs:check`
- **Evidence:** the documents themselves
- **Status:** DONE

### T-P8-002 -- Isolation audit
- **Goal:** prove no third-party project name or material appears anywhere shipped.
- **Files:** `scripts/audit-isolation.mjs`
- **Acceptance:** audit passes on the whole shipped tree.
- **Verification:** `npm run audit:isolation`
- **Evidence:** `docs/evidence/isolation-audit.json`
- **Status:** DONE

---

## P9 -- Deployment

### T-P9-001 -- Contracts on the target network
- **Goal:** deploy both contracts to Studio Next, chain 61997.
- **Acceptance:** addresses and deployment transaction hashes recorded.
- **Verification:** `npm run deploy`
- **Evidence:** `artifacts/deployment.json`, `npm run verify` reads all three
  contracts back
- **Status:** DONE

### T-P9-002 -- Frontend deployment
- **Goal:** public frontend build passing and deployed.
- **Acceptance:** production build succeeds; public URL recorded.
- **Verification:** `npm run build`, then a browser check against the live URL
- **Evidence:** `docs/EVIDENCE.md` (Frontend deployment, Wallet connection)
- **Status:** DONE -- https://definit-snowy.vercel.app
  built from https://github.com/0xkinno/definit with nine non-sensitive
  environment variables and no private key. Wallet connection verified in a
  real browser against the live URL.

---

## P10 -- Submission

### T-P10-001 -- Final checklist
- **Files:** `README.md`, `docs/EVIDENCE.md`
- **Acceptance:** every box in the submission checklist is either checked with evidence or explicitly blocked with a reason.
- **Verification:** `npm run verify:submission`
- **Evidence:** `docs/evidence/submission-check.json`
- **Status:** DONE

---

## Suites that do not execute in this environment

Two suites ship but cannot run on this machine. Both are recorded here rather
than quietly removed, because a test that has never run is not evidence.

| Suite | What blocks it | What covers the gap |
| --- | --- | --- |
| `tests/lifecycle/`, `tests/integration/` | The locally installed GenVM cannot encode this SDK generation's `Address` type. Deployment to the local network fails with `not calldata encodable Address(...)`. | The same boundary is exercised on chain: `npm run lifecycle` against Studio Next, recorded in `docs/evidence/live-lifecycle.json`. |
| Two guards in `tests/attacks/` | The direct runner does not implement cross-contract reads (the read returns `None`) and pins `gl.message` to the account that loaded the contract. | The finality guard is driven by `npm run lifecycle`; caller identity is attacked from the outside, as documented in `tests/attacks/test_guards.py`. |

## Blocked items and why

| Task | Blocker |
| --- | --- |
| -- | No task is currently blocked. T-P9-002 was unblocked by the hosting account and is now done. |

Every blocked task lists exactly which environment variable unblocks it in
`.env.local`.
