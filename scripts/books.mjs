/**
 * Books: reconcile every recorded escrow against what the protocol delivered.
 *
 *   npm run books
 *
 * For each recorded payment, the value in (the escrow) must equal the value out
 * (the transfer the vault emitted, to the recipient on a release or to the funder
 * on a refund) plus whatever it still holds. Across all of them, in equals out
 * plus held. No payment may emit more than one transfer. Nothing is read from a
 * balance, because Studio-dev does not credit emitted transfers (see
 * docs/evidence/milestone/transfer-credit-probe.json); the books are the vault's
 * own records and the emitted messages.
 *
 * Writes docs/evidence/milestone/books.json. Exits non-zero if the books do not balance.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const rd = (f) => JSON.parse(readFileSync(path.join(EV, f), "utf8"));
const lc = (s) => String(s ?? "").toLowerCase();

const rows = [];
const problems = [];

function reconcile(id, source, r) {
  const before = r.vault?.escrowBefore;
  const after = r.vault?.escrowAfterWithdraw ?? r.vault?.escrowAfter ?? r.result?.escrow;
  const messages = [...(r.delivery?.emittedMessages ?? []), ...(r.withdraw?.emittedMessages ?? [])].filter((m) => BigInt(m.value ?? 0) > 0n);
  const amount = BigInt(after?.amount ?? before?.amount ?? 0);
  const toRecipient = messages.filter((m) => lc(m.recipient) === lc(after?.recipient)).reduce((s, m) => s + BigInt(m.value), 0n);
  const toFunder = messages.filter((m) => lc(m.recipient) === lc(after?.funder)).reduce((s, m) => s + BigInt(m.value), 0n);
  const other = messages.filter((m) => lc(m.recipient) !== lc(after?.recipient) && lc(m.recipient) !== lc(after?.funder)).reduce((s, m) => s + BigInt(m.value), 0n);
  const state = String(after?.state ?? "");
  const held = state === "OPEN" ? amount : 0n;
  const row = { id, source, state, in: String(amount), toRecipient: String(toRecipient), toFunder: String(toFunder), toOthers: String(other), held: String(held), transfers: messages.length };
  if (amount !== toRecipient + toFunder + other + held) problems.push(`${id}: in ${amount} != out ${toRecipient + toFunder + other} + held ${held}`);
  if (other !== 0n) problems.push(`${id}: value left to an address that is neither recipient nor funder`);
  if (messages.length > 1) problems.push(`${id}: ${messages.length} transfers for one escrow`);
  if (state === "SETTLED" && toRecipient !== amount) problems.push(`${id}: settled but the recipient transfer is ${toRecipient}`);
  if ((state === "WITHDRAWN" || state === "RECLAIMED") && toFunder !== amount) problems.push(`${id}: refunded but the funder transfer is ${toFunder}`);
  if (state === "SETTLED" && toFunder !== 0n) problems.push(`${id}: settled and also refunded`);
  rows.push(row);
}

for (const f of readdirSync(EV).filter((x) => /^v1-run-R\d+\.json$/.test(x))) reconcile(f.replace(/^v1-run-|\.json$/g, ""), f, rd(f));

for (const f of readdirSync(EV).filter((x) => /^agent-run-[\w-]+\.json$/.test(x))) {
  const a = rd(f);
  // the agent runs record the vault's escrow and the messages the protocol and vault emitted
  if (a.result?.escrow && a.books) reconcile("AGENT-" + f.replace(/^agent-run-|\.json$/g, ""), f, { vault: { escrowAfter: a.result.escrow }, delivery: { emittedMessages: a.books.messages ?? [] } });
}

const sum = (k) => rows.reduce((s, r) => s + BigInt(r[k]), 0n);
const totals = { escrows: rows.length, in: String(sum("in")), toRecipient: String(sum("toRecipient")), toFunder: String(sum("toFunder")), toOthers: String(sum("toOthers")), held: String(sum("held")) };
if (BigInt(totals.in) !== BigInt(totals.toRecipient) + BigInt(totals.toFunder) + BigInt(totals.toOthers) + BigInt(totals.held)) problems.push("the totals do not balance");

writeFileSync(path.join(EV, "books.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows, totals, balanced: problems.length === 0, problems }, null, 2));
log.step("Books");
for (const r of rows) log.info(`${r.id.padEnd(5)} ${r.state.padEnd(10)} in ${r.in}  recipient ${r.toRecipient}  funder ${r.toFunder}  held ${r.held}`);
log.info(`total in ${totals.in} = recipient ${totals.toRecipient} + funder ${totals.toFunder} + held ${totals.held}`);
if (problems.length) { for (const p of problems) log.fail(p); process.exit(1); }
log.ok(`${rows.length} escrows reconcile; in equals out plus held`);
