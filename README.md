# DEFINIT

![status](https://img.shields.io/badge/status-deployed%20on%20Studio%20Next-2f6f4e)
![chain](https://img.shields.io/badge/chain-61997-1f2937)
![finality](https://img.shields.io/badge/boundary-finalized-b08a3e)
![licence](https://img.shields.io/badge/licence-MIT-6b7280)

![DEFINIT landing page](public/shots/landing.png)

> **DEFINIT prevents autonomous agents from executing irreversible effects against provisional GenLayer judgments by making finalized consensus the execution boundary.**

DEFINIT is a finality firewall for autonomous agents. An agent proposes an action.
GenLayer adjudicates it. The action reaches `ACCEPTED`. Every other system in this
category treats that as permission to move money. DEFINIT treats it as a *draft*,
because `ACCEPTED` is still appealable. Only `FINALIZED` creates the authority that
an irreversible transfer requires.

## Live product links

| Surface | Link |
| --- | --- |
| **Live application** | **https://definit-snowy.vercel.app** |
| **Demo Video** | https://youtu.be/c_4t392dwzI?si=vDlVmxLEX6vfyBj6 |
| Source | https://github.com/0xkinno/definit |
| Decision contract (`DecisionGate`) | `0xC709FA0b51BDE4A6c2931E7dB7B3171Fa9f6F6B2` |
| Custody contract (`FinalityVault`) | `0xf53291532749A568ecb5D0fC4F007cE29DFE2422` |
| Policy registry (`ScenarioRegistry`) | `0x6Fd7166897700335dF5134B078510336f59A1e41` |
| Explorer | https://explorer-studio-dev.genlayer.com/address/0xC709FA0b51BDE4A6c2931E7dB7B3171Fa9f6F6B2 |
| Deployment record | `artifacts/deployment.json` |
| Live lifecycle evidence | `docs/evidence/live-lifecycle.json` |

Redeploy at any time with `npm run deploy`. Nothing in the product is hardcoded to
the addresses above; they are read from `.env.local`.

## Product screenshots

<!-- public/shots/ is produced by `npm run shots`, which writes the hero banner
     above and the four product surfaces below. Every capture is landscape and
     viewport-sized: it shows the top of a page rather than the whole scroll. -->

| Drive the lifecycle | Sign it with a wallet |
| --- | --- |
| ![Protection console](public/shots/console.png) | ![Lifecycle demo](public/shots/demo.png) |

| Follow one action | Read the settlement receipt |
| --- | --- |
| ![Accepted to finalized](public/shots/lifecycle.png) | ![Finality receipt](public/shots/receipt.png) |

## The Problem

Autonomous payment agents are judged by non-deterministic systems. Those systems
do not produce answers instantly; they produce answers that are *provisional* and
then, some window later, *final*. The window exists precisely because the first
answer may be wrong.

If an agent acts on the provisional answer, the appeal mechanism is decorative.
By the time a validator overturns the judgment, the money is already gone, and a
blockchain has no undo. The bug is not that an agent made a bad judgment. The bug
is that the agent treated a provisional judgment as authority.

## The Discovery

Reading the GenVM specification and the Python SDK source rather than the
marketing pages produces one load-bearing fact:

**finality looked like a storage scope you read, and it is not.**

GenVM exposes a scoped cross-contract read, and the name suggests the boundary
we wanted: `gl.contract.StorageView.LATEST_FINALIZED`. Read the same method at
`LATEST_DECIDED` and you see everything; read it at `LATEST_FINALIZED` and a
still-appealable decision should be invisible. That was the design.

Two measurements killed it, and both are recorded rather than asserted.

**The in-contract read never returns.** A cross-contract read scoped to
`StorageView.LATEST_FINALIZED` does not answer. It is not refused -- the leader
is killed with `Leader execution exceeded 600.000s`. The isolation run in
`artifacts/vm-capabilities.json` shows a plain cross-contract read of the same
method answering in full while the final-scoped read of it never does, so the
result is attributable to the scope and not to the call.

**The client-side read returns, and is not a boundary.** The SDK exposes
`transactionHashVariant: "latest-final"`, and it does execute: a fresh probe
(`npm run probe:final-scope`, recorded in
`docs/evidence/final-scope-probe.json`) measured 837-1570 ms across three
decisions. But it resolves against *transaction* finality. The adjudication
transaction is final the moment consensus accepts it, while the appeal window
opens *after* that. So `latest-final` also sees a decision that is still
appealable, which is exactly what the probe caught. It is a useful diagnostic
and a useless guard.

`docs/DISCOVERY.md` carries the source citations; `docs/LIMITATIONS.md` states
what this costs us.

The deployed pair therefore enforces the boundary with two on-chain facts
instead of one read scope: the gate refuses to promote a decision until its
appeal window has closed, and the vault re-derives that same window from the
gate's own `adjudicated_at` stamp before it releases anything. Most systems stop
there. The difference here is that neither contract takes the other's word for
it -- the promotion is refused *by the gate*, and the release is re-derived *by
the vault* against its own transaction clock.

## The Solution

Two contracts and one rule.

- `DecisionGate` accepts an action, derives a canonical commitment over
  (agent, recipient, amount, asset, policy hash, evidence digest, nonce,
  deadline), adjudicates evidence against a published policy, and records the
  result as `ACCEPTED`.
- `FinalityVault` holds the value and refuses to release it unless the decision
  has been promoted to `FINALIZED`, the appeal window re-derived from the gate's
  own record has elapsed, and every commitment field matches exactly.
- The rule: an irreversible effect is only ever emitted on the `finalized`
  message stage, and the consumer never trusts the message. It re-checks the
  boundary itself, against the gate's record rather than the caller's word.

## Why GenLayer

The mechanism requires three things at once: an LLM judgment that many validators
agree on, a first-class notion of provisional-versus-final consensus with a real
appeal window, and contracts that can read and message one another. GenLayer
provides all three as protocol primitives. On a chain without an appeal window,
`ACCEPTED` and `FINALIZED` collapse into the same instant and the product has
nothing to protect.

## How It Works

```mermaid
flowchart LR
    A[Agent] --> B[DecisionGate]
    B --> C[GenLayer Validators]
    C --> D[Accepted]
    D --> E{Finalized?}
    E -- No --> F[Hold]
    E -- Yes --> G[Finality-bound Message]
    G --> H[FinalityVault]
    H --> I[Settlement]
    H --> J[Finality Receipt]
```

```mermaid
sequenceDiagram
    participant U as Operations Manager
    participant A as Agent
    participant G as DEFINIT
    participant V as GenLayer
    participant T as Vault

    U->>A: Delegate bounded payment policy
    A->>G: Submit action + evidence
    G->>V: Adjudicate
    V-->>G: Accepted
    G-->>U: Provisional authorization
    Note over G,T: No economic effect yet
    V-->>G: Finalized
    G->>T: emit(on="finalized")
    T->>T: Verify commitment + nonce
    T-->>U: Settled + receipt
```

```text
ACTION
  |
  v
ADJUDICATION
  |
  v
ACCEPTED ------------+
  |                  |
  | still appealable | NO SETTLEMENT
  |                  |
  v                  |
FINALIZED            |
  |                  |
  +------> SETTLEMENT <+
```

## 2-Minute Walkthrough

1. `npm install`
2. `npm run contracts:check` -- compile all four contracts on the live GenVM, no gas.
3. `npm run deploy` -- deploy, wire, seed the demo policy, verify by read-back.
4. `npm run lifecycle` -- run one real action end to end and write the evidence.
5. Open the console and watch the same journey with the transaction links attached.

## Product Flow

```text
propose -> commit -> adjudicate -> ACCEPTED -> [appeal window] -> FINALIZED -> settle -> receipt
```

Each arrow is a transaction with a recorded hash. `docs/evidence/live-lifecycle.json`
holds the hashes for one complete run on chain 61997.

## Architecture

```text
contracts/
  decision_gate.py        DecisionGate   -- commitment, adjudication, finality capability
  finality_vault.py       FinalityVault  -- custody, the release guards, receipts
  scenario_registry.py    ScenarioRegistry -- publish-once content-addressed policies
  control/unsafe_release.py  UnsafeRelease -- the deliberately wrong control arm

lib/
  commitments/            the commitment encoding, byte-identical to the contract
  lifecycle/              the status machine and its display mapping
  genlayer/               thin typed adapters over the SDK
  receipts/               the receipt schema
  runtime/                what this deployment can actually do, resolved once
  server/                 the only place a private key is ever touched

app/                      Next.js surfaces: landing, console, actions, receipts, lab, proof, docs
tests/                    direct, attacks, lifecycle, unit, e2e
scripts/                  deploy, lifecycle, evidence, audits, verification
docs/                     discovery, architecture, proof, evidence, limitations, claims
```

## Finality Model

| GenLayer status | DEFINIT meaning | Money may move |
| --- | --- | --- |
| `SUBMITTED` | proposal recorded | no |
| `PROPOSING` / `COMMITTING` / `REVEALING` | validators working | no |
| `ACCEPTED` | provisional judgment, still appealable | no |
| `APPEAL_*` | re-adjudication in progress | no |
| `FINALIZED` | consensus has settled | yes, once |
| `CANCELED` / `UNDETERMINED` / `VALIDATORS_TIMEOUT` | no authority was created | no |

The mapping lives in `lib/lifecycle/state.ts` and is asserted against the SDK's
own `TransactionStatus` enum, so a new upstream status cannot silently be treated
as "safe".

## The Hard Invariant

Value leaves `FinalityVault` only when all of the following hold in the same
transaction:

1. an escrow exists for the action;
2. the caller is the bound decision contract, or the party that funded the escrow;
3. the escrow has not already settled;
4. the deadline has not passed;
5. every commitment field restated by the caller equals the escrow record;
6. the settlement nonce has never been used for this action;
7. the decision has been promoted by the gate to `FINALIZED`;
8. the appeal window, re-derived from the gate's own adjudication stamp, has
   elapsed;
9. that decision approves, and its own commitment matches the escrow exactly.

There is no partial path, no best-effort path and no administrative override.
Every refusal carries its own machine-readable reason code.

The guards that decide from their own storage are driven independently by
`tests/attacks/`. The finality guard needs a cross-contract read, which the
direct-mode runner does not implement, so it is driven on chain instead: by the
lifecycle run in `docs/evidence/live-lifecycle.json` and by the third arm of the
corpus in `npm run proof`.

## Proof / Attack Campaign

`npm run proof` runs the corpus against two arms of the same settlement
decision:

| Arm | Implementation | What it requires | Expected |
| --- | --- | --- | --- |
| Baseline | `contracts/control/unsafe_release.py` | a readable provisional decision | releases against an appealable judgment |
| Intervention | `contracts/finality_vault.py` | promotion **and** an elapsed appeal window **and** an exact commitment match | holds |

The two arms differ in one property -- whether the decision has to stop being
appealable before value moves -- which is what makes the difference in outcome
attributable to that property rather than to something else.

A separate control runs on the corpus itself: the release cases must actually be
released by the intervention. Without it, a guard that refuses everything would
score identically on the refusal cases. The control reports both halves -- how
many release cases were released, and how many refusal cases the baseline let
through -- so the baseline cannot be mistaken for a straw man.

How many cases are in the corpus is generated, never written down. `npm run
proof` counts them from `tests/fixtures/cases.json` into `caseCounts` in
`docs/evidence/proof-report.json`, and fails if the report's counts, the
corpus's counts and the observed outcomes disagree. The evidence page and the
proof lab both render that field.

## Demo Evidence

Every headline number in the documentation is generated. `npm run evidence`
folds the records below into `docs/CLAIMS.json` and `docs/evidence/summary.json`;
`npm run proof` writes `docs/evidence/proof-report.json`, and nothing in any of
them is typed by hand.

- `docs/evidence/live-lifecycle.json` -- one complete run on chain 61997
- `docs/evidence/proof-report.json` -- the two-arm comparison and its control
- `docs/evidence/final-scope-probe.json` -- which read scopes execute, and what they see
- `docs/evidence/isolation-audit.json` -- the shipped tree contains no research material
- `docs/evidence/submission-check.json` -- the final completion check, re-runnable

## Sponsor Integration

| GenLayer primitive | Where DEFINIT depends on it |
| --- | --- |
| Non-deterministic execution with leader/validator agreement | `DecisionGate.request_adjudication` |
| `emit(on='finalized')` message staging | every outbound settlement instruction |
| A first-class provisional/final distinction with a real appeal window | the promotion guard and the release guard |
| Internal contract-to-contract calls | gate to registry, gate to vault, vault to gate |
| `gl.vm.UserError.immediate` | every refusal carries a machine-readable reason code |

## What Makes This Different

Most projects in this space answer "did the agent decide correctly?" DEFINIT
answers a different and harder question: **when does a decision become safe to act
on?** The answer is not a policy the agent is asked to respect. It is enforced by
the contract that holds the money, on chain, against the contract that made the
judgment. The distinction is the product.

## Target User

An operations or treasury lead who has delegated bounded spending authority to an
autonomous agent and needs to be able to say, to an auditor, exactly which
judgment authorised a payment and why the payment could not have been made one
minute earlier.

## Stack

- GenLayer Studio Next, chain `61997`, runner `py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng`
- Python contracts (GenVM), `genlayer-js` 2.0.0-rc.1, Next.js 15, React 19, Tailwind
- Node 20+, TypeScript 5.7, Vitest, Playwright

## Honest Boundaries

- **The boundary is an elapsed-time boundary, not a state-visibility boundary.**
  The construction that would have made it the latter -- a cross-contract read
  scoped to final storage state -- does not execute on this network, and the
  client-side `latest-final` variant, which does execute, resolves against
  transaction finality and therefore also sees an appealable decision. What
  ships is still a real boundary: no value moves while the judgement is
  contestable. What it does not catch is a validator set that reverses a
  decision *after* the window has closed. This is stated first because it is the
  one limitation that changes how the product should be deployed, and
  `docs/evidence/final-scope-probe.json` is the measurement behind it.
- Fee trees for the promotion and the release are built from a policy quote plus
  a recorded `feeParams` blob, because the network's fee simulation executes the
  call it prices -- and both of those calls are deliberately not executable on
  demand. See `docs/LIMITATIONS.md`.
- `tests/lifecycle/` exercises the same boundary against a local network, but the
  GenVM build installed here cannot encode this SDK generation's `Address` type,
  so that suite does not execute in this environment. That suite is left
  reporting blocked rather than being turned green. The boundary is covered on
  chain instead.
- **The public site holds no signing key.** It is wallet-first on purpose: a
  visitor without a wallet can read everything and replay the recorded run, but
  a live write needs a signature this deployment deliberately cannot provide.
  See "How To Try It" below.

See `docs/LIMITATIONS.md` for the full list, including what would falsify each
headline claim.

## How To Try It

There are two sessions, and the difference between them is a signature.

**No wallet.** Every page is readable and every number on it is generated from a
chain read or a recorded run. The lifecycle page tells you plainly that live
actions need a wallet, every write control is disabled rather than letting you
click into a refusal, and the recorded on-chain run is available and labelled as
a record rather than as a new transaction. Nothing is mocked to fill the gap.

**With a wallet.** Connect an EIP-1193 wallet from the header, switch it to
GenLayer Studio Next (chain `61997` -- the app offers the add-then-switch pair if
the chain is missing), and the same page becomes live:

1. **Register the action** -- commits recipient, amount, policy and deadline.
   The evidence digest is deliberately empty; it cannot exist yet.
2. **Adjudicate the evidence** -- validators score the snapshot against the
   published policy. An approving verdict lands as `ACCEPTED`.
3. **Open the escrow** -- funds the commitment. Value is now at rest inside the
   vault.
4. **Promote to final** -- try this while the appeal window is open. The gate
   refuses it with `APPEAL_WINDOW_OPEN`. That refusal is the product.
5. **Release** -- after the window closes, promote again and settle. The vault
   re-derives the window, matches the commitment field by field, and moves value
   once. A receipt is written.

Every step raises a wallet popup, and every hash it returns is an ordinary
transaction on chain `61997` that resolves under
`https://explorer-studio-dev.genlayer.com/tx/<hash>`. There is no mock provider,
no simulated hash and no fabricated receipt anywhere in the write path.

You can check the deployment's own claim about what it can do at
`/api/capabilities`, which publishes booleans only:

```json
{
  "liveContracts": true,
  "browserWalletSigning": true,
  "operatorSigning": false,
  "recordedReplay": true
}
```

## Local Setup

```bash
npm install
cp .env.example .env.local     # then fill the values marked <<< FILL ME
npm run contracts:check
npm run deploy
npm run lifecycle
```

## Deployment

The application is deployed to Vercel at
**https://definit-snowy.vercel.app**. The hosting project holds public
configuration only, added as non-sensitive: the `NEXT_PUBLIC_*` chain and
address values, the public evidence URL, and `DEFINIT_ALLOW_SERVER_SIGNING=false`.
No private key is deployed, and none is needed -- signing happens in the
visitor's browser.

```bash
npm run deploy            # deploy, wire, seed, verify by read-back
npm run deploy:dry        # run every check, deploy nothing
npm run verify            # report which environment values are still missing
```

`npm run deploy` refuses to run on the wrong chain, refuses to deploy when the
wallet is empty, and does not report success until a read against the deployed
contract returns the expected value. A transaction hash on its own is never
treated as evidence that anything exists.

## Roadmap

1. Multi-asset escrow and partial release against multiple milestones.
2. A generic `IFinalityConsumer` interface so any contract can adopt the boundary.
3. Independent receipt verification from raw calldata, without trusting DEFINIT.
4. Appeal-window telemetry, so operators can see how long they actually have.