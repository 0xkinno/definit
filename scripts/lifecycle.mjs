/**
 * Run one complete DEFINIT lifecycle against the deployed contracts.
 *
 * This is the live record. It does not simulate anything and it does not assert
 * an outcome it arranged. It drives the real state machine on the target
 * network and writes down what happened, including the attempts that are
 * supposed to fail.
 *
 * The sequence:
 *
 *   1. create an action whose commitment covers agent, recipient, amount,
 *      asset, policy hash, nonce and deadline;
 *   2. ask the decision contract to adjudicate the action's evidence against
 *      the published policy;
 *   3. sample the decision capability on both sides of the boundary. If the two
 *      reads are ever able to disagree then the mechanism is real and not
 *      merely described;
 *   4. ask the decision contract to promote the decision while the appeal
 *      window is still open. It must refuse. This is the boundary doing work,
 *      not a description of the boundary;
 *   5. fund the escrow;
 *   6. wait for the window to close, then promote the decision for real;
 *   7. request the release and read the receipt back.
 *
 * The script never exits early on a failure. A step that fails is recorded with
 * the exact reason the network gave, the record is written, and the run is
 * marked `partial` rather than `complete`. A lifecycle record that only exists
 * when everything worked is not evidence.
 *
 * Every number written to `docs/evidence/live-lifecycle.json` comes from the
 * network, not from this file.
 *
 * Usage:
 *
 *     npm run lifecycle
 *     npm run lifecycle -- --evidence-url https://example.test/snapshot.txt
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  ARTIFACTS_DIR,
  REPO_ROOT,
  explorerAddress,
  explorerTx,
  feeOptions,
  formatGen,
  log,
  makeClient,
  readEnv,
  requireAddresses,
  requirePrivateKey,
  resolveChain,
} from "./_shared.mjs";

const DECIDED_WAIT = { waitUntil: "decided", interval: 2000, retries: 400 };

/** 0.01 GEN. Small enough to be free, large enough to be a real transfer. */
const ESCROW_WEI = 10_000_000_000_000_000n;

const DEMO_RECIPIENT = "0x1111111111111111111111111111111111111111";
const DEMO_POLICY_ID = "delivery-milestone-v3";

/** Mirrors APPEAL_WINDOW_SECONDS in both contracts. Read back from chain too. */
const APPEAL_WINDOW_SECONDS = 120;

const EVIDENCE_PATH = path.join(ARTIFACTS_DIR, "live-lifecycle.json");
const DOCS_EVIDENCE_PATH = path.join(REPO_ROOT, "docs", "evidence", "live-lifecycle.json");

