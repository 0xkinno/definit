/**
 * npm run spike
 *
 * Reproduces E1, E5 and E6 from scratch on the target network and writes a
 * generated summary of what the raw records show. The summary never claims more
 * than the records contain: each check states its own inputs.
 *
 *   E1  three decisions, each emitting one finalized-stage message
 *   E5  an EOA calling the sink directly, against the delivered senders
 *   E6  v0 unchanged, funder calls settle while the promotion is only Accepted
 *
 * Usage: npm run spike -- [--out <dir>]
 *   Default output: docs/evidence/milestone/spike/repro-<timestamp>/
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.resolve(arg("--out", path.join(REPO_ROOT, "docs", "evidence", "milestone", "spike", `repro-${stamp}`)));
mkdirSync(OUT, { recursive: true });
const env = { ...process.env, SPIKE_OUT_DIR: OUT };
const j = (v) => JSON.stringify(v, null, 2);

function run(label, script, args) {
  log.step(label);
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", script), ...args], { cwd: REPO_ROOT, env, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
}

const read = (f) => JSON.parse(readFileSync(path.join(OUT, f), "utf8"));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

run("setup: deploy sink and judge", "spike.mjs", ["setup"]);
for (const n of [1, 2, 3]) {
  run(`E1 decision ${n}`, "spike.mjs", ["decide", "decide", `e1d${n}`, "--msgs", "record_finalized:finalized", "--interval", "10", "--tail", "50"]);
}
run("E5 direct call", "spike.mjs", ["direct", "e5"]);
run("E6 v0 differential", "spike-e6.mjs", ["--run", "1"]);

// ------------------------------------------------------------------ summary
const state = read("state.json");
const judge = state.judge.address.toLowerCase();
const e1 = [1, 2, 3].map((n) => {
  const r = read(`run-e1d${n}.json`);
  const d = r.finalTx.latestDecision;
  const child = r.children[0];
  const entry = r.sink.find((x) => x.tag.startsWith(`e1d${n}`));
  const finalizedSample = r.samples.find((s) => s.lifecycle.projectedStatus === "Finalized");
  return {
    run: `e1d${n}`,
    parentTx: r.txHash,
    executionResult: r.finalTx.txExecutionResultName,
    materializedAt: d.materializedAt,
    appealDeadline: d.appealDeadline,
    appealWindowSeconds: d.appealDeadline - d.materializedAt,
    childTx: child?.hash ?? "none",
    childCreatedTimestamp: Number(child?.created_timestamp ?? 0),
    childCreatedSecondsAfterAppealDeadline: child ? Number(child.created_timestamp) - d.appealDeadline : "no child",
    childTriggeredByParent: child ? String(child.triggered_by).toLowerCase() === r.txHash.toLowerCase() : false,
    childExecution: child?.txExecutionResultName ?? "none",
    sinkStage: entry?.stage ?? "none",
    sinkSender: entry?.sender ?? "none",
    senderIsEmittingContract: entry?.sender === judge,
    firstFinalizedSampleSecondsAfterSubmit: finalizedSample ? (finalizedSample.atMs - r.submittedAtMs) / 1000 : "not sampled",
    sinkCounterBeforeFinalizedSample: r.samples.filter((s) => finalizedSample && s.atMs < finalizedSample.atMs && s.sinkCounter != null).map((s) => s.sinkCounter).slice(-1)[0] ?? "not sampled",
  };
});
const e1Pass = e1.every(
  (x) => x.executionResult === "FINISHED_WITH_RETURN" && x.childExecution === "FINISHED_WITH_RETURN" && x.childTriggeredByParent && x.sinkStage === "finalized" && typeof x.childCreatedSecondsAfterAppealDeadline === "number" && x.childCreatedSecondsAfterAppealDeadline >= 0,
);

const direct = read("e5-direct-e5.json");
const directEntry = direct.entries.find((x) => x.stage === "direct");
const e5 = {
  eoa: direct.eoa,
  directCallRecordedSender: directEntry?.sender ?? "none",
  directSenderIsEoa: directEntry?.sender === direct.eoa,
  deliveredSendersAllEqualJudge: e1.every((x) => x.senderIsEmittingContract),
  judge,
};
const e5Pass = e5.directSenderIsEoa && e5.deliveredSendersAllEqualJudge && e5.directCallRecordedSender !== judge;

const h = read("e6-h1-v0-run1.json");
const e6 = {
  settleExecution: h.settle?.execution ?? "no settle",
  settleVaultStatus: h.vaultReceipt?.status ?? "no receipt",
  promotionLifecycleWhenSettleSubmitted: h.result?.promotionLifecycleWhenSettleSubmitted ?? "not captured",
  promotionAppealDeadline: h.result?.promotionAppealDeadline ?? "not captured",
  settleMaterializedAt: h.result?.settleMaterializedAt ?? "not captured",
  settleDecidedBeforePromotionAppealDeadline: h.result?.settleDecidedBeforePromotionAppealDeadline ?? "not captured",
  v1ContractsUnchangedAtBaseline: "b903f94",
};
const e6Observed = e6.settleExecution === "FINISHED_WITH_RETURN" && e6.settleDecidedBeforePromotionAppealDeadline === true && e6.promotionLifecycleWhenSettleSubmitted?.resolutionAction !== "Finalize";

const summary = {
  generatedAt: new Date().toISOString(),
  network: state.network,
  directory: path.relative(REPO_ROOT, OUT).replace(/\\/g, "/"),
  E1: { pass: e1Pass, medianAppealWindowSeconds: median(e1.map((x) => x.appealWindowSeconds)), runs: e1 },
  E5: { pass: e5Pass, ...e5 },
  E6: { observed: e6Observed, ...e6 },
  note: "pass means the recorded values satisfy the stated predicate; E6 observed means v0 accepted a funder release before the promotion's appeal deadline. Neither is a claim beyond these records.",
};
writeFileSync(path.join(OUT, "summary.json"), j(summary));
log.ok(`summary written: ${path.relative(REPO_ROOT, path.join(OUT, "summary.json"))}`);
log.info(`E1 ${e1Pass ? "PASS" : "FAIL"}  E5 ${e5Pass ? "PASS" : "FAIL"}  E6 ${e6Observed ? "OBSERVED" : "NOT OBSERVED"}`);
process.exit(e1Pass && e5Pass ? 0 : 1);
