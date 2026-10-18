/**
 * The v1 live flow: deploy, then drive one payment from proposal to receipt and
 * write down what the network did, in the shape scripts/verify-offline.mjs reads.
 *
 * Nothing here decides an outcome. A refusal or a failure is recorded as what it
 * was. v0 files, v0 evidence and artifacts/deployment.json are never touched.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "../_shared.mjs";
import { balanceOf, explorerAddress, explorerTx, getTx, json, lifecycle, pace, rpc, sleep, unix, counter } from "./chain.mjs";

export const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
export const ARTIFACTS = path.join(REPO_ROOT, "artifacts");
export const POLICY_ID = "delivery-milestone-v3";
export const POLICY_VERSION = "3.0.0";
export const DEFAULT_EVIDENCE_URL = "https://definit-snowy.vercel.app/demo/delivery-742.txt";
export const PARTIAL_EVIDENCE_URL = "https://definit-snowy.vercel.app/demo/delivery-742-partial.txt";
export const INJECTED_EVIDENCE_URL = "https://definit-snowy.vercel.app/demo/delivery-742-injected.txt";
export const RECIPIENT = "0x1111111111111111111111111111111111111111";
export const ESCROW_WEI = 10_000_000_000_000_000n; // 0.01 GEN

const contractSource = (file) => readFileSync(path.join(REPO_ROOT, "contracts", "v1", file), "utf8").replace(/^﻿/, "");
const policyText = () => readFileSync(path.join(REPO_ROOT, "public", "demo", "policy-delivery-milestone-v3.txt"), "utf8").replace(/^﻿/, "").trimEnd();
const callKey = (method) => "0x" + Buffer.from(method).toString("hex").padEnd(64, "0");

// ------------------------------------------------------------------ fees

/**
 * The network's own allocation shape for a message-emitting write, taken from a
 * simulation of a deterministic donor method. Phase 3 replaces the donor with a
 * committed, measured fee profile; until then the shape is read from the
 * network at the moment of use rather than from a recorded blob (defect C5).
 */
export async function feeShape(ctx) {
  if (ctx.shape) return ctx.shape;
  const donorFile = path.join(ARTIFACTS, "fee-donor.json");
  let donor = existsSync(donorFile) ? JSON.parse(readFileSync(donorFile, "utf8")) : null;
  const probe = async (d) => {
    try {
      return await pace(() => ctx.client.estimateTransactionFeesForWrite({ address: d.judge, functionName: "decide_fin", args: ["tpl"] }));
    } catch {
      return null;
    }
  };
  let sim = donor ? await probe(donor) : null;
  if (!sim) {
    log.info("deploying the fee-shape donor (spike contracts) because none answers");
    const read = (f) => readFileSync(path.join(REPO_ROOT, "research", "spike", f), "utf8");
    const sinkAddr = await deployRaw(ctx, read("spike_sink.py"), []);
    const judgeAddr = await deployRaw(ctx, read("spike_judge.py"), [sinkAddr]);
    donor = { sink: sinkAddr, judge: judgeAddr, deployedAt: new Date().toISOString(), note: "Deterministic donor used only to read the network's message-allocation shape. Not part of the product." };
    mkdirSync(ARTIFACTS, { recursive: true });
    writeFileSync(donorFile, json(donor));
    sim = await probe(donor);
    if (!sim) throw new Error("the fee-shape donor cannot be simulated");
  }
  ctx.shape = { base: sim.messageAllocations[0], recommended: BigInt(sim.observed.recommendedTotalMessageFees), donor };
  return ctx.shape;
}

async function plainFees(ctx, options) {
  const est = await pace(() => ctx.client.estimateTransactionFees(options));
  return { est, fees: { distribution: est.distribution, feeValue: est.feeValue } };
}

/**
 * Fee tree for a write. If the exact call simulates, the network's own tree is
 * used with 20% headroom. If it cannot (the call reads chain time or runs a
 * model), one allocation per expected message is built from the donor shape,
 * keyed by target method name (spike observation O8).
 */
