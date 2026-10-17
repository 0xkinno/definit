/**
 * The counterfactual: four payment rules, one set of real protocol timelines.
 *
 *   npm run counterfactual     writes docs/evidence/milestone/counterfactual.json
 *
 * Each timeline is a real recorded decision with chain timestamps. Each rule
 * decides when it would have paid. A payment is unsafe if it executes before the
 * deciding decision was final (its appeal deadline). The replay rules are the
 * functions below, in full, and docs/milestone/PROOF_V2.md reproduces them.
 *
 * Only approvals are timelines: a refused payment is paid by no rule.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const SPIKE = path.join(EV, "spike");
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** The replay rules. Each returns the chain time at which the rule would pay. */
export const RULES = {
  baseline: (t) => t.acceptedAt, // pays when the deciding transaction is Accepted
  control: (t, ctx) => t.acceptedAt + ctx.medianWindowSeconds, // a fixed delay equal to the measured window
  v1: (t) => t.acceptedAt + 120, // v1's rule: its own 120 second constant, then promotion
  v2: (t) => t.deliveryAt, // pays only on the finalized delivery
};
export const unsafe = (executeAt, t) => executeAt < t.finalAt;

export function replay(timelines, medianWindowSeconds) {
  const ctx = { medianWindowSeconds };
  const arms = {};
  for (const [name, rule] of Object.entries(RULES)) {
    const exec = timelines.map((t) => rule(t, ctx));
    arms[name] = {
      unsafe: timelines.filter((t, i) => unsafe(exec[i], t)).length,
      of: timelines.length,
      refusedLegitimate: timelines.filter((t) => t.deliveryAt == null && name === "v2").length,
      medianSecondsFromFinalToPayment: median(timelines.map((t, i) => exec[i] - t.finalAt)),
    };
  }
  return arms;
}

export function replayFunderPath(e6) {
  return { unsafe: e6.filter((r) => r.settleDecidedAt < r.promotionFinalAt).length, of: e6.length };
}

function firstAccepted(samples) {
  const s = samples.find((x) => (x.lifecycle?.projectedStatus ?? x.projectedStatus) === "Accepted");
  return s ? (s.lifecycle?.evaluatedAt ?? s.evaluatedAt) : null;
}

function collect() {
  const timelines = [];
  const add = (id, source, acceptedAt, finalAt, deliveryAt, appealed) => timelines.push({ id, source, acceptedAt, finalAt, deliveryAt, appealed });
  const spikeFiles = [];
  for (const d of readdirSync(SPIKE, { withFileTypes: true })) {
    if (d.isDirectory() && d.name.startsWith("repro-")) for (const n of [1, 2, 3]) spikeFiles.push([`${d.name}/e1d${n}`, path.join(SPIKE, d.name, `run-e1d${n}.json`)]);
  }
  for (const n of [1, 2, 3]) spikeFiles.push([`e1d${n}`, path.join(SPIKE, `run-e1d${n}.json`)]);
  spikeFiles.push(["e2a", path.join(SPIKE, "run-e2a.json")]);
  for (const [id, f] of spikeFiles) {
    if (!existsSync(f)) continue;
    const r = rd(f);
    const d = r.finalTx.latestDecision;
    const child = r.children?.[0];
    if (!child) continue;
    const appealed = id === "e2a";
    add(id, path.relative(REPO_ROOT, f).replace(/\\/g, "/"), appealed ? firstAccepted(r.samples) : d.materializedAt, d.appealDeadline, Number(child.created_timestamp), appealed);
  }
  for (const f of readdirSync(EV).filter((x) => /^v2-run-(R\d+|T\d+)\.json$/.test(x))) {
    const r = rd(path.join(EV, f));
    if (r.adjudication?.verdict !== "APPROVE" || !r.delivery) continue;
    const appealed = Boolean(r.adjudication.appeal && !r.adjudication.appeal.error);
    const accepted = appealed ? firstAccepted(r.adjudication.lifecycleSamples) : r.adjudication.materializedAt;
    add(r.run, `docs/evidence/milestone/${f}`, accepted, r.adjudication.finalAppealDeadline, r.delivery.createdTimestamp, appealed);
  }
  return timelines;
}

function collectE6() {
  const out = [];
  const files = [path.join(SPIKE, "e6-h1-v1-run2.json")];
  for (const d of readdirSync(SPIKE, { withFileTypes: true })) if (d.isDirectory() && d.name.startsWith("repro-")) files.push(path.join(SPIKE, d.name, "e6-h1-v1-run1.json"));
  for (const f of files) {
    if (!existsSync(f)) continue;
    const r = rd(f);
    if (!r.settle?.decision) continue;
    out.push({ source: path.relative(REPO_ROOT, f).replace(/\\/g, "/"), settleDecidedAt: r.settle.decision.materializedAt, promotionFinalAt: r.promotion.decision.appealDeadline });
  }
  return out;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const timelines = collect();
  const windows = timelines.filter((t) => !t.appealed).map((t) => t.finalAt - t.acceptedAt);
  const medianWindowSeconds = median(windows);
  const e6 = collectE6();
  const result = {
    generatedAt: new Date().toISOString(),
    about: "Four payment rules replayed over the same recorded protocol timelines. Unsafe means paid before the deciding decision's appeal deadline.",
    medianWindowSeconds,
    timelines,
    arms: replay(timelines, medianWindowSeconds),
    v1FunderPath: { ...replayFunderPath(e6), timelines: e6, note: "v1's vault lets the funder trigger settle once the promotion is Accepted (spike E6)." },
    caveats: [
      "The timelines are real but few; this is a count over them, not a statistic over all timelines.",
      "An appeal's outcome is whatever the committee returned. No overturn was engineered or observed, and none is claimed.",
      "v1's 120 second constant exceeds the measured window here, so its timer arm is safe on these timelines; its funder path is the measured gap.",
    ],
  };
  writeFileSync(path.join(EV, "counterfactual.json"), JSON.stringify(result, null, 2));
  log.ok(`counterfactual.json: ${timelines.length} timelines, median window ${medianWindowSeconds}s`);
  for (const [k, v] of Object.entries(result.arms)) log.info(`${k}: ${v.unsafe}/${v.of} unsafe, ${v.refusedLegitimate} legitimate refused`);
  log.info(`v1 funder path: ${result.v1FunderPath.unsafe}/${result.v1FunderPath.of} unsafe`);
}
