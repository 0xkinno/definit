/**
 * An autonomous payment agent that never trusts an Accepted verdict.
 *
 *   node examples/autonomous-agent.mjs [approve|reject|injected]
 *
 * It proposes a payment, waits, and treats the payment as done only when the
 * vault's own receipt exists. Every write is quoted through the Transaction Kit
 * with the committed fee profile. The record goes to
 * docs/evidence/milestone/agent-run-<kind>.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createTransactionKit } from "@genlayer/transaction-kit";
import { privateKeyToAccount } from "viem/accounts";

import { kitContext, openGuardedPayment, refund, settled } from "../packages/definit-guard/src/index.ts";
import { makeClient, RPC, json } from "../scripts/lib/chain.mjs";
import { readEnv } from "../scripts/_shared.mjs";
import { loadDeployment, DEFAULT_EVIDENCE_URL, PARTIAL_EVIDENCE_URL, INJECTED_EVIDENCE_URL, POLICY_ID, RECIPIENT, ESCROW_WEI } from "../scripts/lib/v1-flow.mjs";

const evidenceUrl = { approve: DEFAULT_EVIDENCE_URL, reject: PARTIAL_EVIDENCE_URL, injected: INJECTED_EVIDENCE_URL }[process.argv[2] ?? "reject"];
const { client, account } = makeClient();
const signer = privateKeyToAccount(readEnv().GENLAYER_PRIVATE_KEY);
const rpc = async (method, params = []) => {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
};
// A node-side stand-in for the browser wallet: it signs with the funded test key.
const provider = {
  request: async ({ method, params = [] }) => {
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [signer.address];
    if (method === "eth_sendTransaction") {
      const tx = params[0];
      const serialized = await signer.signTransaction({
        type: "legacy",
        to: tx.to,
        data: tx.data,
        value: tx.value ? BigInt(tx.value) : 0n,
        gas: tx.gas ? BigInt(tx.gas) : 1_000_000n,
        gasPrice: BigInt(await rpc("eth_gasPrice")),
        nonce: Number(BigInt(await rpc("eth_getTransactionCount", [signer.address, "pending"]))),
        chainId: client.chain.id,
      });
      return rpc("eth_sendRawTransaction", [serialized]);
    }
    return rpc(method, params);
  },
};

const d = loadDeployment();
const profile = JSON.parse(readFileSync(new URL("../fee-profile.json", import.meta.url), "utf8"));
const kit = createTransactionKit({ chain: client.chain, provider, account: signer.address, suggestions: profile });
const ctx = kitContext({ client, kit, rpcUrl: RPC, addresses: { gate: d.addresses.decisionGate, vault: d.addresses.finalityVault }, sender: signer.address, messageShape: profile.messageShape });

const log = [];
const note = (what, detail = {}) => { log.push({ at: new Date().toISOString(), what, ...detail }); console.log(what, detail.status ?? ""); };

const payment = await openGuardedPayment(ctx, { recipient: RECIPIENT, amountWei: ESCROW_WEI, policyId: POLICY_ID, evidenceUrl, deadlineUnix: Math.floor(Date.now() / 1000) + 7 * 86400 });
note("proposed, funded, adjudication requested", payment);
const result = await settled(ctx, payment, { onSnapshot: (s) => note("lifecycle", { status: s.projectedStatus, verdict: s.verdict }) });
note(result.paid ? "PAID: the vault holds a release receipt" : result.refundable ? "NOT PAID: refusal finalized, the funder may withdraw" : "NOT DONE", { state: result.state, finalized: result.finalized });

const kind = process.argv[2] ?? "reject";
let refundTx = null;
if (result.refundable) { refundTx = await refund(ctx, payment.actionId); note("refund withdrawn", { status: refundTx }); await new Promise((r) => setTimeout(r, 60000)); }
// What the protocol and the vault emitted, for the books reconciliation.
const parent = await rpc("eth_getTransactionByHash", [payment.adjudicationTx]);
const child = parent.triggered_transactions?.[0] ? await rpc("eth_getTransactionByHash", [parent.triggered_transactions[0]]) : null;
const withdraw = refundTx ? await rpc("eth_getTransactionByHash", [refundTx]) : null;
const books = { messages: [...(child?.messages ?? []), ...(withdraw?.messages ?? [])] };
const escrow = await ctx.read(ctx.addresses.vault, "get_escrow", [payment.actionId]);

writeFileSync(new URL(`../docs/evidence/milestone/agent-run-${kind}.json`, import.meta.url), json({ kind, evidenceUrl, contracts: d.addresses, payment, result: { ...result, escrow: Object.fromEntries(escrow instanceof Map ? escrow : Object.entries(escrow)) }, refundTx, books, deliveryTx: parent.triggered_transactions?.[0] ?? null, feeProfile: { source: "fee-profile.json", chainId: profile.chainId }, log }));