export async function feesFor(ctx, { address, functionName, args = [], value, messages = [], factor = 2n }) {
  if (!messages.length) {
    try {
      const sim = await pace(() => ctx.client.estimateTransactionFeesForWrite({ address, functionName, args, ...(value === undefined ? {} : { value }) }));
      const allocations = (sim.messageAllocations ?? []).map((a) => ({ ...a, budget: (BigInt(a.budget) * 6n) / 5n }));
      const total = allocations.reduce((s, a) => s + a.budget, 0n);
      return {
        distribution: { ...sim.distribution, totalMessageFees: total },
        feeValue: BigInt(sim.feeValue) - BigInt(sim.distribution.totalMessageFees) + total,
        ...(allocations.length ? { messageAllocations: allocations } : {}),
      };
    } catch {
      return (await plainFees(ctx, undefined)).fees;
    }
  }
  const { base, recommended } = await feeShape(ctx);
  const budget = recommended * factor;
  const total = budget * BigInt(messages.length);
  const { est } = await plainFees(ctx, { totalMessageFees: total });
  return {
    distribution: { ...est.distribution, totalMessageFees: total },
    feeValue: BigInt(est.feeValue) - BigInt(est.distribution.totalMessageFees) + total,
    messageAllocations: messages.map((m) => ({ ...base, recipient: m.recipient, callKey: callKey(m.method), onAcceptance: m.stage === "accepted", budget })),
  };
}

// ------------------------------------------------------------------ transactions

async function deployRaw(ctx, code, args) {
  const { fees } = await plainFees(ctx);
  const hash = await pace(() => ctx.client.deployContract({ code, args, fees }));
  const receipt = await pace(() => ctx.client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 6000, retries: 80 }));
  const address = receipt?.data?.contract_address ?? receipt?.contract_address;
  const tx = await getTx(hash);
  if (!address || tx.txExecutionResultName !== "FINISHED_WITH_RETURN") throw new Error(`deploy failed: ${tx.status} / ${tx.txExecutionResultName}`);
  ctx.lastDeployHash = hash;
  return address;
}

export async function write(ctx, label, spec, { allowFailure = false } = {}) {
  const fees = await feesFor(ctx, spec);
  const submittedAtMs = Date.now();
  const hash = await pace(() => ctx.client.writeContract({ address: spec.address, functionName: spec.functionName, args: spec.args ?? [], fees, ...(spec.value === undefined ? {} : { value: spec.value }) }));
  await pace(() => ctx.client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 5000, retries: 120 }));
  const tx = await getTx(hash);
  const ok = tx.txExecutionResultName === "FINISHED_WITH_RETURN";
  log.info(`${label}: ${spec.functionName} -> ${tx.status} / ${tx.txExecutionResultName}`);
  if (!ok && !allowFailure) throw new Error(`${label}: ${spec.functionName} did not execute successfully (${tx.status} / ${tx.txExecutionResultName})`);
  return { hash, submittedAtMs, status: tx.status, execution: tx.txExecutionResultName, ok, tx };
}

export const read = (ctx, address, functionName, args = []) => pace(() => ctx.client.readContract({ address, functionName, args }));

// ------------------------------------------------------------------ deployment

