/**
 * E6 H1 differential.  EXPERIMENT CODE.
 *
 * Question: can the v0 release be triggered while the state it depends on is
 * still appealable at protocol level?
 *
 * v0 (commit b903f94, contracts/ untouched) lets the escrow funder call
 * `settle`. The vault then reads the decision contract at plain scope. This
 * script deploys v0 unchanged to the target network, drives one action through
 * adjudication and promotion, and calls `settle` as the funder while the
 * promotion transaction's own lifecycle still reads Accepted and its
 * resolutionAction is not Finalize.
 *
 * It records what the network did. It does not arrange an outcome.
 * v0 files, v0 evidence and artifacts/deployment.json are never written.
 *
 * Usage: node scripts/spike-e6.mjs
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";
import { makeSpikeClient, pace, lifecycle, getTx } from "./spike.mjs";

const OUT = process.env.SPIKE_OUT_DIR ? path.resolve(process.env.SPIKE_OUT_DIR) : path.join(REPO_ROOT, "docs", "evidence", "milestone", "spike");
const RUN = process.argv.includes("--run") ? process.argv[process.argv.indexOf("--run") + 1] : "1";
const REUSE = process.argv.includes("--reuse");
const FILE = path.join(OUT, `e6-h1-v0-run${RUN}.json`);
const EVIDENCE_URL = "https://definit-snowy.vercel.app/demo/delivery-742.txt";
const POLICY_ID = "delivery-milestone-v3";
const j = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ESCROW_WEI = 10_000_000_000_000_000n;
const RECIPIENT = "0x1111111111111111111111111111111111111111";

const reuseFrom = REUSE ? JSON.parse(readFileSync(path.join(OUT, "e6-h1-v0-run1.json"), "utf8")).contracts : null;
const record = { experiment: "E6-h1-v0", run: RUN, startedAt: new Date().toISOString(), baseline: "b903f94", steps: [], result: null, ...(reuseFrom ? { contracts: reuseFrom, reusedContractsFrom: "e6-h1-v0-run1.json" } : {}) };
const save = () => writeFileSync(FILE, j(record));
const step = (name, detail = {}) => {
  record.steps.push({ name, at: new Date().toISOString(), atMs: Date.now(), ...detail });
  save();
  log.info(`${name}`);
};

const source = (file) => readFileSync(path.join(REPO_ROOT, "contracts", file), "utf8").replace(/^﻿/, "");

/**
 * Sibling template: the network's own allocation shape, taken from a simulation of a
 * deterministic spike method. Used only when the exact call cannot be simulated.
 */
async function siblingTemplate(client) {
  const state = JSON.parse(readFileSync(path.join(OUT, "state.json"), "utf8"));
  const sim = await pace(() => client.estimateTransactionFeesForWrite({ address: state.judge.address, functionName: "decide_fin", args: ["tpl"] }));
  return { sim, base: sim.messageAllocations[0] };
}

/** Fee tree from a simulation of the exact call, with 20% headroom on every message budget. */
async function feesFor(client, address, functionName, args, value, synth = null) {
  let sim;
  try {
    sim = await pace(() => client.estimateTransactionFeesForWrite({ address, functionName, args, ...(value === undefined ? {} : { value }) }));
  } catch (error) {
    if (!synth) throw error;
    const { sim: tpl, base } = await siblingTemplate(client);
    const budget = BigInt(tpl.observed.recommendedTotalMessageFees);
    const allocations = synth.map(({ recipient, method }) => ({ ...base, recipient, callKey: "0x" + Buffer.from(method).toString("hex").padEnd(64, "0"), budget }));
    const total = budget * BigInt(allocations.length);
    record.synthesisedFeeTrees = [...(record.synthesisedFeeTrees ?? []), { functionName, reason: String(error?.details ?? error?.message ?? error).slice(0, 160), allocations: allocations.length }];
    return {
      distribution: { ...tpl.distribution, totalMessageFees: total },
      feeValue: BigInt(tpl.feeValue) - BigInt(tpl.distribution.totalMessageFees) + total,
      messageAllocations: allocations,
    };
  }
  const allocations = (sim.messageAllocations ?? []).map((a) => ({ ...a, budget: (BigInt(a.budget) * 6n) / 5n }));
  const total = allocations.reduce((s, a) => s + a.budget, 0n);
  return {
    distribution: { ...sim.distribution, totalMessageFees: total },
    feeValue: BigInt(sim.feeValue) - BigInt(sim.distribution.totalMessageFees) + total,
    ...(allocations.length ? { messageAllocations: allocations } : {}),
  };
}

