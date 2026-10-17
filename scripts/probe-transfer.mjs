/**
 * Does this network credit a value transfer a contract emits?
 *
 * Deploys a tiny payer, funds it, and asks it to pay two fresh addresses, once with
 * on='finalized' and once with the default stage. It then watches the recipients'
 * balances and reads the transactions. Output: docs/evidence/milestone/transfer-credit-probe.json
 *
 * Measured on Studio-dev: the transfer message is created and finalizes, and the
 * value is never credited (value_credited stays false). DEFINIT therefore does not
 * use a recipient balance as evidence on this network; it uses the vault's state,
 * its receipt, and the transfer message the delivery emitted.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, log } from "./_shared.mjs";
import { balanceOf, ensureFunded, getTx, json, makeClient, pace, sleep } from "./lib/chain.mjs";

const { client, account } = makeClient();
await ensureFunded(account);
const code = readFileSync(path.join(REPO_ROOT, "research", "spike", "payer.py"), "utf8");
const est = await pace(() => client.estimateTransactionFees());
const fees = { distribution: est.distribution, feeValue: est.feeValue };
const dh = await pace(() => client.deployContract({ code, args: [], fees }));
const dr = await pace(() => client.waitForTransactionReceipt({ hash: dh, waitUntil: "decided", interval: 5000, retries: 60 }));
const payer = dr?.data?.contract_address ?? dr.contract_address;
const send = async (fn, args, value) => {
  const h = await pace(() => client.writeContract({ address: payer, functionName: fn, args, value: value ?? 0n, fees }));
  await pace(() => client.waitForTransactionReceipt({ hash: h, waitUntil: "decided", interval: 5000, retries: 60 }));
  return h;
};
const AMOUNT = 5_000_000_000_000_000n;
await send("fund", [], 4n * AMOUNT);
const A = "0x" + "a1".repeat(20), B = "0x" + "b2".repeat(20);
const before = { payer: await balanceOf(payer), A: await balanceOf(A), B: await balanceOf(B) };
const hFin = await send("pay_fin", [A, AMOUNT]);
const hDef = await send("pay_default", [B, AMOUNT]);
const samples = [];
for (let i = 0; i < 12; i++) {
  samples.push({ atS: i * 15, payer: String(await balanceOf(payer)), finalized_form: String(await balanceOf(A)), default_form: String(await balanceOf(B)) });
  await sleep(15000);
}
const txs = {};
for (const [name, h] of [["finalized_form", hFin], ["default_form", hDef]]) {
  const t = await getTx(h);
  txs[name] = { hash: h, status: t.status, execution: t.txExecutionResultName, messages: t.messages, triggered_transactions: t.triggered_transactions, value_credited: t.value_credited };
}
const credited = samples.some((s) => BigInt(s.finalized_form) > before.A || BigInt(s.default_form) > before.B);
const out = { network: "Studio-dev (chain 61997)", payer, amountWei: String(AMOUNT), before: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, String(v)])), samples, txs, valueEverCredited: credited };
writeFileSync(path.join(REPO_ROOT, "docs", "evidence", "milestone", "transfer-credit-probe.json"), json(out));
log.ok(`value ever credited: ${credited}`);
process.exit(0);
