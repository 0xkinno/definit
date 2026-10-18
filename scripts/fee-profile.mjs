/**
 * Measure a fee profile for every method the application sends, and write it
 * where the Transaction Kit reads it.
 *
 *   npm run fee-profile
 *
 * Method: the network prices a call by executing it (`sim_estimateTransactionFees`),
 * and returns what the execution consumed (`observed`). Where a call can be
 * simulated, the profile carries the measured execution budget with 25% headroom.
 * Where it cannot (a call that needs a model, or a state the simulation cannot
 * reach), the entry says so in `measurements` and takes the network's own
 * default allocation. The adjudication carries two emitted messages, one of which
 * will be delivered, so `totalMessageFees` funds both and uses the larger child
 * budget (the release, which itself emits a transfer).
 *
 * This is measured from the live network with the Transaction Kit's profile
 * format. It is not a `gltest --fee-profile` run, which this network family did
 * not expose; the difference is stated in docs/milestone/DELTA.md.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";
import { ensureFunded, json, makeClient, pace } from "./lib/chain.mjs";
import { ARTIFACTS, DEFAULT_EVIDENCE_URL, ESCROW_WEI, POLICY_ID, RECIPIENT, feeShape, loadDeployment, read, write } from "./lib/v1-flow.mjs";

const { client, account } = makeClient();
await ensureFunded(account);
const ctx = { client, account };
const d = loadDeployment();
const { decisionGate: gate, finalityVault: vault } = d.addresses;
const headroom = (v) => (BigInt(v) * 5n) / 4n;
const measurements = {};
const methods = {};

async function measure(name, spec) {
  try {
    const sim = await pace(() => client.estimateTransactionFeesForWrite(spec));
    const dist = sim.distribution;
    methods[name] = {
      leaderTimeunitsAllocation: String(dist.leaderTimeunitsAllocation),
      validatorTimeunitsAllocation: String(dist.validatorTimeunitsAllocation),
      executionBudgetPerRound: String(headroom(sim.observed.recommendedExecutionBudgetPerRound)),
      totalMessageFees: String(headroom(sim.observed.recommendedTotalMessageFees ?? 0)),
    };
    measurements[name] = { basis: "simulation", executionFeeConsumed: String(sim.observed.executionFeeConsumed), recommendedExecutionBudgetPerRound: String(sim.observed.recommendedExecutionBudgetPerRound), headroom: "25%" };
    log.ok(`${name}: measured`);
    return sim;
  } catch (e) {
    measurements[name] = { basis: "network-default", reason: String(e?.message ?? e).slice(0, 160) };
    log.info(`${name}: not simulable (${measurements[name].reason.slice(0, 60)}); network default`);
    return null;
  }
}

const now = Math.floor(Date.now() / 1000);
const nonce = now;
const deadline = now + 7 * 86400;
await measure("create_action", { address: gate, functionName: "create_action", args: [RECIPIENT, ESCROW_WEI, "GEN", POLICY_ID, DEFAULT_EVIDENCE_URL, deadline, nonce] });

// open_escrow needs a recorded action: create one for real, then simulate funding it.
const create = await write(ctx, "fee-profile", { address: gate, functionName: "create_action", args: [RECIPIENT, ESCROW_WEI, "GEN", POLICY_ID, DEFAULT_EVIDENCE_URL, deadline, nonce + 1] });
const listed = await read(ctx, gate, "list_actions_for", [account.address.toLowerCase()]);
const actionId = listed[listed.length - 1].action_id;
const action = await read(ctx, gate, "get_action", [actionId]);
await measure("open_escrow", { address: vault, functionName: "open_escrow", args: [actionId, RECIPIENT, ESCROW_WEI, "GEN", action.policy_hash, nonce + 1, deadline], value: ESCROW_WEI });
await measure("request_adjudication", { address: gate, functionName: "request_adjudication", args: [actionId] });
await measure("withdraw_refund", { address: vault, functionName: "withdraw_refund", args: [actionId] });
await measure("reclaim_after_deadline", { address: vault, functionName: "reclaim_after_deadline", args: [actionId] });

// The adjudication emits two messages; fund both at the donor-measured worst child budget.
const shape = await feeShape(ctx);
const perMessage = shape.recommended * 2n;
const adj = (methods.request_adjudication ??= {});
adj.totalMessageFees = String(perMessage * 2n);
measurements.request_adjudication = { ...measurements.request_adjudication, messageBranches: "approve and reject: two emitted messages, both funded; the undelivered one is refunded", perMessageBudget: String(perMessage), perMessageBasis: "donor-measured recommendedTotalMessageFees with a factor of 2", note: "the call needs a live model, so the execution budget is the network default" };

const messageShape = {
  messageType: String(shape.base.messageType),
  onAcceptance: false,
  parentIndex: String(shape.base.parentIndex),
  feeParams: shape.base.feeParams,
  perMessageBudget: String(perMessage),
  source: "sim_estimateTransactionFeesForWrite on a deterministic emitting contract (artifacts/fee-donor.json)",
  why: "The Transaction Kit's submit sends fees {distribution, feeValue} and cannot express per-message allocations, so a write that emits messages is sent with explicit allocations built from this shape. A kit-only submit of request_adjudication finished with an error (docs/evidence/milestone/agent-run-kit-submit-finding.json).",
};
const profile = {
  version: 1,
  messageShape,
  chainId: d.chainId,
  network: d.network,
  measuredAt: new Date().toISOString(),
  methods,
  measurements: { ...measurements, deploy: { basis: "network-default", reason: "deployments are not simulated" } },
};
for (const out of [path.join(REPO_ROOT, "fee-profile.json"), path.join(REPO_ROOT, "lib", "fees", "fee-profile.json")]) writeFileSync(out, json(profile));
log.ok(`wrote fee-profile.json (${Object.keys(methods).length} methods; action ${actionId.slice(0, 12)} funded nothing)`);