async function deploy(client, name, file, args) {
  const est = await pace(() => client.estimateTransactionFees());
  const hash = await pace(() => client.deployContract({ code: source(file), args, fees: { distribution: est.distribution, feeValue: est.feeValue } }));
  const receipt = await pace(() => client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 6000, retries: 60 }));
  const address = receipt?.data?.contract_address ?? receipt?.contract_address;
  const tx = await getTx(hash);
  if (!address || tx.txExecutionResultName !== "FINISHED_WITH_RETURN") throw new Error(`${name}: deploy failed (${tx.txExecutionResultName})`);
  step(`deploy ${name}`, { address, hash, execution: tx.txExecutionResultName });
  return address;
}

async function write(client, label, address, functionName, args, value, synth = null) {
  const fees = await feesFor(client, address, functionName, args, value, synth);
  const submittedAtMs = Date.now();
  const hash = await pace(() => client.writeContract({ address, functionName, args, fees, ...(value === undefined ? {} : { value }) }));
  const receipt = await pace(() => client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 5000, retries: 80 }));
  const tx = await getTx(hash);
  step(`${label}: ${functionName}`, {
    hash,
    submittedAtMs,
    status: tx.status,
    execution: tx.txExecutionResultName,
    decision: tx.consensus_history?.latestDecision ?? null,
    messages: tx.messages?.length ?? 0,
  });
  return { hash, tx, receipt };
}

const read = (client, address, functionName, args = []) => pace(() => client.readContract({ address, functionName, args }));
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

