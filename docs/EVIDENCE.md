# Evidence

Every figure and hash below was produced by running a command in this repo
against the live network. Nothing here is transcribed from a terminal by hand:
the two machine-readable records are the source, and this document is a reading
of them.

| Record | Written by | Consumed by |
| --- | --- | --- |
| `artifacts/deployment.json` | `npm run deploy` | `lib/genlayer/contracts.ts`, this document |
| `artifacts/live-lifecycle.json` | `npm run lifecycle` | `docs/evidence/live-lifecycle.json` |
| `docs/evidence/proof-report.json` | `npm run proof` | `lib/evidence.ts`, the evidence page |
| `docs/evidence/isolation-audit.json` | `npm run audit:isolation` | `npm run verify:submission` |

## Deployment

GenLayer Studio Next, chain `61997`. Deployer
`0xe98ACBD5d8F02A92A5492b5830BA83ffBB684E7f`. Recorded at
`2026-09-17T08:04:02.577Z`.

| Contract | Address | Deployment transaction |
| --- | --- | --- |
| ScenarioRegistry | `0x6Fd7166897700335dF5134B078510336f59A1e41` | `0x5399a877031d6c08a2ec1883409287974e8b268a97d537ebd3e5dffa05693bc3` |
| FinalityVault | `0xf53291532749A568ecb5D0fC4F007cE29DFE2422` | `0xd7aa38282dd2ddf8d0393afc4a21259119c56067624b42a6fdc58a2c2ef30cff` |
| DecisionGate | `0xC709FA0b51BDE4A6c2931E7dB7B3171Fa9f6F6B2` | `0x02f0d4b1c0958a687ed10a1533d619dcfc55c9ba0bf94d330ea8a2ca3442fb39` |

Wiring and seeding, both confirmed by reading the deployed state back rather
than by trusting the transaction status:

| Step | Transaction |
| --- | --- |
| `FinalityVault.set_gate(DecisionGate)` | `0x9cffc03463dbb3a1302a48f2afbae1f2efbcddfc079b277433798d7dbad91fdf` |
| `ScenarioRegistry.publish_policy(delivery-milestone-v3)` | `0xc905eea33e609904e27efe36c0ca974aeba42838ab4f19cd22fedde2d8e8ae4c` |

Demo policy hash `0x790600775ccc9b7d7b0328181076e54cb354610350df18d78e86e30c9f0120ac`,
id `delivery-milestone-v3`, version `3.0.0`.

The deployed contracts report their own finality rule, which `npm run deploy`
asserts before it will record a deployment as good:

```
capability_read_scope = FINALIZED_CAPABILITY
finality_rule         = promoted-plus-appeal-window
appeal_window_seconds = 120
```

## Live lifecycle

`npm run lifecycle` drives one action from registration to settlement on chain
and writes `artifacts/live-lifecycle.json`. The run recorded in
`docs/evidence/live-lifecycle.json` reports `outcome: complete`.

Seven transactions, in order:

| Step | What happened | Transaction |
| --- | --- | --- |
| 1 | Action registered | `0x6d09acef787127eaaf7f605d87e3f7f152f4d549564588adba530e301f6fcbc5` |
| 2 | Evidence adjudicated, decision `0xc93e7a2a720983b58255d54671ec07682cb753a9c81b1c56a6ae31ca25d1f675`, action state `ACCEPTED` | `0xe31fcf12fd3d84bca4797c8523c3f9bbf9370b7c4f9f88f2648b5aa5feb2df67` |
| 3 | Promotion attempted **inside** the appeal window -- **refused**, `APPEAL_WINDOW_OPEN` | `0x6f45b9366d57d6d4756052dbce2335b2c44701ed1dc947ce6bc640aeb63beb13` |
| 4 | Escrow funded with 0.01 GEN | `0xd37c0d043b11aafe799f2bd5e94c825e8277519d03ae7a56976d744cadb96549` |
| 5 | Window waited out (103 s + 30 s margin), promotion accepted, state `FINALIZED` | `0x5c62a7c35e1b62b0d55a37935f70865e9a6ba948a321d3ef480ae81c97b6fdad` |
| 6 | Release executed, receipt `SETTLED` | `0x7d2ebf7161beb0fc28dde44b90df129409788ed26b25a678eeadfcb2444b8d83` |

Two observations in that record are the whole product, and both are read off
the network rather than asserted by the script:

**The boundary is observable.** One second after adjudication, the same method
on the same contract answered differently depending on the storage scope it was
asked about:

```
sample 1: tx=ACCEPTED  provisional=true  finalized=false
```

The decision existed. It was readable. And the final-scope read could not see
it, because it had not settled into final state yet. `boundary.observableOnThisNetwork`
is `true` in the record.

**The boundary is enforced, not described.** The lifecycle does not politely
wait for the window before trying to promote. It tries *first*, deliberately,
while the window is open, and the contract refuses:

```
execStatus   rollback
payload      APPEAL_WINDOW_OPEN
```

That refusal is a signed, paid transaction with an explorer entry. It is the
difference between a mechanism and a claim.

The release then produced a receipt whose own text states what was checked:

```
status                       SETTLED
decision_read_scope          FINALIZED_CAPABILITY
amount                       10000000000000000
recipient                    0x1111111111111111111111111111111111111111
finality_proof               gate promoted the decision after its appeal window
                             closed; this contract re-derived the window and
                             matched the commitment
```

`FinalityVault.describe()` reports `settlement_count: 1` after the run.

## Proof corpus

`npm run proof` replays an offline corpus of thirteen cases against two
implementations of the same settlement decision: a baseline that consults the
decision without requiring finality, and the intervention that mirrors
`contracts/finality_vault.py`. It writes `docs/evidence/proof-report.json`, and
the report is written even when cases fail, so a failing corpus cannot hide.

The corpus exists for attribution. A refusal on its own proves nothing -- a
guard that refuses everything scores identically to a correct one. So each case
is run against both arms and the report carries the four release cases that
must *succeed* alongside the refusal cases that must not.

## Reproducing

```
npm install
npm run contracts:check      # every contract compiles on the live GenVM
npm run proof                # offline corpus, writes the proof report
npm run evidence             # folds the records into docs/CLAIMS.json
npm run audit:isolation      # the shipped tree contains no reference material
npm run docs:check           # every documented section exists
npm run build                # the application builds
```

The live paths need a funded key in `.env.local`:

```
npm run deploy -- --force    # deploy, wire, seed, verify by reading back
npm run fee-template         # record the network's message fee parameters
npm run lifecycle            # drive one action to settlement, on chain
```

`npm run lifecycle` never exits non-zero because a stage was refused. It writes
`outcome: partial` with `blockedAt` and `blockedReason` taken from the VM's own
stderr, so a run that fails produces a record instead of an absence of one.
