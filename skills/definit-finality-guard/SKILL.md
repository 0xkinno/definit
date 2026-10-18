---
name: definit-finality-guard
description: Use when writing or reviewing a GenLayer Intelligent Contract or an agent that moves value, calls an external system, or triggers any irreversible effect based on an AI verdict. Teaches the rule that an Accepted result is a draft and only a Finalized result is a fact, so the effect must be emitted on the finalized stage by the deciding transaction and the receiver must check the sender.
---

# DEFINIT finality guard

## The rule

**Never trigger an irreversible effect from an Accepted result.** An Accepted transaction can still be appealed, and the verdict can change. Emit the effect on the finalized stage of the deciding transaction and make the receiving contract check who sent it.

## Do this

1. In the deciding contract, emit the effect with `emit(on='finalized')`. The protocol then creates the child transaction only after the deciding transaction survives its appeal window. Do not poll for finality and then call a method yourself: a method any account can call is a method an attacker can call.
2. In the receiving contract, accept the effect only if `gl.message.sender_address` equals the address of the deciding contract, bound once by the owner. Recompute any commitment (recipient, amount, policy, evidence digest, nonce) from your own stored record. Do not trust the delivered fields.
3. Make duplicate deliveries a recorded no-op, not a revert and not a second effect.
4. Give value a way home that does not depend on the happy path. A clock may only ever return value to the funder, never release it to the recipient.
5. Off chain, read `gen_getTransactionLifecycle` (`projectedStatus`, `resolutionAction`, `decisionActive`) and treat `Finalized` as the only go signal. `@0xkinno/definit-guard` wraps this as `finalityOf`, `watchFinality`, `settled` and `receipt`.

## Sharp edges

- **Accepted-stage messages can repeat across appeal rounds.** A message emitted on acceptance can be delivered more than once if the verdict is appealed. Use it only for inert notices.
- **`isSuccessful` is not finality.** A transaction can be successful and still Accepted. A finalized child can also fail at execution while its parent stays successful, so the effect was not applied. Check the receiver's own state or receipt.
- **Fee message branches.** Fund every branch that emits a message, including the worst child path (a release that itself emits a transfer). Profile them with a test run, and size `totalMessageFees` from the measurement. Fail closed when the fee-policy verification reports `mismatch`.
- **Studio-style networks may not credit a transfer a contract emits.** Prove a release from the emitted message and the vault's receipt, not from a balance.
- **Do not engineer or claim an appeal outcome.** Record what the committee decided.

## Check before you ship

- A grep for clock comparisons in the release path finds none.
- A test calls the receiving method directly from an unrelated account and from the funder. Both must be refused.
- A test delivers the same message twice. Exactly one effect happens.
- A test alters one delivered field. The delivery is refused.

Reference implementation: https://github.com/0xkinno/definit (`contracts/v1`, `packages/definit-guard`).