async function main() {
  const { client, account } = makeSpikeClient();
  mkdirSync(OUT, { recursive: true });

  let registry, vault, gate, actionId, decisionId;
  {
    if (reuseFrom) {
      ({ registry, vault, gate } = reuseFrom);
      step("reusing v0 contracts deployed in run 1", reuseFrom);
    } else {
      registry = await deploy(client, "ScenarioRegistry", "scenario_registry.py", []);
      vault = await deploy(client, "FinalityVault", "finality_vault.py", [account.address]);
      gate = await deploy(client, "DecisionGate", "decision_gate.py", [vault, registry]);
      record.contracts = { registry, vault, gate, deployer: account.address };

      await write(client, "FinalityVault", vault, "set_gate", [gate]);
      const policy = readFileSync(path.join(REPO_ROOT, "public", "demo", "policy-delivery-milestone-v3.txt"), "utf8").replace(/^﻿/, "").trimEnd();
      await write(client, "ScenarioRegistry", registry, "publish_policy", [POLICY_ID, "3.0.0", "Milestone payment", policy]);
    }

    const now = Math.floor(Date.now() / 1000);
    await write(client, "DecisionGate", gate, "create_action", [RECIPIENT, ESCROW_WEI, "GEN", POLICY_ID, EVIDENCE_URL, now + 7 * 86400, now]);
    const listed = await read(client, gate, "list_actions_for", [account.address.toLowerCase()]);
    actionId = listed[listed.length - 1]?.action_id;
    if (!actionId) throw new Error("action not listed");
    record.actionId = actionId;

    await write(client, "DecisionGate", gate, "request_adjudication", [actionId]);
    const action = await read(client, gate, "get_action", [actionId]);
    decisionId = action.decision_id;
    record.decisionId = decisionId;
    step("adjudicated", { state: action.state, decisionId, verdict: action.state === "ACCEPTED" ? "APPROVE" : action.state });
    if (action.state !== "ACCEPTED" || !decisionId) throw new Error(`adjudication did not approve: ${action.state}`);

    await write(client, "FinalityVault", vault, "open_escrow", [actionId], ESCROW_WEI);
  }

  // v0 refuses promotion until its own 120 s window has passed (APPEAL_WINDOW_SECONDS).
  const cap = await read(client, gate, "get_capability", [decisionId]);
  const adjudicatedAt = unix(cap.adjudicated_at);
  const wait = Math.max(0, adjudicatedAt + 120 + 25 - Math.floor(Date.now() / 1000));
  step("waiting for v0's own 120 s window", { adjudicatedAt, waitSeconds: wait });
  await sleep(wait * 1000);

  // Promote. Do not wait for it to be decided: the point is what happens while it is still appealable.
  const fees = await feesFor(client, gate, "finalize_decision", [decisionId], undefined, [{ recipient: vault, method: "settle" }]);
  const promoSubmittedAtMs = Date.now();
  const promoHash = await pace(() => client.writeContract({ address: gate, functionName: "finalize_decision", args: [decisionId], fees }));
  step("promotion submitted", { hash: promoHash, submittedAtMs: promoSubmittedAtMs });

  // Wait until the promotion transaction itself is Accepted and not yet resolvable to Finalize.
  let lcAtAccept = null;
  for (let i = 0; i < 40; i++) {
    const lc = await lifecycle(promoHash);
    if (lc.projectedStatus === "Accepted" && lc.resolutionAction !== "Finalize") { lcAtAccept = lc; break; }
    if (lc.projectedStatus === "Finalized") break;
    await sleep(2500);
  }
  record.promotionAtSettleAttempt = lcAtAccept;
  step("promotion Accepted, not yet finalizable", { lifecycle: lcAtAccept });

  // The funder (this account) calls settle now.
  const escrow = await read(client, vault, "get_escrow", [actionId]);
  const settleArgs = [
    actionId,
    decisionId,
    String(escrow.intent_hash),
    String(escrow.policy_hash),
    String(escrow.evidence_digest),
    Number(escrow.nonce),
    String(escrow.recipient).toLowerCase(),
    Number(escrow.amount),
  ];
  const lcBefore = await lifecycle(promoHash);
  let settleFees = await feesFor(client, vault, "settle", settleArgs, undefined, null).catch((e) => ({ error: String(e?.details ?? e?.message ?? e).slice(0, 200) }));
  record.settleSimulation = settleFees.error ? { simulated: false, error: settleFees.error } : { simulated: true };
  if (settleFees.error) {
    // The simulation refused. Send with a plain quote and no message allocations anyway, so the
    // network's own execution result says which guard answered (a refusal code) or that the call
    // got past every guard and failed only at the first emit (a fee-shape error).
    const est = await pace(() => client.estimateTransactionFees());
    settleFees = { distribution: est.distribution, feeValue: est.feeValue };
    record.settleSentWith = "plain quote, no message allocations";
  }
  let settleHash = null;
  let settleError = null;
  try {
    settleHash = await pace(() => client.writeContract({ address: vault, functionName: "settle", args: settleArgs, fees: settleFees }));
  } catch (e) {
    settleError = String(e.message ?? e).slice(0, 400);
  }
  const settleSubmittedAtMs = Date.now();
  step("funder settle submitted", { hash: settleHash, error: settleError, promotionLifecycleAtSubmit: lcBefore, submittedAtMs: settleSubmittedAtMs });

  // Follow both transactions to the end.
  for (let i = 0; i < 40; i++) {
    const a = await lifecycle(promoHash);
    const b = settleHash ? await lifecycle(settleHash) : null;
    record.samples = record.samples ?? [];
    record.samples.push({ atMs: Date.now(), promotion: a, settle: b });
    save();
    if (a.projectedStatus === "Finalized" && (!b || b.projectedStatus === "Finalized")) break;
    await sleep(6000);
  }

  const promoTx = await getTx(promoHash);
  const settleTx = settleHash ? await getTx(settleHash) : null;
  const receipt = await read(client, vault, "get_receipt", [actionId]).catch((e) => ({ error: String(e.message ?? e).slice(0, 200) }));
  record.promotion = { hash: promoHash, status: promoTx.status, execution: promoTx.txExecutionResultName, decision: promoTx.consensus_history?.latestDecision };
  const decodeB64 = (v) => { try { return Buffer.from(String(v), "base64").toString("utf8").replace(/[^ -~]/g, "?"); } catch { return null; } };
  record.settleExplanation = settleTx && {
    validatorResults: (settleTx.consensus_data?.validators ?? []).map((v) => decodeB64(v.result)).slice(0, 5),
    leaderReceipt: JSON.stringify(settleTx.consensus_data?.leader_receipt ?? null).slice(0, 1500),
  };
  record.settle = settleTx && {
    hash: settleHash,
    status: settleTx.status,
    execution: settleTx.txExecutionResultName,
    decision: settleTx.consensus_history?.latestDecision,
    consensusMonitoring: settleTx.consensus_history?.consensus_results?.[0]?.monitoring,
    children: settleTx.triggered_transactions,
  };
  record.vaultReceipt = receipt;

  const promoDeadline = promoTx.consensus_history?.latestDecision?.appealDeadline ?? null;
  const settleAcceptedAt = settleTx?.consensus_history?.latestDecision?.materializedAt ?? null;
  record.result = {
    settleExecutedWithReturn: settleTx?.txExecutionResultName === "FINISHED_WITH_RETURN",
    promotionLifecycleWhenSettleSubmitted: lcBefore && { projectedStatus: lcBefore.projectedStatus, resolutionAction: lcBefore.resolutionAction },
    promotionAppealDeadline: promoDeadline,
    settleMaterializedAt: settleAcceptedAt,
    settleDecidedBeforePromotionAppealDeadline: promoDeadline && settleAcceptedAt ? settleAcceptedAt < promoDeadline : null,
  };
  record.finishedAt = new Date().toISOString();
  save();
  log.ok(`E6 recorded: ${FILE}`);
}

main().then(() => process.exit(0)).catch((error) => {
  record.error = String(error?.message ?? error);
  save();
  log.fail(record.error);
  process.exit(1);
});