export async function deployV1(ctx) {
  const t0 = Date.now();
  const registry = await deployRaw(ctx, contractSource("scenario_registry.py"), []);
  const registryTx = ctx.lastDeployHash;
  const vault = await deployRaw(ctx, contractSource("finality_vault.py"), [ctx.account.address]);
  const vaultTx = ctx.lastDeployHash;
  const gate = await deployRaw(ctx, contractSource("decision_gate.py"), [vault, registry]);
  const gateTx = ctx.lastDeployHash;
  const bind = await write(ctx, "FinalityVault", { address: vault, functionName: "set_gate", args: [gate] });
  const publish = await write(ctx, "ScenarioRegistry", { address: registry, functionName: "publish_policy", args: [POLICY_ID, POLICY_VERSION, "Milestone payment", policyText()] });
  const vaultInfo = await read(ctx, vault, "describe");
  if (String(vaultInfo.gate).toLowerCase() !== gate.toLowerCase()) throw new Error("the vault did not accept the gate binding");
  const gateInfo = await read(ctx, gate, "describe");
  const policy = await read(ctx, registry, "get_policy", [POLICY_ID]);

  const deployment = {
    network: "GenLayer Studio Next (Studio-dev)",
    chainId: 61997,
    rpc: "https://studio-dev.genlayer.com/api",
    explorer: "https://explorer-studio-dev.genlayer.com",
    deployer: ctx.account.address,
    runner: "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng",
    deployedAt: new Date().toISOString(),
    version: "v1",
    addresses: { scenarioRegistry: registry, finalityVault: vault, decisionGate: gate },
    transactions: { scenarioRegistry: registryTx, finalityVault: vaultTx, decisionGate: gateTx, setGate: bind.hash, publishPolicy: publish.hash },
    demoPolicy: { id: POLICY_ID, version: POLICY_VERSION, hash: policy.policy_hash },
    describe: { vault: vaultInfo, gate: gateInfo },
    links: {
      scenarioRegistry: explorerAddress(registry),
      finalityVault: explorerAddress(vault),
      decisionGate: explorerAddress(gate),
    },
    tookSeconds: Math.round((Date.now() - t0) / 1000),
  };
  mkdirSync(ARTIFACTS, { recursive: true });
  writeFileSync(path.join(ARTIFACTS, "deployment-v1.json"), json(deployment));
  return deployment;
}

export function loadDeployment() {
  const file = path.join(ARTIFACTS, "deployment-v1.json");
  if (!existsSync(file)) throw new Error("artifacts/deployment-v1.json is missing; run npm run deploy:v1");
  return JSON.parse(readFileSync(file, "utf8"));
}

// ------------------------------------------------------------------ one payment, recorded

/**
 * Drive one payment: create_action, open_escrow, request_adjudication, then
 * sample the protocol lifecycle and the vault until the adjudicating
 * transaction has finalized and its delivery has been created. For a refusal,
 * the funder then withdraws. For `appeal`, a wallet-signed appeal is submitted
 * as soon as the adjudication is Accepted, and whatever the committee decides
 * is recorded.
 *
 * Returns the record in the shape verify-offline reads.
 */
