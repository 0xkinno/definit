import { watchFinality } from "./finality.ts";
import type { GuardContext, GuardedPayment, GuardedPaymentInput, Lifecycle, PaymentReceipt } from "./types.ts";

const unwrap = (value: any) => (value instanceof Map ? Object.fromEntries(value) : value);

/**
 * Propose a payment, fund its escrow, and ask for adjudication.
 *
 * The returned object does not mean the payment happened. It means a verdict was
 * requested. Use `settled()` or `receipt()` to learn whether value moved.
 */
export async function openGuardedPayment(ctx: GuardContext, input: GuardedPaymentInput): Promise<GuardedPayment> {
  const asset = input.asset ?? "GEN";
  const nonce = input.nonce ?? Math.floor(Date.now() / 1000);
  const createTx = await ctx.submit({
    address: ctx.addresses.gate,
    method: "create_action",
    args: [input.recipient, input.amountWei, asset, input.policyId, input.evidenceUrl, input.deadlineUnix, nonce],
    posture: input.posture,
  });
  await ctx.waitDecided?.(createTx);

  const rows = await ctx.read(ctx.addresses.gate, "list_actions_for", [ctx.sender.toLowerCase()]);
  const list = Array.isArray(rows) ? rows.map(unwrap) : [];
  const actionId = list[list.length - 1]?.action_id;
  if (!actionId) throw new Error("the gate did not list the new action");
  const action = unwrap(await ctx.read(ctx.addresses.gate, "get_action", [actionId]));

  const escrowTx = await ctx.submit({
    address: ctx.addresses.vault,
    method: "open_escrow",
    args: [actionId, input.recipient, input.amountWei, asset, action.policy_hash, nonce, input.deadlineUnix],
    value: input.amountWei,
  });
  await ctx.waitDecided?.(escrowTx);

  const adjudicationTx = await ctx.submit({
    address: ctx.addresses.gate,
    method: "request_adjudication",
    args: [actionId],
    posture: input.posture,
    // One of these will be delivered at finality; both are funded so either outcome is deliverable.
    messages: [
      { recipient: ctx.addresses.vault, method: "authorize_release" },
      { recipient: ctx.addresses.vault, method: "close_refused" },
    ],
  });
  return { actionId, createTx, escrowTx, adjudicationTx };
}

/** Read the vault's own record. `paid` is true only if the vault says SETTLED and holds a receipt. */
export async function receipt(ctx: GuardContext, actionId: string): Promise<PaymentReceipt> {
  const escrow = unwrap(await ctx.read(ctx.addresses.vault, "get_escrow", [actionId]).catch(() => null));
  const rec = unwrap(await ctx.read(ctx.addresses.vault, "get_receipt", [actionId]).catch(() => null));
  const state = String(escrow?.state ?? "UNKNOWN");
  const hasReceipt = !!rec && (rec.exists === undefined ? Object.keys(rec).length > 0 : !!rec.exists);
  return {
    state,
    paid: state === "SETTLED" && hasReceipt,
    refundable: state === "REFUNDABLE" || state === "EXPIRED_REFUNDABLE",
    receipt: hasReceipt ? rec : null,
    escrow: escrow ?? null,
  };
}

/**
 * Wait until the deciding transaction is final, then until the vault has acted on the
 * delivery the protocol created. Resolves with the vault's receipt, never with a guess.
 */
export async function settled(
  ctx: GuardContext,
  payment: Pick<GuardedPayment, "actionId" | "adjudicationTx">,
  options: { intervalMs?: number; settleSamples?: number; onSnapshot?: (s: Lifecycle) => void } = {},
): Promise<PaymentReceipt & { finalized: boolean }> {
  const { intervalMs = 8000, settleSamples = 40, onSnapshot } = options;
  let finalized = false;
  for await (const snap of watchFinality(ctx.lifecycle, payment.adjudicationTx, { intervalMs })) {
    onSnapshot?.(snap);
    if (snap.verdict === "final") finalized = true;
  }
  let r = await receipt(ctx, payment.actionId);
  for (let i = 0; i < settleSamples && finalized && r.state === "OPEN"; i++) {
    await new Promise((res) => setTimeout(res, intervalMs));
    r = await receipt(ctx, payment.actionId);
  }
  return { ...r, finalized };
}

/** Contest an Accepted verdict inside its window. Returns the bond charged. */
export async function contest(ctx: GuardContext, txId: string): Promise<{ charge: bigint; hash: string }> {
  if (!ctx.appeal) throw new Error("this context cannot sign an appeal");
  const lc = await ctx.lifecycle(txId);
  const status = lc.projectedStatus ?? lc.storedStatus;
  if (status !== "Accepted") throw new Error(`only an Accepted verdict can be contested (it is ${status ?? "unknown"})`);
  return ctx.appeal(txId);
}

/** The funder's two ways home. Both are funder-only in the contract. */
export async function refund(ctx: GuardContext, actionId: string): Promise<string> {
  const r = await receipt(ctx, actionId);
  if (r.state === "REFUNDABLE" || r.state === "EXPIRED_REFUNDABLE") {
    return ctx.submit({ address: ctx.addresses.vault, method: "withdraw_refund", args: [actionId] });
  }
  if (r.state === "OPEN") {
    return ctx.submit({ address: ctx.addresses.vault, method: "reclaim_after_deadline", args: [actionId] });
  }
  throw new Error(`nothing to refund: the escrow is ${r.state}`);
}
