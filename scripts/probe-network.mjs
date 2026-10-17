/**
 * Phase 0 network probe.
 *
 * For each candidate network, record what it does, measured from the network.
 * Output: docs/evidence/milestone/network-matrix.json
 *
 * Every field is a measured value or a string stating why it could not be
 * measured and what that would take. There are no nulls.
 *
 * The finalized-delivery fields for the target network are derived from the raw
 * spike runs (docs/evidence/milestone/spike/run-*.json), never typed here.
 *
 * Usage: node scripts/probe-network.mjs
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { createAccount, createClient } from "genlayer-js";
import { studioDevnet, studionet, testnetBradbury, testnetAsimov } from "genlayer-js/chains";

import { REPO_ROOT, readEnv, log } from "./_shared.mjs";

const OUT = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const SPIKE = path.join(OUT, "spike");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const NETWORKS = [
  { key: "studio-dev", label: "GenLayer Studio Next (Studio-dev)", chain: studioDevnet, rpc: studioDevnet.rpcUrls.default.http[0] },
  { key: "studionet", label: "Studionet", chain: studionet, rpc: studionet.rpcUrls.default.http[0] },
  { key: "bradbury", label: "Testnet Bradbury", chain: testnetBradbury, rpc: "https://rpc-bradbury.genlayer.com" },
  { key: "asimov", label: "Testnet Asimov", chain: testnetAsimov, rpc: "https://rpc-asimov.genlayer.com" },
];

async function raw(rpc, method, params) {
  const response = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await response.json();
  return body;
}

const isMissing = (body) => /method not found/i.test(body?.error?.message ?? "");

/** Facts about finalized-message delivery on the target network, derived from the recorded spike runs. */
function deliveryFromSpike() {
  const files = readdirSync(SPIKE).filter((f) => /^run-e1d\d+\.json$/.test(f));
  const windows = [];
  const afterDeadline = [];
  const acceptedToFinalizedS = [];
  let delivered = 0;
  for (const f of files) {
    const r = JSON.parse(readFileSync(path.join(SPIKE, f), "utf8"));
    const d = r.finalTx?.latestDecision;
    const child = r.children?.[0];
    if (d) windows.push(d.appealDeadline - d.materializedAt);
    if (d && child) afterDeadline.push(Number(child.created_timestamp) - d.appealDeadline);
    if (child?.status === "FINALIZED" && child?.txExecutionResultName === "FINISHED_WITH_RETURN") delivered += 1;
    const t = r.samples.filter((s) => s.lifecycle.projectedStatus === "Accepted")[0];
    const fin = r.samples.filter((s) => s.lifecycle.projectedStatus === "Finalized")[0];
    if (t && fin) acceptedToFinalizedS.push((fin.atMs - t.atMs) / 1000);
  }
  return {
    sampleRuns: files.length,
    finalizedMessagesDelivered: delivered,
    observedAppealWindowSeconds: windows.length ? median(windows) : "not measured: no recorded E1 runs",
    childCreatedSecondsAfterAppealDeadline: afterDeadline.length ? median(afterDeadline) : "not measured: no recorded E1 runs",
    medianAcceptedToFinalizedSecondsSampled: acceptedToFinalizedS.length ? median(acceptedToFinalizedS) : "not measured: no recorded E1 runs",
  };
}