export async function runPayment(ctx, deployment, options) {
  const { run, kind, evidenceUrl = DEFAULT_EVIDENCE_URL, appeal = false, deadlineSeconds = 7 * 86400, tailSeconds = 60, intervalSeconds = 10, messageFactor = 2n } = options;
  const { registry, vault, gate } = {
    registry: deployment.addresses.scenarioRegistry,
    vault: deployment.addresses.finalityVault,
    gate: deployment.addresses.decisionGate,
  };
  const startedRequests = counter.calls;
  const funder = ctx.account.address;
  const nowS = Math.floor(Date.now() / 1000);
  const nonce = nowS;
  const deadlineUnix = nowS + deadlineSeconds;
  const policy = await read(ctx, registry, "get_policy", [POLICY_ID]);

  const record = {
    run, kind, startedAt: new Date().toISOString(),
    network: { chainId: deployment.chainId, rpc: deployment.rpc },
    contracts: { registry, vault, gate },
    evidenceUrl, steps: [],
  };
  const step = (name, detail) => record.steps.push({ name, at: new Date().toISOString(), ...detail });
  const file = path.join(EV, `v1-run-${run}.json`);
  const save = () => writeFileSync(file, json(record));

  const recipientBefore = await balanceOf(RECIPIENT);
  const funderBefore = await balanceOf(funder);

  // 1. propose
  const create = await write(ctx, `${run} DecisionGate`, { address: gate, functionName: "create_action", args: [RECIPIENT, ESCROW_WEI, "GEN", POLICY_ID, evidenceUrl, deadlineUnix, nonce] });
  const listed = await read(ctx, gate, "list_actions_for", [funder.toLowerCase()]);
  const actionId = listed[listed.length - 1]?.action_id;
  if (!actionId) throw new Error("the action is not listed");
  const action = await read(ctx, gate, "get_action", [actionId]);
  record.action = {
    id: actionId, agent: action.agent, recipient: action.recipient, amount: String(action.amount), asset: action.asset,
    policyHash: action.policy_hash, nonce: Number(action.nonce), deadlineUnix: Number(action.deadline_unix), createdAt: action.created_at, evidenceUrl,
  };
  step("create_action", { tx: create.hash, explorer: explorerTx(create.hash) });

  // 2. fund. The escrow must exist before adjudication.
  const open = await write(ctx, `${run} FinalityVault`, { address: vault, functionName: "open_escrow", args: [actionId, RECIPIENT, ESCROW_WEI, "GEN", action.policy_hash, nonce, deadlineUnix], value: ESCROW_WEI });
  const escrowBefore = await read(ctx, vault, "get_escrow", [actionId]);
  step("open_escrow", { tx: open.hash, explorer: explorerTx(open.hash), state: escrowBefore.state });
  record.vault = { escrowBefore };
  save();

  // 3. adjudicate. Both outcomes are funded: one is delivered, the other's budget is refunded.
  const adjMessages = [{ recipient: vault, method: "authorize_release" }, { recipient: vault, method: "close_refused" }];
  const adjFees = await feesFor(ctx, { address: gate, functionName: "request_adjudication", args: [actionId], messages: adjMessages, factor: messageFactor });
  const submittedAtMs = Date.now();
  const adjHash = await pace(() => ctx.client.writeContract({ address: gate, functionName: "request_adjudication", args: [actionId], fees: adjFees }));
  step("request_adjudication submitted", { tx: adjHash, explorer: explorerTx(adjHash) });
  record.adjudication = { txHash: adjHash, submittedAtMs, lifecycleSamples: [], appeal: null };
  save();

  // 4. sample the protocol until the decision is final and its delivery exists
  let appealed = false;
  let pendingSample = null;
  let finalizedAtMs = null;
  let childHash = null;
  const vaultSamples = [];
  record.vaultSamples = vaultSamples;
  for (let i = 0; i < 160; i++) {
    const at = Date.now();
    const lc = await lifecycle(adjHash).catch((e) => ({ error: String(e.message ?? e) }));
    record.adjudication.lifecycleSamples.push({ atMs: at, storedStatus: lc.storedStatus, projectedStatus: lc.projectedStatus, resolutionAction: lc.resolutionAction, decisionId: lc.decisionId ?? null, decisionActive: lc.decisionActive ?? null, evaluatedAt: lc.evaluatedAt ?? null });
    // A vault sample is bracketed by the chain's own clock: the lifecycle read before it
    // (chainLower) and the one after it (chainUpper). Local time is not comparable to chain time.
    if (pendingSample && lc.evaluatedAt != null) { pendingSample.chainUpper = lc.evaluatedAt; pendingSample = null; }
    if (i % 2 === 1) {
      const e = await read(ctx, vault, "get_escrow", [actionId]).catch(() => null);
      if (e) { pendingSample = { atMs: at, state: e.state, provisional: e.provisional, chainLower: lc.evaluatedAt ?? null, chainUpper: null }; vaultSamples.push(pendingSample); }
    }
    if (appeal && !appealed && lc.projectedStatus === "Accepted") {
      appealed = true;
      try {
        const charge = await pace(() => ctx.client.getAppealCharge({ txId: adjHash }));
        const out = await pace(() => ctx.client.appealTransaction({ txId: adjHash, value: charge }));
        record.adjudication.appeal = { atMs: Date.now(), charge: String(charge), result: typeof out === "string" ? out : json(out) };
        step("appeal submitted", { charge: String(charge) });
      } catch (error) {
        record.adjudication.appeal = { atMs: Date.now(), error: String(error?.message ?? error).slice(0, 400) };
      }
    }
    if (!finalizedAtMs && lc.projectedStatus === "Finalized") finalizedAtMs = at;
    if (finalizedAtMs && !childHash) {
      const t = await getTx(adjHash);
      childHash = t.triggered_transactions?.[0] ?? null;
    }
    save();
    if (finalizedAtMs && at - finalizedAtMs > tailSeconds * 1000) break;
    if (finalizedAtMs && childHash && at - finalizedAtMs > 25_000) break;
    await sleep(intervalSeconds * 1000);
  }

  // 5. what the protocol decided and what it delivered
  const parent = await getTx(adjHash);
  const latest = parent.consensus_history?.latestDecision ?? {};
  const adjudicated = await read(ctx, gate, "get_action", [actionId]);
  const decision = adjudicated.decision_id ? await read(ctx, gate, "get_decision", [adjudicated.decision_id]) : null;
  Object.assign(record.adjudication, {
    status: parent.status, execution: parent.txExecutionResultName,
    attempt: decision ? Number(decision.attempt) : null,
    verdict: decision?.verdict ?? null, reasonCode: decision?.reason_code ?? null,
    decisionId: adjudicated.decision_id, adjudicatedAt: decision?.adjudicated_at ?? null,
    evidenceDigest: decision?.evidence_digest ?? null, intentHash: decision?.intent_hash ?? null,
    finalDecisionId: latest.decisionId ?? null, finalAppealDeadline: latest.appealDeadline ?? null, materializedAt: latest.materializedAt ?? null,
    finalizedObservedAtMs: finalizedAtMs, actionState: adjudicated.state, requestsUsed: counter.calls - startedRequests,
  });

  if (childHash) {
    const c = await getTx(childHash);
    const method = decision?.verdict === "APPROVE" ? "authorize_release" : "close_refused";
    record.delivery = {
      childTxHash: childHash, explorer: explorerTx(childHash), method,
      from: c.from_address, to: c.to_address, triggeredBy: c.triggered_by,
      createdTimestamp: Number(c.created_timestamp), status: c.status, execution: c.txExecutionResultName,
    };
  } else {
    record.delivery = null;
  }

  // The vault's own effects are written when the delivery executes. The transfer it emits is on the
  // finalized stage of the delivery, so it has a window of its own. Wait for the delivery to finalize
  // and for the value to land, and record when each was observed.
  if (record.delivery) {
    for (let i = 0; i < 40; i++) {
      const c = await getTx(childHash);
      record.delivery.status = c.status;
      if (c.status === "FINALIZED") { record.delivery.finalizedObservedAtMs = Date.now(); break; }
      await sleep(8000);
    }
    const c = await getTx(childHash);
    record.delivery.emittedMessages = c.messages ?? [];
  }

  const escrowAfter = await read(ctx, vault, "get_escrow", [actionId]);
  const receipt = await read(ctx, vault, "get_receipt", [actionId]);
  record.vault = { escrowBefore, escrowAfter, receipt };

  // 6. a refusal sends the value home
  if (escrowAfter.state === "REFUNDABLE" || escrowAfter.state === "EXPIRED_REFUNDABLE") {
    const w = await write(ctx, `${run} FinalityVault`, { address: vault, functionName: "withdraw_refund", args: [actionId], messages: [] });
    step("withdraw_refund", { tx: w.hash, explorer: explorerTx(w.hash) });
    record.withdraw = { txHash: w.hash, execution: w.execution, emittedMessages: w.tx.messages ?? [] };
    // the transfer is emitted on the finalized stage; wait for it to land
    for (let i = 0; i < 24; i++) {
      const t = await getTx(w.hash);
      if (t.status === "FINALIZED") break;
      await sleep(10_000);
    }
    await sleep(20_000);
    record.vault.escrowAfterWithdraw = await read(ctx, vault, "get_escrow", [actionId]);
  }

  record.balances = {
    recipientDeltaWei: String((await balanceOf(RECIPIENT)) - recipientBefore),
    funderDeltaWei: String((await balanceOf(funder)) - funderBefore),
    escrowWei: String(ESCROW_WEI),
    creditObservable: false,
    note: "Studio-dev never credits a transfer a contract emits (docs/evidence/milestone/transfer-credit-probe.json), so a balance delta is recorded for completeness and is not evidence. The evidence is the emitted finalized-stage transfer message and the vault's state and receipt.",
  };
  record.finishedAt = new Date().toISOString();
  record.requestsUsed = counter.calls - startedRequests;
  save();
  return record;
}
