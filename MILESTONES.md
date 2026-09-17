# MILESTONES.md -- DEFINIT milestone ledger

A milestone is only marked reached when its evidence exists, and only for the
environment the evidence was produced in.

| # | Milestone | Exit condition | Evidence | Status |
| --- | --- | --- | --- | --- |
| M0 | Repository and isolation rules | Shipped tree cannot contain research material | `npm run audit:isolation` -- 119 files, 18 terms, clean | REACHED |
| M1 | Discovery | Contradiction recorded with source-level evidence | `docs/DISCOVERY.md` | REACHED |
| M2 | Mechanism spike | A decision is held until the appeal window closes | `docs/evidence/live-lifecycle.json` -- the in-window promotion is refused on chain | REACHED |
| M3 | Contract invariant | Every guard that decides from its own storage independently rejects | `tests/attacks/test_guards.py` -- 13 cases | REACHED |
| M4 | Direct suite | Registry, commitment, replay and malformed-input suites pass | `npm run test:direct` -- 7 tests | REACHED |
| M5 | Proof campaign | Baseline loses funds, product holds, control blocks on commitment mismatch | `npm run proof` -- 13/13 cases, control PASS | REACHED |
| M6 | Product flow | One human journey end to end in the browser | `npm run test:e2e` -- 102 assertions across four viewports | REACHED |
| M7 | Premium UI | Landing, console, receipt and proof surfaces complete | `public/shots/` -- 12 captures | REACHED |
| M8 | Live network | Contracts deployed, real lifecycle recorded | `docs/evidence/live-lifecycle.json` -- `outcome: complete` | REACHED |
| M9 | Evidence ledger | Headline numbers generated, never hand-written | `docs/CLAIMS.json` | REACHED |
| M10 | Documentation | Full document set present and internally consistent | `npm run docs:check` | REACHED |
| M11 | Submission | Checklist complete with evidence or explicit blocker | `npm run verify:submission` | REACHED |
| M12 | Unit corpus | The guard mirror and the commitment encoding agree with their tests | `npm run test:unit` -- 38 tests | REACHED |

## Blocker notes

**T-P9-002 (frontend hosting)** is the one task still blocked. The production
build passes; publishing it needs a hosting account this environment does not
hold. Nothing on chain depends on it.

**M2** is reached on chain rather than locally. The local-network suite that
would have proved the same boundary offline (`tests/lifecycle/`) cannot execute
in this environment: the GenVM build installed here rejects this SDK
generation's `Address` type with `not calldata encodable Address(...)` during
deployment. The on-chain lifecycle is the stronger evidence anyway, because it
runs under real consensus rather than a simulator.

**M3** covers every guard that decides from its own storage. The finality guard
is reached through a cross-contract read, which the direct runner does not
implement, so it is driven by `npm run lifecycle` instead. The suite says this
in its own docstring rather than leaving the gap implicit.
