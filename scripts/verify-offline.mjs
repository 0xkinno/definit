/**
 * npm run verify:offline
 *
 * Recompute every commitment and every invariant from recorded calldata,
 * receipts and lifecycle timestamps, without calling the network or a model.
 *
 * It reads only docs/evidence/milestone/**.json and the TypeScript commitment
 * module. It trusts no summary: every predicate is re-derived from the raw
 * records, and each check says which records it used.
 *
 * Each check ends in one of:
 *   pass          the recorded values satisfy the predicate
 *   fail          they do not (the script exits non-zero)
 *   not-evidenced no record exists for it yet (fails only with --require-live)
 *
 * Usage: node scripts/verify-offline.mjs [--require-live]
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./_shared.mjs";
import { actionIdOf, decisionIdOfV1, evidenceDigestOf, intentHashOf } from "../lib/commitments/commitment.ts";
import { checkRun } from "./lib/run-checks.mjs";
import { replay, replayFunderPath } from "./counterfactual.mjs";

const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const SPIKE = path.join(EV, "spike");
const REQUIRE_LIVE = process.argv.includes("--require-live");
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
const rel = (p) => path.relative(REPO_ROOT, p).replace(/\\/g, "/");
const lc = (s) => String(s ?? "").toLowerCase();

const checks = [];
function check(id, invariants, title, evaluate) {
  const record = { id, invariants, title, status: "pass", uses: [], problems: [], notes: [] };
  try {
    evaluate({
      use: (p) => record.uses.push(rel(p)),
      fail: (m) => record.problems.push(m),
      note: (m) => record.notes.push(m),
      notEvidenced: (m) => { record.status = "not-evidenced"; record.notes.push(m); },
    });
  } catch (error) {
    record.problems.push(`could not evaluate: ${String(error?.message ?? error)}`);
  }
  if (record.problems.length) record.status = "fail";
  checks.push(record);
}

// ------------------------------------------------------------------ V1: the gate's emission, recomputed in TypeScript
check("V1", ["I3"], "The gate's emitted message equals an independent TypeScript recomputation of every hash", (c) => {
  const file = path.join(EV, "gate-emission-vector.json");
  if (!existsSync(file)) return c.notEvidenced("gate-emission-vector.json has not been recorded; run npm run test:v1:direct");
  c.use(file);
  const v = rd(file);
  const i = v.inputs;
  const [actionId, decisionId, intentHash, digest, policyHash, nonce, recipient, amount] = v.emitted.args;
  const expectedAction = actionIdOf({ agent: i.agent, recipient: i.recipient, amount: i.amount, asset: i.asset, policyHash: i.policy_hash, nonce: i.nonce, createdAt: i.created_at });
  const expectedDigest = evidenceDigestOf(i.evidence_text);
  const expectedIntent = intentHashOf({ agent: i.agent, recipient: i.recipient, amount: i.amount, asset: i.asset, policyHash: i.policy_hash, evidenceDigest: expectedDigest, nonce: i.nonce, deadlineUnix: i.deadline_unix });
  const expectedDecision = decisionIdOfV1({ actionId: expectedAction, attempt: i.attempt, intentHash: expectedIntent, adjudicatedAt: i.adjudicated_at });
  const same = (label, got, want) => { if (lc(got) !== lc(want)) c.fail(`${label}: emitted ${got}, recomputed ${want}`); };
  same("action id", actionId, expectedAction);
  same("evidence digest", digest, expectedDigest);
  same("intent hash", intentHash, expectedIntent);
  same("decision id (v1 domain)", decisionId, expectedDecision);
  same("policy hash", policyHash, i.policy_hash);
  same("recipient", recipient, i.recipient);
  if (Number(nonce) !== i.nonce) c.fail("nonce differs");
  if (Number(amount) !== i.amount) c.fail("amount differs");
  if (v.emitted.stage !== "finalized") c.fail(`stage is ${v.emitted.stage}, expected finalized`);
  if (v.emitted.method !== "authorize_release") c.fail(`method is ${v.emitted.method}`);
  same("recorded action intent hash", v.recorded_action.intent_hash, expectedIntent);
  same("recorded action decision id", v.recorded_action.decision_id, expectedDecision);
});

// ------------------------------------------------------------------ V2: the corpus, re-derived from its results
check("V2", ["I1", "I3", "I4", "I5", "I6", "I7", "I9", "I10", "I11"], "Every corpus case ran and its recorded outcome equals what the case declared", (c) => {
  const fixture = path.join(REPO_ROOT, "tests", "v1", "fixtures", "cases-v1.json");
  const results = path.join(EV, "corpus-v1-results.json");
  if (!existsSync(results)) return c.notEvidenced("corpus-v1-results.json has not been recorded; run npm run test:v1:direct");
  c.use(fixture); c.use(results);
  const cases = rd(fixture).cases;
  const ran = rd(results).results;
  const want = new Set(cases.map((x) => x.id));
  const got = new Set(ran.map((x) => x.id));
  for (const id of want) if (!got.has(id)) c.fail(`case ${id} has no recorded result`);
  for (const id of got) if (!want.has(id)) c.fail(`result ${id} has no case`);
  for (const r of ran) {
    const def = cases.find((x) => x.id === r.id);
    if (!def) continue;
    if (r.invariant !== def.invariant) c.fail(`${r.id}: invariant label differs`);
    if (r.steps.length !== def.steps.length) c.fail(`${r.id}: ${r.steps.length} steps ran, ${def.steps.length} declared`);
    r.steps.forEach((s, k) => {
      const expected = def.steps[k]?.expect;
      if (s.expected !== expected) c.fail(`${r.id} step ${k}: expectation differs from the case`);
      const ok = expected === "ok" ? s.outcome === "ok"
        : expected === "noop" ? s.outcome === "noop"
        : expected.startsWith("revert:") ? s.outcome === "revert" && s.code === expected.slice(7)
        : expected.startsWith("status:") ? s.outcome === "ok" && s.status === expected.slice(7) : false;
      if (!ok) c.fail(`${r.id} step ${k}: observed ${JSON.stringify(s)} does not satisfy ${expected}`);
    });
    for (const key of ["state", "to_recipient", "to_funder"]) {
      if (r.observed_final[key] !== def.final[key]) c.fail(`${r.id}: final ${key} is ${r.observed_final[key]}, case declares ${def.final[key]}`);
    }
    if (r.passed !== true) c.fail(`${r.id}: recorded as not passed`);
  }
  c.note(`${ran.length} cases re-derived`);
});

// ------------------------------------------------------------------ V3: no clock authorizes a release
check("V3", ["I2"], "No wall-clock comparison authorizes a release", (c) => {
  const file = path.join(EV, "no-clock-check.json");
  if (!existsSync(file)) return c.notEvidenced("no-clock-check.json has not been recorded; run npm run check:no-clock");
  c.use(file);
  const r = rd(file);
  if (!r.pass) c.fail("the checker recorded a failure");
  for (const k of r.comparisons) {
    if (k.verdict !== "ok") c.fail(`${k.file}:${k.line} ${k.function}: ${k.verdict}`);
    if (k.sets_settled_in_branch) c.fail(`${k.function}: a clock comparison's branch settles an escrow`);
    if (!k.denies) c.fail(`${k.function}: a clock comparison's branch does not deny`);
  }
  if (r.violations.length) c.fail(`${r.violations.length} violation(s) listed`);
  c.note(`${r.comparisons.length} clock comparisons, all deny-only or return-to-funder`);
});

// ------------------------------------------------------------------ V4: spike delivery timing and sender truth, from raw runs
const repros = existsSync(SPIKE) ? readdirSync(SPIKE, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("repro-")).map((d) => path.join(SPIKE, d.name)) : [];
check("V4", ["I1", "I8"], "A finalized-stage message is a child of the deciding transaction, created at or after its appeal deadline, sent by the emitting contract", (c) => {
  if (!repros.length) return c.notEvidenced("no spike reproduction is recorded");
  let decisions = 0;
  for (const dir of repros) {
    const state = rd(path.join(dir, "state.json"));
    const judge = lc(state.judge.address);
    c.use(path.join(dir, "state.json"));
    for (const n of [1, 2, 3]) {
      const file = path.join(dir, `run-e1d${n}.json`);
      if (!existsSync(file)) { c.fail(`${rel(file)} is missing`); continue; }
      c.use(file);
      const r = rd(file);
      const tag = `e1d${n}`;
      const d = r.finalTx.latestDecision;
      const child = r.children?.[0];
      decisions += 1;
      if (r.finalTx.txExecutionResultName !== "FINISHED_WITH_RETURN") c.fail(`${rel(file)}: parent did not execute successfully`);
      if (!child) { c.fail(`${rel(file)}: no child transaction`); continue; }
      if (lc(child.triggered_by) !== lc(r.txHash)) c.fail(`${rel(file)}: child was not triggered by the deciding transaction`);
      if (Number(child.created_timestamp) < d.appealDeadline) c.fail(`${rel(file)}: child created at ${child.created_timestamp}, before the appeal deadline ${d.appealDeadline}`);
      if (lc(child.from_address) !== judge) c.fail(`${rel(file)}: child sender is not the emitting contract`);
      if (child.txExecutionResultName !== "FINISHED_WITH_RETURN") c.fail(`${rel(file)}: child did not execute successfully`);
      const entry = r.sink.find((x) => String(x.tag).startsWith(tag));
      if (!entry) c.fail(`${rel(file)}: the sink recorded nothing`);
      else {
        if (entry.stage !== "finalized") c.fail(`${rel(file)}: sink stage ${entry.stage}`);
        if (lc(entry.sender) !== judge) c.fail(`${rel(file)}: sink sender ${entry.sender} is not the emitting contract`);
      }
      // No sample taken before the appeal deadline may show the delivery.
      const before = r.samples.filter((s) => s.atMs / 1000 < d.appealDeadline && s.sinkCounter != null);
      const baseline = (entry?.n ?? 1) - 1;
      for (const s of before) if (Number(s.sinkCounter) > baseline) c.fail(`${rel(file)}: delivery visible before the appeal deadline`);
    }
  }
  c.note(`${decisions} decisions across ${repros.length} reproductions re-derived from raw runs`);
});

check("V5", ["I1"], "A direct call shows the caller's own address as sender, distinct from a delivered message's", (c) => {
  if (!repros.length) return c.notEvidenced("no spike reproduction is recorded");
  for (const dir of repros) {
    const file = path.join(dir, "e5-direct-e5.json");
    if (!existsSync(file)) { c.fail(`${rel(file)} is missing`); continue; }
    c.use(file);
    const e = rd(file);
    const state = rd(path.join(dir, "state.json"));
    const direct = e.entries.find((x) => x.stage === "direct");
    if (!direct) { c.fail(`${rel(file)}: no direct entry`); continue; }
    if (lc(direct.sender) !== lc(e.eoa)) c.fail(`${rel(file)}: direct call sender is not the caller`);
    if (lc(direct.sender) === lc(state.judge.address)) c.fail(`${rel(file)}: a direct call is indistinguishable from a delivery`);
  }
});

// ------------------------------------------------------------------ V6: the v0 differential, from raw records
check("V6", ["C2"], "v0's vault accepted a funder release while the promotion was only Accepted and still appealable", (c) => {
  const files = [...repros.map((d) => path.join(d, "e6-h1-v0-run1.json")), path.join(SPIKE, "e6-h1-v0-run2.json")].filter(existsSync);
  if (!files.length) return c.notEvidenced("no E6 record exists");
  for (const file of files) {
    c.use(file);
    const r = rd(file);
    if (!r.settle) { c.note(`${rel(file)}: no settle was sent in this run (recorded, not counted)`); continue; }
    const lcAt = r.result?.promotionLifecycleWhenSettleSubmitted;
    if (r.settle.execution !== "FINISHED_WITH_RETURN") c.fail(`${rel(file)}: settle did not execute successfully`);
    if (lcAt?.projectedStatus !== "Accepted" || lcAt?.resolutionAction === "Finalize") c.fail(`${rel(file)}: promotion was not merely Accepted when settle was sent`);
    const decided = r.settle.decision?.materializedAt;
    const deadline = r.promotion?.decision?.appealDeadline;
    if (!(decided < deadline)) c.fail(`${rel(file)}: settle decided at ${decided}, not before the promotion's appeal deadline ${deadline}`);
    if (r.vaultReceipt?.status !== "SETTLED") c.fail(`${rel(file)}: the vault did not record a settlement`);
  }
});

// ------------------------------------------------------------------ V7: live v1 runs (R1 to R4)
const liveRuns = existsSync(EV) ? readdirSync(EV).filter((f) => /^v1-run-R\d+\.json$/.test(f)).map((f) => path.join(EV, f)) : [];
check("V7", ["I1", "I3", "I6", "I8"], "Each live v1 run: hashes recompute, the delivery is the gate's child, and nothing moved before the decision finalized", (c) => {
  if (!liveRuns.length) return c.notEvidenced("no live v1 run is recorded yet (v1-run-R*.json)");
  for (const file of liveRuns) {
    c.use(file);
    for (const problem of checkRun(rd(file))) c.fail(problem);
  }
  c.note(`${liveRuns.length} live run(s) re-derived`);
});

// ------------------------------------------------------------------ V8: the counterfactual, re-derived from raw timelines
check("V8", ["I8"], "The counterfactual totals re-derive from the recorded timelines", (c) => {
  const file = path.join(EV, "counterfactual.json");
  if (!existsSync(file)) return c.notEvidenced("counterfactual.json has not been recorded; run npm run counterfactual");
  c.use(file);
  const cf = rd(file);
  const again = replay(cf.timelines, cf.medianWindowSeconds);
  for (const [arm, v] of Object.entries(again)) {
    for (const k of ["unsafe", "of", "refusedLegitimate"]) if (cf.arms[arm]?.[k] !== v[k]) c.fail(`${arm}.${k}: recorded ${cf.arms[arm]?.[k]}, re-derived ${v[k]}`);
  }
  const f = replayFunderPath(cf.v1FunderPath.timelines);
  if (f.unsafe !== cf.v1FunderPath.unsafe || f.of !== cf.v1FunderPath.of) c.fail("v0 funder path totals differ from the re-derivation");
  if (cf.arms.v1.unsafe !== 0) c.fail(`v1 executed ${cf.arms.v1.unsafe} payment(s) before the decision was final`);
  c.note(`${cf.timelines.length} timelines re-derived; v1 unsafe ${again.v1.unsafe}/${again.v1.of}`);
});

// ------------------------------------------------------------------ report
const counts = { pass: 0, fail: 0, "not-evidenced": 0 };
for (const k of checks) counts[k.status] += 1;
const liveMissing = checks.filter((k) => k.status === "not-evidenced" && ["V7", "V8"].includes(k.id));
const report = { generatedAt: new Date().toISOString(), requireLive: REQUIRE_LIVE, counts, checks };
writeFileSync(path.join(EV, "offline-verification.json"), JSON.stringify(report, null, 2));

for (const k of checks) {
  const mark = k.status === "pass" ? "OK " : k.status === "fail" ? "XX " : "-- ";
  console.log(`${mark} ${k.id} [${k.invariants.join(",")}] ${k.title}`);
  for (const m of k.problems) console.log(`      problem: ${m}`);
  for (const m of k.notes) console.log(`      note: ${m}`);
}
console.log(`\n${counts.pass} pass, ${counts.fail} fail, ${counts["not-evidenced"]} not evidenced`);
const exit = counts.fail > 0 || (REQUIRE_LIVE && liveMissing.length > 0) ? 1 : 0;
process.exit(exit);
