/**
 * Turn the recorded corpus run into the v2 report.
 *
 *   docs/evidence/milestone/proof-v2-report.json
 *
 * Every number is derived from tests/v2/fixtures/cases-v2.json and
 * docs/evidence/milestone/corpus-v2-results.json. The headline and every
 * breakdown are computed from the same list, and the script refuses to write a
 * report whose breakdowns do not sum to its totals. That is the fix for v1's
 * defect C9, where a headline of ten refusals named only seven.
 *
 * Invariants that no vault-state case can attack are listed with the check that
 * covers them, so the table has a row for every invariant and none is silently
 * missing.
 *
 * Usage: node scripts/proof-v2.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const cases = JSON.parse(readFileSync(path.join(REPO_ROOT, "tests", "v2", "fixtures", "cases-v2.json"), "utf8")).cases;
const results = JSON.parse(readFileSync(path.join(EV, "corpus-v2-results.json"), "utf8")).results;

const byId = new Map(results.map((r) => [r.id, r]));
const fail = (m) => { log.fail(m); process.exit(1); };
for (const c of cases) if (!byId.has(c.id)) fail(`case ${c.id} has no recorded result; run npm run test:v2:direct`);
if (results.length !== cases.length) fail(`${results.length} results for ${cases.length} cases`);

const INVARIANTS = ["I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "I10", "I11"];
const COVERED_ELSEWHERE = {
  I2: "scripts/check_no_clock.py (npm run check:no-clock), re-derived by verify-offline V3",
  I8: "live lifecycle records (v2-run-R*.json) and the spike runs, re-derived by verify-offline V4 and V7",
};

/** What each step did, as one of five outcome classes, so the totals are a partition. */
function classify(step) {
  if (step.outcome === "revert") return `refused:${step.code}`;
  if (step.outcome === "noop") return "recorded-noop";
  return "accepted";
}

const rows = INVARIANTS.map((id) => {
  const mine = cases.filter((c) => c.invariant === id);
  const ran = mine.map((c) => byId.get(c.id));
  return {
    invariant: id,
    cases: mine.length,
    passed: ran.filter((r) => r.passed).length,
    attackedBy: mine.length ? "direct-mode corpus" : COVERED_ELSEWHERE[id] ?? "UNCOVERED",
  };
});
for (const r of rows) if (r.attackedBy === "UNCOVERED") fail(`${r.invariant} has no case and no named covering check`);

const outcomeCounts = {};
let steps = 0;
for (const r of results) {
  for (const s of r.steps) {
    const kind = s.expected === "ok" && s.outcome === "ok" && !s.status ? "setup" : classify(s);
    outcomeCounts[kind] = (outcomeCounts[kind] ?? 0) + 1;
    steps += 1;
  }
}

const refusals = Object.entries(outcomeCounts).filter(([k]) => k.startsWith("refused:"));
const refusalTotal = refusals.reduce((n, [, v]) => n + v, 0);
const refusalByInvariant = Object.fromEntries(
  INVARIANTS.map((id) => {
    const n = results.filter((r) => r.invariant === id).flatMap((r) => r.steps).filter((s) => s.outcome === "revert").length;
    return [id, n];
  }),
);

const report = {
  generatedAt: new Date().toISOString(),
  source: { cases: "tests/v2/fixtures/cases-v2.json", results: "docs/evidence/milestone/corpus-v2-results.json" },
  headline: {
    cases: cases.length,
    passed: results.filter((r) => r.passed).length,
    steps,
    refusals: refusalTotal,
    recordedNoops: outcomeCounts["recorded-noop"] ?? 0,
  },
  byInvariant: rows,
  refusalsByCode: Object.fromEntries(refusals.map(([k, v]) => [k.slice("refused:".length), v]).sort()),
  refusalsByInvariant: refusalByInvariant,
  outcomeCounts,
};

// Reconciliation. A breakdown that does not sum to its headline is a bug, not a rounding.
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const checks = [
  ["cases by invariant sum to the headline", sum(rows.map((r) => r.cases)) === report.headline.cases],
  ["passed by invariant sum to the headline", sum(rows.map((r) => r.passed)) === report.headline.passed],
  ["refusals by code sum to the headline", sum(Object.values(report.refusalsByCode)) === report.headline.refusals],
  ["refusals by invariant sum to the headline", sum(Object.values(refusalByInvariant)) === report.headline.refusals],
  ["outcome classes partition every step", sum(Object.values(outcomeCounts)) === steps],
];
for (const [name, ok] of checks) if (!ok) fail(`reconciliation failed: ${name}`);
report.reconciliation = checks.map(([name]) => `${name}: ok`);
if (report.headline.passed !== report.headline.cases) fail(`${report.headline.cases - report.headline.passed} case(s) did not pass`);

writeFileSync(path.join(EV, "proof-v2-report.json"), JSON.stringify(report, null, 2));
log.ok(`proof-v2-report.json: ${report.headline.cases} cases, ${report.headline.refusals} refusals named by code (${Object.keys(report.refusalsByCode).length} codes), ${report.headline.recordedNoops} recorded no-ops`);
for (const r of rows) log.info(`${r.invariant}: ${r.cases} case(s), ${r.passed} passed (${r.attackedBy})`);
