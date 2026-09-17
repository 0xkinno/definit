/**
 * Prove that no reference material leaked into the shipped tree.
 *
 * The repository keeps its reading material in `research/`, which is excluded
 * from version control. This audit walks everything that *is* shipped and fails
 * if it finds a term that would indicate leakage.
 *
 * The term list is assembled from fragments on purpose. If the forbidden words
 * appeared literally in this file, this file would be the leak it is looking
 * for.
 *
 * Usage:
 *
 *     npm run audit:isolation
 */

import { readdirSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

/** Directories that are not part of the submission. */
const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".gltest-home",
  "research",
  "__pycache__",
  ".pytest_cache",
  "out",
  "coverage",
  "playwright-report",
  "test-results",
  ".vercel",
  ".turbo",
]);

/** Files and suffixes not worth scanning. */
const EXCLUDED_SUFFIXES = [
  ".png", ".jpg", ".jpeg", ".webp", ".ico", ".pdf",
  ".woff", ".woff2", ".ttf", ".zip", ".lock",
  ".pyc", ".pyo", ".tsbuildinfo",
];

const EXCLUDED_FILES = new Set([
  "package-lock.json",
  "tsconfig.tsbuildinfo",
  "isolation-audit.json",
  "proof-report.json",
]);

/**
 * Built from fragments so that this file does not itself contain the terms.
 * Matching uses word boundaries, so an ordinary English word that merely
 * contains a listed name as a substring is not reported.
 */
const TERM_FRAGMENTS = [
  ["compe", "titor"],
  ["compe", "titors"],
  ["compe", "titive"],
  ["compe", "tition"],
  ["gend", "are"],
  ["night", "-shift"],
  ["meaning", "nonce"],
  ["guar", "dian"],
  ["aegis", "flow"],
  ["re", "course"],
  ["agent", "-escrow"],
  ["x402", "proof"],
  ["soy", "ara"],
  ["trust", "gate"],
  ["proof-of-", "sweat"],
  ["translate", "check"],
  ["rag-", "bench"],
  ["jal", "in"],
];

const TERMS = TERM_FRAGMENTS.map((parts) => parts.join(""));
const PATTERNS = TERMS.map((term) => ({
  // Only a fingerprint is ever recorded. Writing the matched word into the
  // report would put the leak inside the artefact that proves there is no leak.
  fingerprint: createHash("sha256").update(term).digest("hex").slice(0, 12),
  regex: new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"),
}));

function* walk(directory) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    // A directory the process cannot enumerate is not part of the shipped tree
    // in any way that matters, and a filesystem permission error must not be
    // mistaken for a leak.
    return;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith("pytest-cache-files-")) continue;
      yield* walk(absolute);
      continue;
    }
    if (EXCLUDED_FILES.has(entry.name)) continue;
    if (EXCLUDED_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    try {
      if (!statSync(absolute).isFile()) continue;
    } catch {
      continue;
    }
    yield absolute;
  }
}

const findings = [];
let scanned = 0;

for (const absolute of walk(REPO_ROOT)) {
  let text;
  try {
    text = readFileSync(absolute, "utf8");
  } catch {
    continue;
  }
  scanned += 1;
  const lines = text.split(/\r?\n/);
  for (const { fingerprint, regex } of PATTERNS) {
    for (let index = 0; index < lines.length; index += 1) {
      if (regex.test(lines[index])) {
        findings.push({
          file: path.relative(REPO_ROOT, absolute).split(path.sep).join("/"),
          line: index + 1,
          fingerprint,
        });
      }
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  root: ".",
  filesScanned: scanned,
  termsChecked: TERMS.length,
  findings,
  clean: findings.length === 0,
};

const outDir = path.join(REPO_ROOT, "docs", "evidence");
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, "isolation-audit.json"), JSON.stringify(report, null, 2), "utf8");

log.step("Isolation audit");
log.info(`${scanned} files scanned against ${TERMS.length} terms`);
if (findings.length === 0) {
  log.ok("no reference material found in the shipped tree");
} else {
  for (const finding of findings.slice(0, 40)) {
    log.fail(`${finding.file}:${finding.line} contains term #${finding.fingerprint}`);
  }
  if (findings.length > 40) log.fail(`... and ${findings.length - 40} more`);
  process.exit(1);
}
