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

const CASES_PATH = path.join(REPO_ROOT, "tests", "fixtures", "cases.json");
const EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "evidence");
const REPORT_PATH = path.join(EVIDENCE_DIR, "proof-report.json");

const corpus = JSON.parse(readFileSync(CASES_PATH, "utf8"));
const report = runCorpus(corpus.cases);

const document = {
  generatedAt: new Date().toISOString(),
  source: "lib/guard/corpus.ts",
  about:
    "Replay of the settlement corpus against a provisional-scope baseline and the finality-gated intervention.",
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

log.step("Metrics");
log.info(`cases                    ${report.metrics.passing}/${report.metrics.totalCases} as expected`);
log.info(`provisional settlements blocked by the gate      ${report.metrics.provisionalSettlementsBlocked}`);
log.info(`commitment mismatches blocked                    ${report.metrics.commitmentMismatchesBlocked}`);
log.info(`replay and duplicate instructions blocked        ${report.metrics.replayAttemptsBlocked}`);
log.info(`settlements verified against a promoted decision ${report.metrics.finalizedSettlementsVerified}`);
log.info(`control                  ${report.control.outcome} -- ${report.control.detail}`);

log.step("Artifacts");
log.ok(`docs/evidence/proof-report.json`);

const failed = report.entries.filter((entry) => entry.outcome === "FAIL");
if (failed.length || report.control.outcome !== "PASS") {
  for (const entry of failed) log.fail(`${entry.id}: expected ${entry.expected}, observed ${entry.actual}`);
  if (report.control.outcome !== "PASS") log.fail(report.control.detail);
  process.exit(1);
}

log.ok("the corpus reproduces the claim");