const REFUSAL_CODES = [
  "APPEAL_WINDOW_OPEN",
  "DECISION_NOT_FINAL",
  "DECISION_UNKNOWN",
  "ALREADY_SETTLED",
  "VERDICT_NOT_APPROVE",
  "COMMITMENT_MISMATCH",
  "REPLAY_BLOCKED",
  "UNAUTHORIZED_CALLER",
  "BAD_STATE",
  "EXPIRED",
  "NOT_ADJUDICATED",
];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function nowMs() {
  return Date.now();
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function unixFromIso(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(tx) {
  return String(tx?.statusName ?? tx?.status_name ?? tx?.status ?? "").toUpperCase();
}

function asText(value) {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Pull the leader's execution result out of a receipt, whatever shape it has. */
function execOutcome(receipt) {
  const leader = receipt?.consensus_data?.leader_receipt?.[0];
  const raw = leader?.result ?? null;
  let parsed = null;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  }
  const status = parsed?.status ?? null;
  let payload = parsed?.payload ?? null;
  if (payload === null && typeof parsed?.raw === "string") {
    try {
      payload = Buffer.from(parsed.raw, "base64").toString("utf8");
    } catch {
      payload = null;
    }
  }
  return {
    execStatus: status,
    payload: typeof payload === "string" ? payload : payload === null ? null : JSON.stringify(payload),
    error: leader?.error ?? null,
    stderr: String(leader?.genvm_result?.stderr ?? "") || null,
  };
}

function isContractError(outcome) {
  return (
    outcome?.execStatus !== null &&
    outcome?.execStatus !== undefined &&
    outcome.execStatus !== "return" &&
    outcome.execStatus !== "success"
  );
}

/** Which of our own refusal codes, if any, the execution detail names. */
function refusalCode(outcome) {
  const haystack = `${outcome?.payload ?? ""} ${outcome?.error ?? ""} ${outcome?.stderr ?? ""}`;
  for (const code of REFUSAL_CODES) {
    if (haystack.includes(code)) return code;
  }
  return null;
}

async function main() {
  const env = readEnv();
  requirePrivateKey();
  const addresses = requireAddresses();
  const client = makeClient();
  const chain = resolveChain();

  const evidenceUrl = argValue("--evidence-url") ?? (env.DEFINIT_DEMO_EVIDENCE_URL ?? "").trim();

  const record = {
    product: "DEFINIT",
    generatedAt: new Date().toISOString(),
    network: {
      name: chain.name ?? "GenLayer Studio Next",
      chainId: Number(await client.getChainId()),
      rpc: (env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "").trim() || null,
      explorer: (env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL ?? "").trim() || null,
    },
    operator: client.account.address,
    contracts: addresses,
    steps: [],
    boundary: {},
    settlement: { attempted: false, executed: false, reason: null },
    outcome: "partial",
    blockedAt: null,
    blockedReason: null,
    ok: false,
  };

  const step = (name, detail) => {
    record.steps.push({ name, at: new Date().toISOString(), ...detail });
    return detail;
  };

  /**
   * The public RPC enforces a low per-minute request budget. A burst of reads
   * during a demonstration can trip it, and a tripped limit is a pause rather
   * than a failure, so it is retried with a long backoff instead of aborting.
   */
  async function rpc(fn, label) {
    let lastError;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await fn();
      } catch (error) {
        const message = String(error?.shortMessage ?? error?.message ?? error);
        const limited = /rate limit/i.test(message);
        lastError = error;
        if (!limited) throw error;
        const waitMs = 45_000 + attempt * 15_000;
        log.warn(`${label}: rate limited, waiting ${Math.round(waitMs / 1000)}s`);
        await sleep(waitMs);
      }
    }
    throw lastError;
  }

  /**
   * Send one transaction and wait for it to be *decided*.
   *
   * A refusal is a successful observation. The contract answered; the answer
   * was no. Only a transport failure throws, and even that is caught by the
   * caller and written into the record.
   */
  async function write(label, address, functionName, args, value, options = {}) {
    const maxAttempts = options.maxAttempts ?? 1;
    const gapMs = options.gapMs ?? 25_000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // The recipient list is how the fee tree learns how many internal
      // messages this call emits. The network cannot answer that by itself:
      // answering means executing the call, and these calls are deliberately
      // not executable on demand.
      const fees = await feeOptions(
        client,
        { address, functionName, args, value },
        { messages: options.messages ?? [] },
      );
      log.info(`${label}: ${functionName}${attempt > 1 ? ` (attempt ${attempt})` : ""}`);
      const hash = await rpc(
        () =>
          client.writeContract({
            address,
            functionName,
            args,
            fees,
            ...(value === undefined ? {} : { value }),
          }),
        label,
      );
      let receipt = null;
      let transportError = null;
      try {
        receipt = await rpc(() => client.waitForTransactionReceipt({ hash, ...DECIDED_WAIT }), label);
      } catch (error) {
        transportError = String(error?.shortMessage ?? error?.message ?? error);
      }
      const outcome = transportError
        ? { execStatus: null, payload: null, error: transportError, stderr: null }
        : execOutcome(receipt);
      log.ok(`${label}: ${functionName} -> ${hash} [${outcome.execStatus ?? "unresolved"}]`);
      if (isContractError(outcome)) {
        log.warn(`execution detail: ${outcome.payload ?? outcome.error ?? "(none reported)"}`);
      }

      const feeProblem = /no_matching_allocation|insufficient_fee|fee/i.test(
        `${outcome.payload ?? ""} ${outcome.error ?? ""}`,
      );
      if (feeProblem && attempt < maxAttempts) {
        log.warn(`${label}: fee tree was quoted against a failing simulation, re-quoting`);
        await sleep(gapMs);
        continue;
      }
      return { hash, receipt, outcome, transportError, attempts: attempt };
    }
  }

  async function read(address, functionName, args = [], variant) {
    return rpc(
      () =>
        client.readContract({
          address,
          functionName,
          args,
          ...(variant ? { transactionHashVariant: variant } : {}),
        }),
      functionName,
    );
  }

  /** Record a failed stage without abandoning the record. */
  function block(stage, reason) {
    if (!record.blockedAt) {
      record.blockedAt = stage;
      record.blockedReason = reason;
      log.fail(`${stage}: ${reason}`);
    }
  }

  log.step("Live lifecycle against the deployed contracts");
  log.info(`chain ${record.network.chainId}, operator ${record.operator}`);
  const startBalance = await client.getBalance({ address: record.operator });
  log.info(`balance ${formatGen(startBalance)}`);
  record.balanceBefore = startBalance.toString();

  if (!evidenceUrl) {
    block("preflight", "No evidence URL. Set DEFINIT_DEMO_EVIDENCE_URL in .env.local or pass --evidence-url.");
    return record;
  }
  log.info(`evidence URL ${evidenceUrl}`);

  // ------------------------------------------------------------------ 1. open
  log.step("1. Register the action");
  const deadline = nowSeconds() + 7 * 24 * 60 * 60;
  const nonce = nowSeconds();

  const createTx = await write("DecisionGate", addresses.decisionGate, "create_action", [
    DEMO_RECIPIENT,
    ESCROW_WEI,
    "GEN",
    DEMO_POLICY_ID,
    evidenceUrl,
    deadline,
    nonce,
  ]);
  if (isContractError(createTx.outcome)) {
    step("create_action", {
      transaction: createTx.hash,
      explorer: explorerTx(createTx.hash),
      execStatus: createTx.outcome.execStatus,
      refusalCode: refusalCode(createTx.outcome),
    });
    block("create_action", createTx.outcome.payload ?? createTx.outcome.error ?? "unknown refusal");
    return record;
  }

  const listed = await read(addresses.decisionGate, "list_actions_for", [
    record.operator.toLowerCase(),
  ]);
  const actionId = listed.length ? listed[listed.length - 1].action_id : null;
  if (!actionId) {
    block("create_action", "create_action succeeded but the action is not listed for this operator");
    return record;
  }
  log.ok(`action ${actionId}`);
  step("create_action", {
    transaction: createTx.hash,
    explorer: explorerTx(createTx.hash),
    execStatus: createTx.outcome.execStatus,
    actionId,
    nonce,
    deadlineUnix: deadline,
    amountWei: ESCROW_WEI.toString(),
    policyId: DEMO_POLICY_ID,
    evidenceUrl,
  });
  record.actionId = actionId;

  // ------------------------------------------------------------ 2. adjudicate
  log.step("2. Adjudicate the evidence against the policy");
  const adjudication = await write("DecisionGate", addresses.decisionGate, "request_adjudication", [
    actionId,
  ]);
  const afterAdjudication = await read(addresses.decisionGate, "get_action", [actionId]);
  const decisionId = afterAdjudication.decision_id;
  log.info(`state ${afterAdjudication.state}, decision ${decisionId}`);
  step("request_adjudication", {
    transaction: adjudication.hash,
    explorer: explorerTx(adjudication.hash),
    execStatus: adjudication.outcome.execStatus,
    refusalCode: refusalCode(adjudication.outcome),
    actionState: afterAdjudication.state,
    decisionId,
    verdict: afterAdjudication.state === "ACCEPTED" ? "APPROVE" : "REJECT",
  });

  if (isContractError(adjudication.outcome) || !decisionId) {
    block(
      "request_adjudication",
      adjudication.outcome.payload ?? adjudication.outcome.error ?? "no decision was recorded",
    );
    return record;
  }
  if (afterAdjudication.state !== "ACCEPTED") {
    block(
      "request_adjudication",
      `adjudication did not approve (state ${afterAdjudication.state}). The boundary demonstration needs an approving decision; check the evidence URL.`,
    );
    return record;
  }
  record.decisionId = decisionId;

  // ------------------------------------- 3. The contract refuses a promotion while the appeal window is open
  log.step("3. Ask the decision contract to promote while the appeal window is open");

  // This is a real, signed transaction and it is meant to be refused. The
  // refusal is the product: promotion is not a state a caller can reach early.
  let earlyPromotion = { attempted: true, refused: false, reasonCode: null };
  try {
    const early = await write("DecisionGate", addresses.decisionGate, "finalize_decision", [
      decisionId,
    ]);
    const code = refusalCode(early.outcome);
    earlyPromotion = {
      attempted: true,
      refused: isContractError(early.outcome) || code !== null,
      reasonCode: code,
      transaction: early.hash,
      explorer: explorerTx(early.hash),
      execStatus: early.outcome.execStatus,
      detail: early.outcome.payload ?? early.outcome.error ?? null,
      method: "signed-write",
      gasSpent: "paid",
    };
  } catch (error) {
    earlyPromotion = {
      attempted: true,
      refused: false,
      reasonCode: null,
      method: "signed-write",
      transportError: asText(error?.shortMessage ?? error?.message ?? error),
    };
  }

  log.info(`refused=${earlyPromotion.refused} reason=${earlyPromotion.reasonCode ?? "(none)"}`);
  record.boundary.earlyPromotion = earlyPromotion;
  step("early_promotion_attempt", earlyPromotion);

  // -------------------------------------------------- 4. The capability across both sides of the boundary
  log.step("4. Sample the capability on both sides of the boundary");
  const samples = [];
  let disagreement = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const txState = await rpc(() => client.getTransaction({ hash: adjudication.hash }), "getTransaction");
    const statusName = statusOf(txState);

    let provisional = null;
    let finalRead = null;
    try {
      provisional = await read(addresses.decisionGate, "get_capability", [decisionId], "latest-nonfinal");
    } catch (error) {
      provisional = { exists: false, error: asText(error?.shortMessage ?? error?.message ?? error) };
    }
    try {
      finalRead = await read(addresses.decisionGate, "get_capability", [decisionId], "latest-final");
    } catch (error) {
      finalRead = { exists: false, error: asText(error?.shortMessage ?? error?.message ?? error) };
    }

    const sample = {
      at: new Date().toISOString(),
      transactionStatus: statusName,
      provisionalScope: "latest-nonfinal",
      provisionalExists: provisional?.exists === true,
      finalScope: "latest-final",
      finalExists: finalRead?.exists === true,
    };
    samples.push(sample);
    log.info(
      `sample ${attempt + 1}: tx=${statusName} provisional=${sample.provisionalExists} finalized=${sample.finalExists}`,
    );

    if (sample.provisionalExists && !sample.finalExists) {
      disagreement = true;
      break;
    }
    if (statusName.includes("FINAL")) break;
    await sleep(1200);
  }

  const capabilityNow = await read(addresses.decisionGate, "get_capability", [decisionId]);
  const adjudicatedAtUnix = unixFromIso(capabilityNow.adjudicated_at);
  Object.assign(record.boundary, {
    decisionId,
    actionStateAtAdjudication: afterAdjudication.state,
    adjudicatedAt: capabilityNow.adjudicated_at ?? null,
    adjudicatedAtUnix,
    appealWindowSeconds: APPEAL_WINDOW_SECONDS,
    samples,
    disagreement,
    observableOnThisNetwork: disagreement,
  });
  step("capability_read_boundary", {
    decisionId,
    disagreement,
    samples: samples.length,
  });

  if (disagreement) {
    log.ok("the provisional read saw the decision while the final read did not");
  } else {
    log.warn(
      "both read variants returned the same answer inside the sampling window; " +
        "the adjudication transaction had already settled, so the split was not captured",
    );
  }

  // ------------------------------------------------------------ 5. fund escrow
  log.step("5. Fund the escrow");
  const escrow = await write(
    "FinalityVault",
    addresses.finalityVault,
    "open_escrow",
    [actionId],
    ESCROW_WEI,
  );
  if (isContractError(escrow.outcome)) {
    step("open_escrow", {
      transaction: escrow.hash,
      explorer: explorerTx(escrow.hash),
      execStatus: escrow.outcome.execStatus,
      refusalCode: refusalCode(escrow.outcome),
    });
    block("open_escrow", escrow.outcome.payload ?? escrow.outcome.error ?? "unknown refusal");
    return record;
  }
  step("open_escrow", {
    transaction: escrow.hash,
    explorer: explorerTx(escrow.hash),
    execStatus: escrow.outcome.execStatus,
    amountWei: ESCROW_WEI.toString(),
  });

  // ------------------------------------------------------ 6. wait, then promote
  log.step("6. Wait for the appeal window to close, then promote");
  // The margin is deliberate. `adjudicated_at` is stamped by consensus, not by
  // this machine, and the leader evaluates the window against the clock of the
  // transaction doing the checking. Waiting only to the second would make the
  // result depend on clock skew between the two.
  const WINDOW_MARGIN_SECONDS = 30;
  let waitSeconds = 0;
  if (adjudicatedAtUnix !== null) {
    const closesAt = adjudicatedAtUnix + APPEAL_WINDOW_SECONDS + WINDOW_MARGIN_SECONDS;
    waitSeconds = Math.max(0, closesAt - nowSeconds());
    if (waitSeconds > 0) {
      log.info(
        `appeal window closes at ${new Date((adjudicatedAtUnix + APPEAL_WINDOW_SECONDS) * 1000).toISOString()}; waiting ${waitSeconds}s`,
      );
      await sleep(waitSeconds * 1000);
    } else {
      log.info("appeal window already closed");
    }
  }
  record.boundary.windowWaitedSeconds = waitSeconds;
  record.boundary.windowMarginSeconds = WINDOW_MARGIN_SECONDS;

  const finalize = await write(
    "DecisionGate",
    addresses.decisionGate,
    "finalize_decision",
    [decisionId],
    undefined,
    { maxAttempts: 4, gapMs: 30_000, messages: [addresses.finalityVault] },
  );
  const promotionRefused = refusalCode(finalize.outcome);
  step("finalize_decision", {
    transaction: finalize.hash,
    explorer: explorerTx(finalize.hash),
    execStatus: finalize.outcome.execStatus,
    refusalCode: promotionRefused,
    settlementMessageStage: "finalized",
  });
  if (isContractError(finalize.outcome)) {
    block(
      "finalize_decision",
      finalize.outcome.payload ?? finalize.outcome.error ?? "promotion failed after the window closed",
    );
    return record;
  }

  const capabilityAfterPromotion = await read(addresses.decisionGate, "get_capability", [decisionId]);
  record.boundary.promoted = {
    state: capabilityAfterPromotion.state,
    finalizedAt: capabilityAfterPromotion.finalized_at ?? null,
  };
  step("capability_after_promotion", record.boundary.promoted);

  // ---------------------------------------------------------- 7. settle + read
  log.step("7. Request the release and read it back");

  // The operator asks for the release. The request is not the authority: the
  // vault re-derives the appeal window from the gate's own stamp and re-checks
  // every field of the commitment before any value moves.
  const escrowRecord = await read(addresses.finalityVault, "get_escrow", [actionId]);
  const settle = await write(
    "FinalityVault",
    addresses.finalityVault,
    "settle",
    [
      actionId,
      decisionId,
      escrowRecord.intent_hash,
      escrowRecord.policy_hash,
      escrowRecord.evidence_digest,
      BigInt(escrowRecord.nonce),
      escrowRecord.recipient,
      BigInt(escrowRecord.amount),
    ],
    undefined,
    // The vault emits twice on a release: the payout to the beneficiary, and a
    // reconciliation call back to the decision contract.
    { messages: [escrowRecord.recipient, addresses.decisionGate] },
  );
  record.settlement = {
    attempted: true,
    executed: !isContractError(settle.outcome),
    reason: isContractError(settle.outcome)
      ? settle.outcome.payload ?? settle.outcome.error ?? "unknown refusal"
      : null,
    transaction: settle.hash,
    explorer: explorerTx(settle.hash),
    execStatus: settle.outcome.execStatus,
    refusalCode: refusalCode(settle.outcome),
  };
  step("settle", record.settlement);

  if (isContractError(settle.outcome)) {
    block("settle", record.settlement.reason);
    return record;
  }

  let receiptView = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    receiptView = await read(addresses.finalityVault, "get_receipt", [actionId]);
    if (receiptView.exists === true) break;
    await sleep(5000);
  }

  if (!receiptView || receiptView.exists !== true) {
    block("get_receipt", "settle returned but no settlement receipt was written");
    return record;
  }

  const finalAction = await read(addresses.decisionGate, "get_action", [actionId]);
  log.ok(`receipt ${receiptView.status}, action ${finalAction.state}`);
  log.info(`receipt scope ${receiptView.decision_read_scope}`);

  Object.assign(record.settlement, {
    actionId,
    decisionId,
    status: receiptView.status,
    actionState: finalAction.state,
    decisionReadScope: receiptView.decision_read_scope,
    finalityProof: receiptView.finality_proof ?? null,
    amountWei: String(receiptView.amount),
    recipient: receiptView.recipient,
    nonce: String(receiptView.nonce),
    settledAt: receiptView.settled_at,
    receiptExplorer: explorerAddress(addresses.finalityVault),
  });
  step("settled", record.settlement);

  return record;
}

