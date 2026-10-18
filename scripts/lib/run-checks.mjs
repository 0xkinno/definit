/**
 * The invariant checks for one recorded v1 payment run.
 *
 * Pure: no network, no model, no filesystem. It takes a run record (the shape
 * scripts/lib/v1-flow.mjs writes) and returns the problems it finds. Both
 * scripts/verify-offline.mjs and the live integration tests call it, so a run is
 * judged by one definition whether it is checked now or years later.
 */

import { actionIdOf, decisionIdOfV1, intentHashOf } from "../../lib/commitments/commitment.ts";

const lc = (s) => String(s ?? "").toLowerCase();

export function checkRun(r) {
  const problems = [];
  const bad = (m) => problems.push(`${r.run}: ${m}`);
  const a = r.action;
  const adj = r.adjudication;

  // I3. Every hash is recomputed from the raw fields, in TypeScript.
  const intent = intentHashOf({
    agent: a.agent, recipient: a.recipient, amount: Number(a.amount), asset: a.asset,
    policyHash: a.policyHash, evidenceDigest: adj.evidenceDigest, nonce: Number(a.nonce), deadlineUnix: Number(a.deadlineUnix),
  });
  if (lc(intent) !== lc(adj.intentHash)) bad(`recorded intent hash differs from the recomputed ${intent}`);
  if (r.vault?.receipt?.exists && lc(r.vault.receipt.intent_hash) !== lc(intent)) bad("the vault receipt's intent hash differs from the recomputed one");
  const actionId = actionIdOf({ agent: a.agent, recipient: a.recipient, amount: Number(a.amount), asset: a.asset, policyHash: a.policyHash, nonce: Number(a.nonce), createdAt: a.createdAt });
  if (lc(actionId) !== lc(a.id)) bad(`action id differs from the recomputed ${actionId}`);
  const decisionId = decisionIdOfV1({ actionId: a.id, attempt: adj.attempt, intentHash: intent, adjudicatedAt: adj.adjudicatedAt });
  if (lc(decisionId) !== lc(adj.decisionId)) bad(`decision id differs from the recomputed ${decisionId}`);

  // The deciding transaction must have executed successfully and be final.
  if (adj.execution !== "FINISHED_WITH_RETURN") bad(`the adjudicating transaction ended ${adj.execution}`);
  if (adj.status !== "FINALIZED") bad(`the adjudicating transaction is ${adj.status}, not FINALIZED`);

  const d = r.delivery;
  if (!d) {
    bad("no delivery was recorded");
    return problems;
  }

  // I1. The delivery is the gate's child, addressed to the vault, created by the deciding transaction.
  if (lc(d.from) !== lc(r.contracts.gate)) bad("the delivery was not sent by the gate");
  if (lc(d.to) !== lc(r.contracts.vault)) bad("the delivery was not addressed to the vault");
  if (lc(d.triggeredBy) !== lc(adj.txHash)) bad("the delivery was not triggered by the adjudicating transaction");
  if (d.execution !== "FINISHED_WITH_RETURN") bad(`the delivery ended ${d.execution}`);

  // I8. Nothing moved before the decision that finalized had passed its appeal deadline.
  if (adj.finalAppealDeadline == null) bad("no final appeal deadline was recorded");
  else if (Number(d.createdTimestamp) < Number(adj.finalAppealDeadline)) bad(`the delivery was created at ${d.createdTimestamp}, before the deciding decision's appeal deadline ${adj.finalAppealDeadline}`);
  // A moved state is a violation only if the chain's own clock proves the sample was taken before the
  // delivery existed: its upper bound (the next lifecycle read) is earlier than the delivery's creation.
  // Older records carry only local time; for those the original comparison is kept.
  const MOVED = ["SETTLED", "WITHDRAWN", "REFUNDABLE", "EXPIRED_REFUNDABLE"];
  const early = (r.vaultSamples ?? []).find((s) => MOVED.includes(s.state) && (s.chainUpper != null ? Number(s.chainUpper) < Number(d.createdTimestamp) : s.atMs / 1000 < Number(d.createdTimestamp)));
  if (early) bad(`the vault showed ${early.state} before the delivery was created`);

  // The outcome and the method must agree.
  const approved = adj.verdict === "APPROVE";
  const expectedMethod = approved ? "authorize_release" : "close_refused";
  if (d.method !== expectedMethod) bad(`delivery method ${d.method}, expected ${expectedMethod}`);
  const after = r.vault?.escrowAfter?.state;
  if (approved && after !== "SETTLED") bad(`an approval left the escrow ${after}, not SETTLED`);
  if (!approved && !["REFUNDABLE", "WITHDRAWN"].includes(after) && r.vault?.escrowAfterWithdraw?.state !== "WITHDRAWN") bad(`a refusal left the escrow ${after}`);

  // Value. Studio-dev never credits a transfer a contract emits, so the evidence is the transfer message the
  // delivery emitted (finalized stage, to the recipient, for the escrowed amount) and the vault's receipt.
  const transfers = (d.emittedMessages ?? []).filter((m) => m.value != null && BigInt(m.value) > 0n);
  if (approved) {
    const pay = transfers.find((m) => lc(m.recipient) === lc(a.recipient) && BigInt(m.value) === BigInt(a.amount));
    if (!pay) bad("the delivery did not emit a transfer of the escrowed amount to the recipient");
    else if (pay.onAcceptance !== false) bad("the transfer was not emitted on the finalized stage");
    if (r.vault?.receipt?.finality_source !== "protocol-delivery") bad("the receipt does not record a protocol delivery");
    if (lc(r.vault?.receipt?.delivered_by) !== lc(r.contracts.gate)) bad("the receipt does not name the gate as the deliverer");
  } else {
    if (transfers.some((m) => lc(m.recipient) === lc(a.recipient))) bad("a refused payment emitted a transfer to the recipient");
    const wd = r.withdraw?.emittedMessages?.filter((m) => m.value != null && BigInt(m.value) > 0n) ?? [];
    if (!wd.some((m) => lc(m.recipient) === lc(a.agent) && BigInt(m.value) === BigInt(a.amount) && m.onAcceptance === false)) bad("the refund did not emit a finalized-stage transfer of the escrowed amount to the funder");
  }
  return problems;
}
