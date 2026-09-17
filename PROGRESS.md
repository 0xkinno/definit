# PROGRESS.md -- DEFINIT build log

Newest entry first. Every entry states what changed, what was verified and what
remains unverified.

---

## 2026-09-17 -- Live deployment, live lifecycle, and the gates made real

**Changed**

- `contracts/decision_gate.py` and `contracts/finality_vault.py` rewritten to
  drop every use of `StorageView.LATEST_FINALIZED`. The boundary is now the
  gate's promotion rule (`APPEAL_WINDOW_OPEN`) plus the vault re-deriving the
  same window from the gate's own adjudication stamp.
- `lib/server/fees.ts` added. `sim_estimateTransactionFees` executes the call it
  prices, so the promotion and the release cannot be priced by simulation; the
  fee tree is built from the policy quote plus one recorded `feeParams` blob.
- `lib/server/runner.ts` gained `settle`, and the promotion now carries its
  message allocation.
- `app/api/actions/[id]/{adjudicate,escrow,finalize,settle,simulate}`,
  `app/api/policies`, `app/api/proof` added.
- `tests/attacks/` written: 13 guard cases against the real contract classes.
- `tests/e2e/responsive.spec.ts` and `tests/e2e/a11y.spec.ts` written.
- `app/{lab,proof,docs,receipts}/` surfaces and the lifecycle demo page added,
  with a labelled rehearsal fallback.

**Fixed**

- `tests/_sdk_compat.py` patched the wrong module. The published loader does
  `from .sdk_loader import setup_sdk_paths` inside the function body, so the
  replacement has to live on `sdk_loader`, not `loader`. Without this, the
  runner hash was never bridged and the entire direct suite failed. It passes
  now.
- `gltest.config.yaml` pointed its artifacts directory at `artifacts/`, which
  holds the deployment record. The test runner clears that directory on every
  run, so `npm run proof` had been deleting the deployment addresses and
  transaction hashes. Compiler scratch output now goes to
  `.gltest-home/gltest-artifacts`.
- `lib/guard/*.ts` name their relative imports with an explicit `.ts`
  extension, so `node scripts/proof.mjs` can execute the corpus directly
  instead of failing on Node's extensionless resolution.
- Three unit assertions were stale and are corrected to the shipped behaviour.
  The evidence-digest case asserted that trailing whitespace changes the
  digest, contradicting the documented normalisation; the lifecycle case
  expected an empty reading to be unresolved when it is a draft; the
  single-spend case drove the wrong corpus case, whose first delivery is
  already refused by design.

**Verified**

- `npm run contracts:check` -- 4 contracts compile on the live GenVM.
- `npm run deploy` -- 3 contracts deployed to Studio Next, wired, policy seeded.
- `npm run lifecycle` -- `outcome: complete`. Seven stages recorded, including a
  promotion attempted inside the appeal window on purpose and refused with
  `APPEAL_WINDOW_OPEN`, and a release that lands only after the window closes.
- `npm run verify` -- all three contracts answer a read; operator funded.
- `npm run test:attacks` -- 13/13. `npm run test:direct` -- 7/7.
  `npm run test:unit` -- 38/38. `npm run test:e2e` -- 102/102.
- `npm run proof` -- 13/13 corpus cases, control PASS.
- `npm run evidence`, `npm run docs:check`, `npm run audit:isolation` -- all
  pass.

**Not verified**

- `tests/lifecycle/` and `tests/integration/`: the local GenVM build cannot
  encode this SDK generation's `Address` type, so local-network deployment
  fails before any assertion runs. See `docs/LIMITATIONS.md`.
- Two of the release guards cannot be reached from the direct runner: the
  finality guard needs a cross-contract read, and caller identity cannot be
  assumed by the test. Both are documented in the suite itself.

**Known incident**

- The first `npm run proof` of this session cleared `artifacts/` before the
  configuration was corrected. `deployment.json`, `fee-template.json` and
  `live-lifecycle.json` were restored from the values recorded at deployment
  time (byte-for-byte identical, and the lifecycle record still lives in
  `docs/evidence/`). `vm-capabilities.json` was reconstructed as a structured
  restatement of the isolation run and now says so in its own `provenance`
  field.

---

## 2026-09-16 -- P0 to P8 build pass

**Changed**

- `research/` populated with upstream reference material and the sample-field
  survey. Excluded from version control.
- `research/SOURCES.md` and `research/SAMPLE_MATRIX.md` written from direct
  reading of specification and SDK source.
- `contracts/decision_gate.py`, `contracts/finality_vault.py`,
  `contracts/scenario_registry.py` implemented.
- `contracts/control/unsafe_release.py` implemented as the deliberate control.
- Direct, attack, lifecycle and receipt test suites written.
- Proof harness, evidence generator and isolation audit written.
- Next.js application implemented: landing, console, action composer, receipts,
  proof lab and programmatic API.
- Documentation set written.

**Verified**

- Contract source is consistent with the SDK import convention and public
  method annotations that the specification requires.
- The hard invariant is enforced inside the vault and re-checked on every
  settlement attempt.

**Not yet verified**

- Live behaviour on the target network. No funded wallet was available at build
  time.
- Browser-level checks. They run with `npm run test:e2e` once the toolchain is
  installed.

**Next**

- Fill `.env.local`, deploy, run `npm run lifecycle`, then `npm run evidence`
  to replace every headline number with machine-generated values.

---

## 2026-09-16 -- Repository initialised

- Structure created: `app/`, `components/`, `lib/`, `contracts/`, `tests/`,
  `scripts/`, `docs/`, `public/`, `research/`.
- `.gitignore` written with explicit research isolation.
- `.env.example` written with placeholders only.
