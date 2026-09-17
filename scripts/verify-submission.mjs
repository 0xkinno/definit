/**
 * The submission gate.
 *
 * Runs every check that can fail and refuses to be satisfied by a partial
 * pass. Each step is one command a reader can run on its own; this script
 * exists so that "is it finished?" has a single answer.
 *
 * Usage:
 *
 *     npm run verify:submission
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const EVIDENCE_DIR = path.join(REPO_ROOT, "docs", "evidence");
const RECORD_PATH = path.join(EVIDENCE_DIR, "submission-check.json");

const STEPS = [
  { label: "TypeScript type check", command: "npm", args: ["run", "typecheck"] },
  { label: "Contracts compile against the live GenVM", command: "npm", args: ["run", "contracts:check"] },
  { label: "Settlement corpus", command: "npm", args: ["run", "proof"] },
  { label: "Generated evidence", command: "npm", args: ["run", "evidence"] },
  { label: "Shipped-tree isolation audit", command: "npm", args: ["run", "audit:isolation"] },
  { label: "Documentation completeness", command: "npm", args: ["run", "docs:check"] },
];

const REQUIRED_ARTIFACTS = [
  "artifacts/deployment.json",
  "docs/evidence/proof-report.json",
  "docs/CLAIMS.json",
  "docs/evidence/isolation-audit.json",
];

const failures = [];
const results = [];

for (const step of STEPS) {
  log.step(step.label);
  const result = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = result.status === 0;
  results.push({
    label: step.label,
    command: `${step.command} ${step.args.join(" ")}`,
    exitCode: result.status,
    ok,
  });
  if (!ok) {
    log.fail(`${step.label} failed`);
    failures.push(step.label);
  } else {
    log.ok(step.label);
  }
}

log.step("Required artifacts");
const artifacts = REQUIRED_ARTIFACTS.map((relative) => {
  const present = existsSync(path.join(REPO_ROOT, relative));
  if (present) log.ok(relative);
  else {
    log.fail(`${relative} is missing`);
    failures.push(relative);
  }
  return { path: relative, present };
});

/**
 * The record is written before the verdict is acted on, so a failed run leaves
 * behind exactly which step failed rather than an older passing record.
 */
mkdirSync(EVIDENCE_DIR, { recursive: true });
writeFileSync(
  RECORD_PATH,
  JSON.stringify(
    {
      about:
        "The output of `npm run verify:submission`: every step that can fail, the command that runs it, and whether it passed. Written by the gate itself.",
      generatedAt: new Date().toISOString(),
      steps: results,
      requiredArtifacts: artifacts,
      blockingTask: "T-P9-002 (frontend hosting) -- the production build passes; publication needs a hosting account this environment does not hold.",
      ok: failures.length === 0,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

log.step("Submission");
if (failures.length) {
  log.fail(`${failures.length} step(s) failed; see docs/evidence/submission-check.json`);
  process.exit(1);
}
log.ok("every check passed");
log.ok("docs/evidence/submission-check.json");
