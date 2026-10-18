# @0xkinno/definit-guard

Finality-gated payments on GenLayer. The rule: **an Accepted verdict is a draft, only Finalized is a fact.**

```ts
import { kitContext, openGuardedPayment, settled, contest, refund, finalityOf } from "@0xkinno/definit-guard";

const ctx = kitContext({ client, kit, rpcUrl, addresses: { gate, vault }, sender });
const payment = await openGuardedPayment(ctx, { recipient, amountWei, policyId, evidenceUrl, deadlineUnix, posture: "standard" });
const result = await settled(ctx, payment);   // waits for Finalized, then for the vault
if (result.paid) { /* the vault recorded the release */ }
```

| Function | What it does |
| --- | --- |
| `openGuardedPayment` | `create_action`, `open_escrow` (exact value), `request_adjudication` |
| `watchFinality` | async iterator of lifecycle snapshots until Finalized or dead |
| `finalityOf`, `mayExecute` | the rule as a pure function |
| `settled` | waits for finality, then for the vault; resolves with the vault's own receipt |
| `receipt` | `paid` is true only if the vault is SETTLED and holds a receipt |
| `contest` | appeal an Accepted verdict (`getAppealCharge`, then `appealTransaction`) |
| `refund` | `withdraw_refund` after a refusal, `reclaim_after_deadline` for an open escrow |

`kitContext` quotes every write through the Transaction Kit with the committed `fee-profile.json` and refuses to sign when the quote's verification is `mismatch`. It never sets `allowUnverified`.

Tests: `npm -w packages/definit-guard test` (or `npx vitest run packages`).