function finalise(record, error) {
  if (record.blockedAt) {
    record.outcome = "partial";
    record.ok = false;
  } else {
    record.outcome = "complete";
    record.ok = true;
  }
  if (error) {
    record.runError = String(error?.stack ?? error);
  }
  record.completedAt = new Date().toISOString();

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  mkdirSync(path.dirname(DOCS_EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  writeFileSync(DOCS_EVIDENCE_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  log.ok(`wrote ${path.relative(REPO_ROOT, EVIDENCE_PATH)}`);
  log.ok(`wrote ${path.relative(REPO_ROOT, DOCS_EVIDENCE_PATH)}`);

  log.step(`Live lifecycle ${record.outcome}`);
  console.log(`   provisional/final read disagreement observed: ${record.boundary?.observableOnThisNetwork}`);
  console.log(`   early promotion refused by the contract:       ${record.boundary?.earlyPromotion?.refused}`);
  console.log(`   settlement executed:                           ${record.settlement?.executed}`);
  if (record.blockedAt) {
    console.log(`   blocked at ${record.blockedAt}: ${record.blockedReason}`);
  }
}

let record = null;
try {
  record = await main();
} catch (error) {
  log.fail(String(error?.stack ?? error));
  record = record ?? {
    product: "DEFINIT",
    generatedAt: new Date().toISOString(),
    steps: [],
    boundary: {},
    settlement: { attempted: false, executed: false, reason: null },
    outcome: "partial",
    blockedAt: null,
    blockedReason: null,
    ok: false,
  };
  if (!record.blockedAt) {
    record.blockedAt = "unhandled";
    record.blockedReason = String(error?.shortMessage ?? error?.message ?? error);
  }
  finalise(record, error);
  process.exitCode = 0;
  // `record` is finalised above; skip the duplicate finalise below.
  record = null;
}
if (record) {
  finalise(record);
  // A partial run is a result, not a crash. The record is the output, so the
  // process still exits 0 and `npm run evidence` can consume it.
  process.exitCode = 0;
}
