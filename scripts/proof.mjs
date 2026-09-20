/**
 * Run the settlement corpus and write the report the application reads.
 *
 * The corpus itself lives in `lib/guard/corpus.ts` and the two arms live in
 * `lib/guard/baseline.ts` and `lib/guard/finality.ts`. The intervention arm is
 * a line-for-line mirror of `contracts/finality_vault.py`, so the report
 * describes the logic that is actually deployed rather than a retelling of it.
 *
 * Every number in `docs/PROOF.md` and on the evidence screens comes from the
 * file this writes. Nothing is typed by hand.
 *
 * Usage:
 *
 *     npm run proof
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";
import { runCorpus } from "../lib/guard/corpus.ts";
import {
  caseCountsFrom,
  countsAgree,
  describeCounts,
  observedCounts,
} from "../lib/guard/counts.ts";

const CASES_PATH = path.join(REPO_ROOT, "tests", "fixtures", "cases.json");
const EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "evidence");
const REPORT_PATH = path.join(EVIDENCE_DIR, "proof-report.json");

const corpus = JSON.parse(readFileSync(CASES_PATH, "utf8"));
const cases = corpus.cases;
const report = runCorpus(cases);

/**
 * Counts, derived from the case definitions and from the run.
 *
 * Nothing here is typed by hand. `caseCounts` is the only number a screen or a
 * document is allowed to quote for "how many cases", and it is computed twice:
 * once from what each case says should happen, and once from what actually
 * happened. If those two disagree, the run is wrong and this script fails,
 * because a report that contradicts its own corpus is worse than no report.
 */
const expectedCounts = caseCountsFrom(cases);
const observed = observedCounts(report.entries, (entry) => entry.intervention.released);
const caseCounts = expectedCounts;

const document = {
  generatedAt: new Date().toISOString(),
  source: "lib/guard/corpus.ts",
  about:
    "Replay of the settlement corpus against a provisional-scope baseline and the finality-gated intervention.",
  caseCounts,
  arms: report.arms,
  metrics: report.metrics,
  cases: report.entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    invariant: entry.invariant,
    expected: entry.expected,
    actual: entry.actual,
    outcome: entry.outcome,
    detail: entry.detail,
  })),
  control: report.control,
  baseline: report.entries.map((entry) => ({
    id: entry.id,
    released: entry.baseline.released,
    code: entry.baseline.code,
  })),
};

mkdirSync(EVIDENCE_DIR, { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify(document, null, 2) + "\n", "utf8");

log.step("Settlement corpus");
for (const entry of report.entries) {
  const mark = entry.outcome === "PASS" ? "OK " : "XX ";
  log.info(`${mark} ${entry.id}: ${entry.actual}`);
}

log.step("Arms");
for (const arm of report.arms) {
  log.info(
    `${arm.label}: ${arm.settlementsFromProvisional} provisional settlement(s), ` +
      `${arm.duplicateSettlements} duplicate(s), ` +
      `${arm.commitmentMismatchesAccepted} commitment mismatch(es) accepted, ` +
      `${arm.settledBoundToFinalized} bound to finality`,
  );
}

log.step("Counts");
log.info(describeCounts(caseCounts));

log.step("Metrics");
log.info(`cases                    ${report.metrics.passing}/${report.metrics.totalCases} as expected`);
log.info(`provisional settlements blocked by the gate      ${report.metrics.provisionalSettlementsBlocked}`);
log.info(`commitment mismatches blocked                    ${report.metrics.commitmentMismatchesBlocked}`);
log.info(`replay and duplicate instructions blocked        ${report.metrics.replayAttemptsBlocked}`);
log.info(`settlements verified against a promoted decision ${report.metrics.finalizedSettlementsVerified}`);
log.info(`control                  ${report.control.outcome} -- ${report.control.detail}`);

log.step("Artifacts");
log.ok(`docs/evidence/proof-report.json`);

/**
 * The consistency gate.
 *
 * `npm run proof` fails if the generated counts disagree with the case
 * definitions, if the report's own case count disagrees with the source corpus,
 * or if any case's observed outcome differs from its expected outcome. That is
 * what stops a stale sentence in a document from outliving the corpus it
 * describes.
 */
const failures = [];

if (!countsAgree(expectedCounts, observed)) {
  failures.push(
    `count mismatch: the corpus declares ${describeCounts(expectedCounts)}, the run observed ${describeCounts(observed)}`,
  );
}

if (report.metrics.totalCases !== cases.length) {
  failures.push(
    `report case count ${report.metrics.totalCases} differs from the source corpus count ${cases.length}`,
  );
}

if (report.metrics.passing !== cases.length) {
  failures.push(
    `report passing count ${report.metrics.passing} differs from the source corpus count ${cases.length}`,
  );
}

for (const entry of report.entries) {
  if (entry.expected !== entry.actual) {
    failures.push(`${entry.id}: expected ${entry.expected}, observed ${entry.actual}`);
  }
  if (entry.outcome === "FAIL") {
    failures.push(`${entry.id}: outcome FAIL`);
  }
}

if (report.control.outcome !== "PASS") {
  failures.push(`control arm: ${report.control.detail}`);
}

if (failures.length) {
  for (const line of failures) log.fail(line);
  process.exit(1);
}

log.ok("the corpus reproduces the claim");