async function probe(net, account) {
  const entry = { network: net.label, rpc: net.rpc };
  const chainId = await raw(net.rpc, "eth_chainId", []);
  entry.reachable = Boolean(chainId.result);
  entry.chainId = chainId.result ? Number(BigInt(chainId.result)) : "unreachable";
  if (!entry.reachable) return entry;

  const lc = await raw(net.rpc, "gen_getTransactionLifecycle", [{ txId: "0x" + "00".repeat(31) + "01" }]);
  entry.lifecycleMethodAnswers = !isMissing(lc);

  const bal = await raw(net.rpc, "eth_getBalance", [account.address, "latest"]);
  let balance = BigInt(bal.result ?? "0x0");
  const fund = await raw(net.rpc, "sim_fundAccount", [account.address, 1000 * 10 ** 18]);
  entry.fundingMethod = isMissing(fund) ? "sim_fundAccount not available: an external faucet is the only way to fund an account" : "sim_fundAccount (simulator funding, test GEN)";
  if (!isMissing(fund)) {
    const after = await raw(net.rpc, "eth_getBalance", [account.address, "latest"]);
    balance = BigInt(after.result ?? "0x0");
  }
  entry.probeAccountBalanceGen = Number(balance / 10n ** 18n);

  const client = createClient({ chain: { ...net.chain, rpcUrls: { default: { http: [net.rpc] } } }, account });
  try {
    const est = await client.estimateTransactionFees();
    entry.feeSurface = { answers: true, gasless: est.policy?.enabled === false || BigInt(est.feeValue ?? 0) === 0n, feeValueWei: String(est.feeValue), basis: "estimateTransactionFees result" };
  } catch (error) {
    const reason = String(error?.details ?? error?.message ?? error).slice(0, 120);
    const noSurface = /method not found/i.test(reason);
    entry.feeSurface = {
      answers: false,
      // Only a missing fee method says the network has no fee surface. A revert says nothing about fees.
      gasless: noSurface ? true : `not determined: estimateTransactionFees failed with "${reason}", which does not show whether fees are charged`,
      basis: `estimateTransactionFees unavailable: ${reason}`,
    };
  }

  if (balance === 0n) {
    const why = "not measured: probe account holds 0 GEN and the network cannot fund it; a faucet is an external action the operator must take";
    Object.assign(entry, { runnerAccepted: why, executesContracts: why, finalizedMessageDelivery: why, appealWindowSeconds: why, finalizesWithoutExplicitCall: why });
    return entry;
  }

  // Deploy the ten-line probe and read what the network did with it.
  const code = readFileSync(path.join(REPO_ROOT, "research", "spike", "probe.py"), "utf8");
  const runner = /"Depends"\s*:\s*"([^"]+)"/.exec(code)[1];
  entry.runnerTried = runner;
  try {
    const q = entry.feeSurface.answers ? { fees: { distribution: (await client.estimateTransactionFees()).distribution, feeValue: (await client.estimateTransactionFees()).feeValue } } : {};
    const hash = await client.deployContract({ code, args: [], ...q });
    await client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 5000, retries: 40 });
    const tx = (await raw(net.rpc, "eth_getTransactionByHash", [hash])).result;
    entry.probeDeploy = { hash, status: tx.status, consensusResult: tx.result_name, execution: tx.txExecutionResultName ?? "not reported by this network" };
    entry.runnerAccepted = tx.result_name === "MAJORITY_AGREE" || tx.result_name === "AGREE";
    entry.executesContracts = entry.runnerAccepted && (tx.txExecutionResultName === undefined || tx.txExecutionResultName === "FINISHED_WITH_RETURN");
  } catch (error) {
    entry.runnerAccepted = false;
    entry.executesContracts = false;
    entry.probeDeploy = { error: String(error?.message ?? error).slice(0, 200) };
  }

  if (net.key === "studio-dev" && entry.executesContracts) {
    const d = deliveryFromSpike();
    entry.finalizedMessageDelivery = { delivered: d.finalizedMessagesDelivered, of: d.sampleRuns, childCreatedSecondsAfterAppealDeadline: d.childCreatedSecondsAfterAppealDeadline };
    entry.appealWindowSeconds = d.observedAppealWindowSeconds;
    entry.medianAcceptedToFinalizedSecondsSampled = d.medianAcceptedToFinalizedSecondsSampled;
    entry.finalizesWithoutExplicitCall = d.sampleRuns > 0 ? "yes: every recorded run reached Finalized with no finalize call from this account" : "not measured: no recorded runs";
  } else {
    const why = entry.executesContracts ? "not measured on this network in this milestone" : `not measured: network did not execute the probe contract (${entry.probeDeploy?.consensusResult ?? entry.probeDeploy?.error ?? "no result"})`;
    Object.assign(entry, { finalizedMessageDelivery: why, appealWindowSeconds: why, finalizesWithoutExplicitCall: why });
  }
  return entry;
}

async function main() {
  const key = readEnv().GENLAYER_PRIVATE_KEY;
  const account = createAccount(key);
  const matrix = { generatedAt: new Date().toISOString(), probeAccount: account.address, networks: {} };
  for (const net of NETWORKS) {
    log.step(`probing ${net.label}`);
    try {
      matrix.networks[net.key] = await probe(net, account);
    } catch (error) {
      matrix.networks[net.key] = { network: net.label, rpc: net.rpc, probeError: String(error?.message ?? error).slice(0, 300) };
    }
    log.info(JSON.stringify(matrix.networks[net.key]).slice(0, 260));
    await sleep(500);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "network-matrix.json"), JSON.stringify(matrix, null, 2));
  const nulls = JSON.stringify(matrix).includes(":null");
  log.ok(`wrote docs/evidence/milestone/network-matrix.json${nulls ? " (WARNING: contains null)" : " (no null fields)"}`);
  if (nulls) process.exit(1);
}

main().then(() => process.exit(0));
