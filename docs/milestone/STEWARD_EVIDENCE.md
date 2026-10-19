# Steward evidence: DEFINIT Milestone v1

Written for the steward's request for the repository, an exact base...head comparison from the last rewarded revision, pinned source links for the new gate, vault and registry, and the application calls that exercise finalized-message release. It answers three questions, in this order: what is new compared with what was rewarded (overlap), whether the new contracts exist, are the code on chain, and are driven by the application (functionality), and whether the change is substantial (materiality).

Every source link below is a permalink pinned to a full 40-character commit SHA with a line range. The ranges are found by searching the file at that SHA for the function named and are recorded, first and last line included, in `docs/evidence/milestone/steward-links.json` (added by the evidence commit). Every number is read from a generated file under `docs/evidence/milestone/`.

## Repository and comparison

- Repository: https://github.com/0xkinno/definit
- **Base, the last rewarded revision:** `b903f9423b46dfa45e87ac8db7d8d48edc167119` (`b903f94`, 2026-09-20), tag `agent-tank-accepted`. [Commit](https://github.com/0xkinno/definit/commit/b903f9423b46dfa45e87ac8db7d8d48edc167119). It is the head of `main` when DEFINIT was accepted.
- **Code head, the milestone code:** `2b45ea5e34d17aa6e89045bff94df9405a139a79` (`2b45ea5`, 2026-10-18), tag `milestone-v1-code`. [Commit](https://github.com/0xkinno/definit/commit/2b45ea5e34d17aa6e89045bff94df9405a139a79). It is the last commit that changes code.
- **Full comparison:** https://github.com/0xkinno/definit/compare/b903f9423b46dfa45e87ac8db7d8d48edc167119...2b45ea5e34d17aa6e89045bff94df9405a139a79
- Every pinned source link below uses `2b45ea5`, except the links to the accepted v0 code, which use the base SHA and say so.
- GitHub truncates large diffs (this one is 170 files), so the contract files are listed one by one in the next table, each with its own permalink.

Base to first milestone commit, from `git log --format='%H %ad %s' --date=iso 1286058^..18562cf`; `18562cf` is the first milestone commit and nothing sits between it and the base:

```text
18562cf64eebb3b36efabd87b9798668fe8f6e52 2026-10-17T13:26:10+01:00 Milestone 2 phase 0: baseline record and measured network matrix
b903f9423b46dfa45e87ac8db7d8d48edc167119 2026-09-20T19:22:42+01:00 Wallet: switch to GenLayer Studio Next automatically, and offer the network configuration when the wallet does not have it
7c728064195b58df852d6b26a5214f5e6f43dd00 2026-09-20T18:53:54+01:00 Repair public demo truth: capability-gated signing, generated proof counts, fresh final-scope probe, accessible page outline
12860583ab0433fe734013a49661dfd06abd1f60 2026-09-17T16:39:59+01:00 README: link the product film; keep all film production work out of the repository
```

**The evidence commit is docs-only in effect.** It is the commit that adds this file, on top of `2b45ea5`. Its changed paths, from `git status --porcelain` at the moment this document was generated:

```text
README.md
scripts/gen-docs.mjs
docs/evidence/milestone/code-match.json
docs/evidence/milestone/diff-summary.json
docs/evidence/milestone/steward-links.json
docs/evidence/milestone/steward-repro.json
docs/milestone/STEWARD_EVIDENCE.md
scripts/steward-code-match.mjs
scripts/steward-diff.mjs
scripts/steward-evidence.mjs
```

None of these is under `contracts/`, `app/`, `lib/`, `components/`, `packages/`, `tests/`, `skills/` or `examples/`. The only non-documentation paths are the three evidence scripts `scripts/steward-*.mjs`, which read git and the network and change nothing, and a one-line text edit in `scripts/gen-docs.mjs` that keeps the README link regenerable. This differs from a pure documentation diff in that one respect.

### The milestone contracts, file by file

| File | Kind | Lines |
| --- | --- | --- |
| [`contracts/v1/build/decision_gate.min.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/build/decision_gate.min.py) | generated build | 263 |
| [`contracts/v1/build/decision_gate.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/build/decision_gate.py) | generated build | 680 |
| [`contracts/v1/build/finality_vault.min.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/build/finality_vault.min.py) | generated build | 240 |
| [`contracts/v1/build/finality_vault.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/build/finality_vault.py) | generated build | 528 |
| [`contracts/v1/build/scenario_registry.min.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/build/scenario_registry.min.py) | generated build | 60 |
| [`contracts/v1/build/scenario_registry.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/build/scenario_registry.py) | generated build | 123 |
| [`contracts/v1/core/vault_model.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/core/vault_model.py) | hand-written | 117 |
| [`contracts/v1/decision_gate.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/decision_gate.py) | hand-written | 680 |
| [`contracts/v1/finality_vault.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py) | hand-written | 528 |
| [`contracts/v1/scenario_registry.py`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/scenario_registry.py) | hand-written | 123 |

## Overlap

**The rewarded v0 contracts are byte-identical at head; the milestone contracts are new files under `contracts/v1/`.**

```text
$ git diff --stat b903f94..2b45ea5 -- contracts/decision_gate.py contracts/finality_vault.py contracts/scenario_registry.py contracts/control/
(no output)
```

`scripts/steward-diff.mjs` writes the figures below to `docs/evidence/milestone/diff-summary.json` (added by the evidence commit). 170 files changed: 149 added, 21 modified, 0 deleted, in 10 commits. Hand-written and generated files are counted apart so evidence JSON is not mistaken for code volume. Counts ignore end-of-line changes; see the note after the modified-file table.

| Area | Hand-written files | Hand-written lines | Generated files | Generated lines |
| --- | --- | --- | --- | --- |
| `contracts/v1/` | 4 (4 new, 0 modified) | +1,448 / -0 | 6 | +1,894 |
| `lib/` | 3 (2 new, 1 modified) | +187 / -4 | 2 | +901 |
| `app/` | 5 (2 new, 3 modified) | +400 / -70 | 0 | +0 |
| `components/` | 3 (2 new, 1 modified) | +278 / -1 | 0 | +0 |
| `packages/definit-guard/` | 8 (8 new, 0 modified) | +499 / -0 | 0 | +0 |
| `skills/` | 2 (2 new, 0 modified) | +39 / -0 | 0 | +0 |
| `examples/` | 1 (1 new, 0 modified) | +74 / -0 | 0 | +0 |
| `scripts/` | 31 (27 new, 4 modified) | +3,548 / -2 | 0 | +0 |
| `tests/` | 19 (16 new, 3 modified) | +3,375 / -2 | 1 | +4,085 |
| `docs/` | 17 (14 new, 3 modified) | +765 / -1 | 53 | +13,147 |

Totals ignoring end-of-line changes: 10,945 lines added and 88 removed in hand-written files; 20,281 added in generated files (evidence JSON, builds, lockfile, measured profiles). Files outside the listed areas: 15 (`.gitignore`, `MILESTONES.md`, `README.md`, `artifacts/deployment-v1.json`, `artifacts/fee-donor.json`, `fee-profile.json`, `package-lock.json`, `package.json`, `public/demo/delivery-742-injected.txt`, `requirements.txt`, `research/spike/payer.py`, `research/spike/probe.py`, `research/spike/spike_judge.py`, `research/spike/spike_sink.py`, `vitest.config.ts`).

### Files that existed at base and were modified

| File | What changed |
| --- | --- |
| `.gitignore` | ignores the private reference/ folder and tracks research/spike; the rest is a line-ending rewrite |
| `MILESTONES.md` | adds the Milestone v1 rows (generated block) |
| `README.md` | adds the Milestone v1 section (generated block) and v0 baseline notes |
| `app/console/page.tsx` | now renders the v1 console; the accepted console moved to app/console/v0/page.tsx with its title and eyebrow relabelled as v0 |
| `app/page.tsx` | landing hero rewritten to state the problem and show the generated proof line |
| `app/proof/page.tsx` | adds the live v1 contract addresses and the refusal breakdown, both read from generated data |
| `components/Shell.tsx` | adds the Milestone v1 navigation item and a 44px brand-link touch target |
| `docs/ARCHITECTURE.md` | adds the v1 architecture section (generated block) |
| `docs/JUDGING_MAP.md` | adds the Milestone v1 criteria table (generated block) |
| `docs/LIMITATIONS.md` | adds the Milestone v1 limits (generated block) and a v0 note on the fee blob; line endings also normalized |
| `lib/commitments/commitment.ts` | adds the v1 decision-id domain, lets amount be a bigint or string (found by the parity suite), and lets decisionIdOf take a domain |
| `package-lock.json` | lockfile for the new workspace and pinned toolchain dependencies; line endings normalized |
| `package.json` | adds the v1 scripts, the packages/* workspace and the pinned Transaction Kit packages |
| `scripts/audit-isolation.mjs` | excludes the private reference/ folder from the shipped-tree audit |
| `scripts/docs-check.mjs` | adds a check that no current document presents the v0 appeal-window constant as live behaviour |
| `scripts/run-python.mjs` | adds a default local runner hash and a pinned interpreter for the direct-mode suites |
| `scripts/validate-contracts.mjs` | also compiles the three v1 contracts on the network before deployment |
| `tests/e2e/a11y.spec.ts` | adds the /console/v0 route |
| `tests/e2e/production.spec.ts` | points the accepted-console test at /console/v0 |
| `tests/e2e/responsive.spec.ts` | adds the /console/v0 route and exempts the visually hidden skip link from the touch-target check |
| `vitest.config.ts` | includes the definit-guard package tests |

**End-of-line note.** 8 of these files were rewritten with different line endings, so a raw count shows far more changed lines than changed: `.gitignore` (raw +81/-77, real +5/-1); `app/page.tsx` (raw +413/-408, real +17/-12); `docs/LIMITATIONS.md` (raw +142/-121, real +22/-1); `package-lock.json` (raw +6839/-6719, real +121/-1); `package.json` (raw +92/-63, real +35/-6); `scripts/docs-check.mjs` (raw +291/-281, real +11/-1); `scripts/run-python.mjs` (raw +171/-159, real +13/-1); `scripts/validate-contracts.mjs` (raw +139/-135, real +4/-0). Raw totals are 39,168 added and 8,031 removed; the figures above ignore that churn. The history was not rewritten to remove it.

### Commits, `b903f94..2b45ea5`

| SHA | Date | Subject |
| --- | --- | --- |
| [`18562cf64eebb3b36efabd87b9798668fe8f6e52`](https://github.com/0xkinno/definit/commit/18562cf64eebb3b36efabd87b9798668fe8f6e52) | 2026-10-17 | Milestone 2 phase 0: baseline record and measured network matrix |
| [`d919b31fa90ae7c744291c23998416b95add2971`](https://github.com/0xkinno/definit/commit/d919b31fa90ae7c744291c23998416b95add2971) | 2026-10-17 | Milestone 2 phase 0B: mechanism spike, discovery record and passed gate |
| [`c4096a6e9d79b9b3fe8df41100a54af935fad531`](https://github.com/0xkinno/definit/commit/c4096a6e9d79b9b3fe8df41100a54af935fad531) | 2026-10-17 | Milestone 2 phase 1: v2 contracts, release authority moved to protocol-delivered finalized messages |
| [`a16ea42451a3dfaaab31fa47c3c490f558aad525`](https://github.com/0xkinno/definit/commit/a16ea42451a3dfaaab31fa47c3c490f558aad525) | 2026-10-17 | Milestone 2 phase 2: invariant suite, v2 corpus and offline verifier |
| [`b7d448d2c3f0e2f5a0d2a5ec4f1d4e5fc5599890`](https://github.com/0xkinno/definit/commit/b7d448d2c3f0e2f5a0d2a5ec4f1d4e5fc5599890) | 2026-10-17 | Milestone 2 phase 4: counterfactual, fault matrix and v1 differential |
| [`f16d00cd4af93d4233b91da741bdbcc73b065a93`](https://github.com/0xkinno/definit/commit/f16d00cd4af93d4233b91da741bdbcc73b065a93) | 2026-10-17 | Milestone 2 phase 6: milestone page, finality clock and public proof corrections |
| [`833470b36de4d9064b5a4e8fb6712826cad200cc`](https://github.com/0xkinno/definit/commit/833470b36de4d9064b5a4e8fb6712826cad200cc) | 2026-10-17 | Milestone 2 phase 7: delta record, integration map and regenerated docs |
| [`da914934af6ad277ee7404e5ae0d8769b0c804e3`](https://github.com/0xkinno/definit/commit/da914934af6ad277ee7404e5ae0d8769b0c804e3) | 2026-10-17 | Milestone 2 phase 8: production deployment verified against the public URL |
| [`24a5887c988de159549fa1ecead8f3fbec87e0f9`](https://github.com/0xkinno/definit/commit/24a5887c988de159549fa1ecead8f3fbec87e0f9) | 2026-10-18 | Rename: original build is v0, milestone is v1 (frozen on-chain labels documented) |
| [`2b45ea5e34d17aa6e89045bff94df9405a139a79`](https://github.com/0xkinno/definit/commit/2b45ea5e34d17aa6e89045bff94df9405a139a79) | 2026-10-18 | Milestone v1 adoption and verification: fee profile and Transaction Kit, definit-guard and agent skill, v1 console, mutation sweep, parity suite, books, injected-evidence run |

Subjects written before commit `24a5887` call the milestone "Milestone 2" and "v2". See the naming map.

### Naming map

| Where | Label | Meaning |
| --- | --- | --- |
| Repository and docs | **v0** | the accepted, rewarded build; contracts at `contracts/*.py` |
| Repository and docs | **v1** | this milestone; contracts at `contracts/v1/*.py`; scripts `*-v1.*`; runs `v1-run-R*.json` |
| On-chain `describe().version` and the docstring headers of the three deployed v1 contracts | `v2` | the milestone. For example the header of [contracts/v1/scenario_registry.py](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/scenario_registry.py#L6-L14) reads `DEFINIT v2 -- ScenarioRegistry` |
| Inside those same docstrings | `v1` | the accepted build (v0 in the repository). The registry header says "The v1 policy registry with identical behaviour" |
| Hash tag `DEFINIT-DECISION-v2` | `v2` | the milestone's decision-id domain, so a v0 and a v1 decision id cannot collide |
| Hash tags `DEFINIT-COMMITMENT-v1`, `-ACTION-v1`, `-POLICY-v1`, `-EVIDENCE-v1` | `v1` | the encoding version, byte-identical in both builds (proved by the parity suite) |
| Commit subjects before `24a5887` | "Milestone 2", "v2" | the milestone, before the rename |

Commit `24a5887` renamed the accepted build to v0 and the milestone to v1 in the repository. The labels inside the deployed contracts were not edited because editing them would change the deployed bytes, and the deployed bytes are what the code-match check below compares.

## Functionality

All links in this section are pinned to `2b45ea5` unless marked **base**.

### New gate, `contracts/v1/decision_gate.py`

- [`request_adjudication`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/decision_gate.py#L538-L574): adjudicates the evidence, then calls `_record_outcome`. It refuses unless the escrow is already open and funded.
- [`_record_outcome`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/decision_gate.py#L597-L668), and within it [the two branches](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/decision_gate.py#L647-L666). On APPROVE the deciding transaction schedules `vault.emit(on='finalized').authorize_release(...)`; on REJECT it schedules `vault.emit(on='finalized').close_refused(...)`. One message per outcome, both on the finalized stage.
- **No timer, no promotion step.** [The header](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/decision_gate.py#L20-L27) states it. Counts at head: `APPEAL_WINDOW_SECONDS` appears 0 times in the v1 gate and 0 in the v1 vault; `def finalize_decision` appears 0 times and `def settle` 0 times. At **base** the gate defined [`APPEAL_WINDOW_SECONDS = 120`](https://github.com/0xkinno/definit/blob/b903f9423b46dfa45e87ac8db7d8d48edc167119/contracts/decision_gate.py#L122) and [`finalize_decision`](https://github.com/0xkinno/definit/blob/b903f9423b46dfa45e87ac8db7d8d48edc167119/contracts/decision_gate.py#L684-L740), the agent-sent promotion step.
- [`describe()`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/decision_gate.py#L435-L449) returns `finality_rule: protocol-finalized-delivery`, `settlement_message_stage: finalized` and `clock: none`.
- **A gap, stated plainly.** [The measured constraints](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/decision_gate.py#L29-L37) record that `emit(on='accepted')` raised an execution error in the VM under the pinned runner, so the gate does **not** emit an accepted-stage (provisional) notice. The vault's gate-only `note_provisional` exists and is tested in direct mode only. The record is the observation O5 in [`spike/findings-session1.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/spike/findings-session1.json); the offline verifier lists it under invariant I5.

### New vault, `contracts/v1/finality_vault.py`

- [Header](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L15-L41): the claim, release authority as a delivery, and the liveness paths.
- [`open_escrow`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L257-L300): the commitment fields come from the funder's own arguments and are checked against the action the gate registered. The gate is read once, here, as a consistency check; it is not release authority.
- `authorize_release`, [whole function](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L351-L462), with each guard separately:
  - [sender must be the bound gate](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L368-L370) (`gl.message.sender_address != self.gate` refuses with `UNAUTHORIZED_SENDER`)
  - [a duplicate delivery is a recorded no-op](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L376-L381)
  - [a release after the deadline does not release; it routes the escrow to a refund](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L383-L391)
  - [delivered fields are compared and the commitment is recomputed by the vault](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L393-L416)
  - [the transfer is emitted on the finalized stage](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L451-L453)
- [`close_refused`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L465-L482): a finalized refusal closes the escrow to the funder. Gate-only.
- [`withdraw_refund`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L485-L500) and [`reclaim_after_deadline`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L503-L528): the liveness path. Both are funder-only and both only send value back to the funder.
- **Time comparisons in the vault.** There are three, all deny-only or return-to-funder: `open_escrow` refuses a deadline that is not in the future, `authorize_release` routes a late delivery to a refund, and `reclaim_after_deadline` lets the funder take value back after the deadline. None authorizes a release to the recipient. `scripts/check_no_clock.py` fails the build otherwise; its result is in [`no-clock-check.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/no-clock-check.json).
- **No funder-callable release.** At head there is no `settle` and no method that releases on a caller's request (`def settle` count above). At **base** the vault's [`settle`](https://github.com/0xkinno/definit/blob/b903f9423b46dfa45e87ac8db7d8d48edc167119/contracts/finality_vault.py#L342-L504) admitted the funder: [the caller set included the funder](https://github.com/0xkinno/definit/blob/b903f9423b46dfa45e87ac8db7d8d48edc167119/contracts/finality_vault.py#L366-L373), and the window was checked by [a clock comparison](https://github.com/0xkinno/definit/blob/b903f9423b46dfa45e87ac8db7d8d48edc167119/contracts/finality_vault.py#L422-L427).

### Registry, `contracts/v1/scenario_registry.py`

Modest by design: behaviour and content hash are identical to v0, so it is not new functionality. The hash formula is the same line at base and head (`_keccak_hex(POLICY_DOMAIN + '|' + text)`, domain `DEFINIT-POLICY-v1`). The change is storage: records are JSON strings in a `TreeMap[str, str]` instead of a typed storage class. The reason is stated [in the vault](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/finality_vault.py#L137-L141): typed storage classes need a decorator whose name differs between the linter's SDK and the runner the network executes, and the network rejects the linter's spelling. [Registry header](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/scenario_registry.py#L6-L14); [`publish_policy`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/contracts/v1/scenario_registry.py#L44-L68). The never-incremented `uses` counter of the v0 record is not carried over.

### Deployed bytes are the committed code

`scripts/steward-code-match.mjs` fetches each deployed contract with `gen_getContractCode` on Studio-dev (chain 61997), hashes it, and compares it with the files at `2b45ea5`. Result in `docs/evidence/milestone/code-match.json` (added by the evidence commit): **all three match**.

| Contract | Address | Deployed | Equals the file(s) at 2b45ea5 |
| --- | --- | --- | --- |
| ScenarioRegistry | [`0x8DC63918…F895DF`](https://explorer-studio-dev.genlayer.com/address/0x8DC63918F88dcc719397a39730C1b31A1cF895DF) | `0x9be6052477f5666e…` (3359 bytes) | `contracts/v1/build/scenario_registry.py`, `contracts/v1/scenario_registry.py` |
| FinalityVault | [`0x61c1CfA2…9EAdf5`](https://explorer-studio-dev.genlayer.com/address/0x61c1CfA242521936214ebf5510b6E3AA6E9EAdf5) | `0x4ff9a12fa7ad8fe0…` (18380 bytes) | `contracts/v1/build/finality_vault.py`, `contracts/v1/finality_vault.py` |
| DecisionGate | [`0xA03C1884…4bF889`](https://explorer-studio-dev.genlayer.com/address/0xA03C1884F2dFf591388B85840F264c93EE4bF889) | `0xcd3b7e36070e539e…` (21932 bytes) | `contracts/v1/build/decision_gate.py`, `contracts/v1/decision_gate.py` |

**This differs from an assumption that the minified build is what runs.** The deployed bytes equal the readable build and readable source. The minified builds (`contracts/v1/build/*.min.py`, made by [`scripts/build-contracts.mjs`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/build-contracts.mjs)) compile on the network (`npm run contracts:check`) but were not deployed. Deployment record: [`artifacts/deployment-v1.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/artifacts/deployment-v1.json), deployed 2026-10-17T13:13:58.919Z.

### Application calls that exercise finalized-message release

| Where | Calls | Place in the flow |
| --- | --- | --- |
| [`openGuardedPayment`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/payments.ts#L12-L49) (`definit-guard`) | `create_action`, `open_escrow` (exact value), `request_adjudication` | opens a payment; the adjudication is sent with both message branches funded |
| [`settled`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/payments.ts#L70-L87) and [`receipt`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/payments.ts#L52-L64) | `gen_getTransactionLifecycle`, then `get_escrow` and `get_receipt` | waits for Finalized, then for the vault; `paid` is true only if the vault is SETTLED and holds a receipt |
| [`contest`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/payments.ts#L90-L96), [`refund`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/payments.ts#L99-L108) | `getAppealCharge`, `appealTransaction`; `withdraw_refund`, `reclaim_after_deadline` | appeal an Accepted verdict; the funder's way home |
| [`kitContext`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/kit.ts#L43-L88), [`withMessageAllocations`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/kit.ts#L24-L41) | Transaction Kit `estimate`, then `writeContract` with one fee allocation per emitted message | fee quote and verification; funds the finalized release message |
| [`finalityOf`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/finality.ts#L11-L17), [`watchFinality`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/packages/definit-guard/src/finality.ts#L28-L42) | lifecycle snapshots | the rule: only `Finalized` is final |
| [`runPayment`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L188-L354) in `scripts/lib/v1-flow.mjs` | the whole lifecycle that produced runs R1, R2, R3 and R5: [propose](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L215-L225), [fund](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L227-L231), [adjudicate](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L234-L239), [appeal](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L261-L271), [find the child the protocol created](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L273-L276), [record the delivery](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L298-L308), [refund](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L328-L340) | the scripted payment behind every recorded run |
| [`write`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/scripts/lib/v1-flow.mjs#L114-L124) | any write | the success check: `txExecutionResultName === "FINISHED_WITH_RETURN"` |
| [`propose`, `fund`, `adjudicate`, `contest`, `withdraw`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/components/console/V1Console.tsx#L86-L119) in the v1 console, [`send`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/components/console/V1Console.tsx#L71-L78), [`quoteWrite`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/lib/v1/console.ts#L43-L50), [`submitQuoted`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/lib/v1/console.ts#L56-L65) | the same contract methods, signed by the user's wallet | the web path; [the console polls](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/components/console/V1Console.tsx#L48-L64) the lifecycle and the vault, and [`readLifecycle`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/lib/v1/console.ts#L76-L85) calls `gen_getTransactionLifecycle` |
| [run list](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/app/milestone/page.tsx#L81-L102) and [`FinalityClock`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/components/milestone/FinalityClock.tsx#L12-L69) on `/milestone` | none (renders recorded runs) | the finality clock for each recorded payment, drawn from chain timestamps |

Notes where this differs from an assumption: the wallet step module `lib/wallet/steps.ts` is unchanged from base and still drives the accepted v0 flow (the v0 console at `/console/v0`); the v1 wallet calls are in `components/console/V1Console.tsx` and `lib/v1/console.ts`. There is no call to a function named `isSuccessful`; success is judged by `txExecutionResultName` (above) and by `scripts/lib/run-checks.mjs`. The lifecycle is read through the raw RPC (`gen_getTransactionLifecycle` with `{ txId }`) because the SDK's typed wrapper sends `{ hash }`, which this endpoint does not accept (spike observation O1).

### One release, end to end, on Studio-dev (chain 61997)

Source: [`v1-run-R1.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/v1-run-R1.json) (APPROVE) and [`v1-run-R2.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/v1-run-R2.json) (REJECT and refund). Contracts: gate [`0xA03C1884…4bF889`](https://explorer-studio-dev.genlayer.com/address/0xA03C1884F2dFf591388B85840F264c93EE4bF889), vault [`0x61c1CfA2…9EAdf5`](https://explorer-studio-dev.genlayer.com/address/0x61c1CfA242521936214ebf5510b6E3AA6E9EAdf5), registry [`0x8DC63918…F895DF`](https://explorer-studio-dev.genlayer.com/address/0x8DC63918F88dcc719397a39730C1b31A1cF895DF).

**R1, APPROVE**

| Step | Transaction | Status and chain time |
| --- | --- | --- |
| `create_action` | [`0xbbcc412515…f2aea8`](https://explorer-studio-dev.genlayer.com/tx/0xbbcc412515528511beb4c82b1b63f319b5fe8789b3d0ee1f177fd345e6f2aea8) | accepted |
| `open_escrow` | [`0x1f93f51bbc…448759`](https://explorer-studio-dev.genlayer.com/tx/0x1f93f51bbc065598b028c96e9fca58fea1653d8c471a90c38511f7a9d7448759) | escrow OPEN, 0.01 GEN |
| `request_adjudication` | [`0x97de9274e8…2bf3a4`](https://explorer-studio-dev.genlayer.com/tx/0x97de9274e8b549e5940e44d24eae347971b073c22e033cc7140a79eba42bf3a4) | verdict APPROVE (EVIDENCE_SATISFIES_POLICY); Accepted by chain time 1792248396 (t1); appeal deadline 1792248426; first lifecycle sample showing Finalized at chain time 1792248431 (t2) |
| `authorize_release` child, sender = gate | [`0x88935bfa38…75e494`](https://explorer-studio-dev.genlayer.com/tx/0x88935bfa38c3b996cadb46b2d20fca517944a8580177319757ff2af95575e494) | from [`0xA03C1884…4bF889`](https://explorer-studio-dev.genlayer.com/address/0xA03C1884F2dFf591388B85840F264c93EE4bF889) (the gate), to the vault, `triggered_by` the adjudication transaction; created at 1792248426 (t3); status FINALIZED, FINISHED_WITH_RETURN |
| transfer to the recipient | message in the child's `messages`: 0.01 GEN to `0x1111111111111111111111111111111111111111`, `onAcceptance: false` | emitted on the finalized stage |
| receipt read | `get_receipt` on the vault (a read, no transaction) | status SETTLED, `finality_source: protocol-delivery`, `delivered_by` the gate, `message_stage: finalized` |

**The child transaction that released the money was created only after the adjudication transaction survived its appeal window, and its sender is the gate contract.** The record contains: the chain's appeal deadline for the decision (1792248426); the child's creation time (1792248426), which is at or after that deadline (here equal to it); the child's `from_address`, which equals the gate address; and the lifecycle samples, which show the decision still Accepted and active at chain times 1792248396, 1792248408, 1792248419 and Finalized at 1792248431. The poll interval is about ten seconds, so 1792248431 is an upper bound for t2, not the exact instant of finalization; the exact boundary is the appeal deadline. The vault samples show OPEN while the status was Accepted and SETTLED afterwards. The offline verifier re-derives the ordering for every recorded run (check V4 and V7 in [`offline-verification.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/offline-verification.json)).

**R2, REJECT then refund**

| Step | Transaction | Status and chain time |
| --- | --- | --- |
| `create_action` | [`0xf72af78f95…1cce03`](https://explorer-studio-dev.genlayer.com/tx/0xf72af78f95010e94b0f2fd49024798ec7acbac60a4d6daa09970d9be021cce03) | accepted |
| `open_escrow` | [`0xdea9126568…7ff284`](https://explorer-studio-dev.genlayer.com/tx/0xdea9126568dd417f7c8a2a6dd5507de12868afaac94259c68c5c0395f77ff284) | escrow OPEN |
| `request_adjudication` | [`0x5fb1e07e04…00f21d`](https://explorer-studio-dev.genlayer.com/tx/0x5fb1e07e04667263d949af3c445440e38fb9f29bd0c7ac311546a4b2d800f21d) | verdict REJECT (POLICY_VIOLATION); Accepted by 1792248517; appeal deadline 1792248544; Finalized sample at 1792248552 |
| `close_refused` child, sender = gate | [`0x3f9c9bc70f…1300ec`](https://explorer-studio-dev.genlayer.com/tx/0x3f9c9bc70f78d8b665616f1ddd33528909d82b91447aa4e9ba9032b34e1300ec) | from [`0xA03C1884…4bF889`](https://explorer-studio-dev.genlayer.com/address/0xA03C1884F2dFf591388B85840F264c93EE4bF889) (the gate); created at 1792248545 (at or after the deadline 1792248544); FINISHED_WITH_RETURN; escrow REFUNDABLE |
| `withdraw_refund` by the funder | [`0xb06865ae6f…7d8e50`](https://explorer-studio-dev.genlayer.com/tx/0xb06865ae6ff48a1eaaa899625353483eb986c0adaebd4f09b3051c56c37d8e50) | escrow WITHDRAWN; transfer of 0.01 GEN to the funder |
| receipt read | `get_receipt` | `exists: false`, `reason_code: ESCROW_UNKNOWN`: there is no release receipt because nothing was released |

Studio-dev did not credit a transfer a contract emits ([`transfer-credit-probe.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/transfer-credit-probe.json)), so a balance is not evidence here; the evidence is the emitted transfer message plus the vault's state and receipt.

## Materiality

- v0 released value after a hard-coded 120-second timer plus an agent-sent promotion; v1 releases only on a protocol finalized-stage delivery from the deciding transaction. [`docs/milestone/DELTA.md`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/milestone/DELTA.md), [`docs/milestone/PROOF_V1.md`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/milestone/PROOF_V1.md)
- v0 let the funder call `settle` against gate state that could still be appealed; v1 has no caller-triggered release, and the same attempt could not be constructed against it. [`h1-differential.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/h1-differential.json), [`docs/milestone/FINDING.md`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/milestone/FINDING.md)
- Liveness: the funder can reclaim after the deadline and withdraw after a refusal, so funds are not stranded; the vault's states are specified in a document that a test reads. [`docs/milestone/VAULT_STATE_MACHINE.md`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/milestone/VAULT_STATE_MACHINE.md), [`property.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/property.json)
- Property testing: 3,000 random lifecycles over 3 seeds (13,388 events) checked against a pure model of the vault, and 41 labelled cases with 27 refusals. [`property.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/property.json), [`proof-v1-report.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/proof-v1-report.json)
- Mutation sweep: 16 of 16 single-guard mutants of the vault were caught by a test, 0 survived. [`mutation.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/mutation.json)
- Parity suite: the TypeScript commitment code and the Python contracts hash 240 seeded vectors identically; it found that amounts above 2^53 were unsafe as numbers, now fixed. [`tests/unit/parity.test.ts`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/tests/unit/parity.test.ts)
- Books: 7 recorded escrows reconcile, in equals out plus held. [`books.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/books.json)
- Offline verifier: 8 checks pass, 0 fail, 0 not evidenced, re-deriving hashes and ordering from recorded runs. [`offline-verification.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/offline-verification.json)
- Four-arm counterfactual over 13 recorded timelines, unsafe payments: pay on Accepted 13/13, fixed timer 0/13, v0 rule 0/13, v1 0/13; v0's funder path 3/3. [`counterfactual.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/counterfactual.json)
- Adoption: the `definit-guard` package, an agent skill, a fee profile through the Transaction Kit, and a live agent run that ended PAID with a vault receipt ([`0xaef9b09b63…b160d0`](https://explorer-studio-dev.genlayer.com/tx/0xaef9b09b635c95b6cea10bf8bebb8d49f88bc55ac8a6bb002043cba1bcb160d0)). [`agent-run-approve.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/agent-run-approve.json), [`agent-run-kit-submit-finding.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/agent-run-kit-submit-finding.json) (a failure we found and fixed: the Kit's own submit cannot fund an emitted message)

**Honest limits.**
- The milestone ran only on Studio-dev (chain 61997). Bradbury was not used: its lifecycle method did not answer on the probed host and the probe account could not be funded (its faucet needs a wallet holding mainnet ETH). Studionet answered but did not execute contracts. [`network-matrix.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/network-matrix.json), [`docs/milestone/NETWORK_DECISION.md`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/milestone/NETWORK_DECISION.md)
- The accepted-stage (provisional) notice was not shipped on chain, as described above.
- No appeal reversal was observed. In run R3 an appeal was submitted and recorded ([`0x49d5869ee4…74dbd8`](https://explorer-studio-dev.genlayer.com/tx/0x49d5869ee469a175836b0f59408d8173aae22e4bd1ed711ed2afb199d074dbd8), bond 0.05000500000000879 GEN); the verdict stayed APPROVE at attempt 1, and the release followed finality. [`v1-run-R3.json`](https://github.com/0xkinno/definit/blob/2b45ea5e34d17aa6e89045bff94df9405a139a79/docs/evidence/milestone/v1-run-R3.json)
- The fee profile is measured by simulation with the Transaction Kit's profile format, not by a `gltest --fee-profile` run.

## Reproduce

From a clean clone at `2b45ea5e34d17aa6e89045bff94df9405a139a79`. These were run on a clean clone at that commit before this document was written; the last line of each is quoted.

```bash
git clone https://github.com/0xkinno/definit && cd definit && git checkout 2b45ea5e34d17aa6e89045bff94df9405a139a79
npm ci
npm run verify:offline
export GENLAYER_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111   # any throwaway value; direct mode never signs
npm run test:v1:direct
python3 scripts/check_no_clock.py
```

| Command | Last line of output | Needs |
| --- | --- | --- |
| `npm ci` | `added 370 packages in 3m` | network |
| `npm run verify:offline` | `8 pass, 0 fail, 0 not evidenced` | nothing (reads recorded evidence) |
| `npm run test:v1:direct` | `216 passed in 709.64s (0:11:49)` | the pinned Python toolchain in requirements.txt (a venv, or DEFINIT_PYTHON), and any value in GENLAYER_PRIVATE_KEY: gltest refuses to start without the variable, and direct mode never signs. The first run without it stopped with a gltest configuration error |
| `python3 scripts/check_no_clock.py` | `clock comparisons found: 5 across 3 files; PASS` | Python 3, standard library only |

Clean clone at `2b45ea5e34d17aa6e89045bff94df9405a139a79`, Windows 10, Node v24.14.1. The clone was made from a local copy of this repository checked out at that SHA, so its files are identical to the GitHub commit.
