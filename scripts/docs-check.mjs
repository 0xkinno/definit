/**
 * Check that the documentation set is complete and internally consistent.
 *
 * Two failure modes matter more than typos:
 *
 *   * a document that references a file which does not exist, and
 *   * a document that promises a section and then does not contain it.
 *
 * Both are checked here so that "the docs are done" is a command that can fail.
 *
 * Usage:
 *
 *     npm run docs:check
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

/** Every document the submission claims to ship. */
const REQUIRED_DOCS = {
  "README.md": [
    "# DEFINIT",
    "## The Problem",
    "## The Discovery",
    "## The Solution",
    "## Why GenLayer",
    "## How It Works",
    "## Product Flow",
    "## Architecture",
    "## Finality Model",
    "## The Hard Invariant",
    "## Proof / Attack Campaign",
    "## Demo Evidence",
    "## Sponsor Integration",
    "## What Makes This Different",
    "## Target User",
    "## Stack",
    "## Honest Boundaries",
    "## Local Setup",
    "## Deployment",
    "## Roadmap",
    "```mermaid",
  ],
  "docs/DISCOVERY.md": [
    "## Sponsor primitive",
    "## Observed constraint",
    "## Evidence",
    "## Common failure",
    "## New capability",
    "## Invariant",
    "## Break case",
    "## Reproducible demo",
    "## Pinned surface",
  ],
  "docs/ARCHITECTURE.md": ["## 1. DecisionGate", "## 12. Failure handling"],
  "docs/PROOF.md": ["## Hypothesis", "## Test corpus", "## Baseline", "## Intervention", "## Control", "## Expected", "## Observed", "## Artifacts", "## Limitations"],
  "docs/EVIDENCE.md": ["## Deployment", "## Live lifecycle", "## Proof corpus", "## Reproducing"],
  "docs/LIMITATIONS.md": ["## What is not proven", "## What would falsify the claim"],
  "docs/JUDGING_MAP.md": ["## Criteria"],
  "CONTRIBUTIONS.md": ["## What is original"],
};

const LINK_PATTERN = /\]\((?!https?:|#|mailto:)([^)]+)\)/g;
const PATH_PATTERN = /`((?:app|lib|components|contracts|scripts|tests|docs|public|artifacts)\/[A-Za-z0-9._/[\]-]+)`/g;

const problems = [];

for (const [relative, headings] of Object.entries(REQUIRED_DOCS)) {
  const absolute = path.join(REPO_ROOT, relative);
  if (!existsSync(absolute)) {
    problems.push(`${relative}: missing`);
    continue;
  }
  const text = readFileSync(absolute, "utf8");
  for (const heading of headings) {
    if (!text.includes(heading)) problems.push(`${relative}: missing section "${heading}"`);
  }

  for (const match of text.matchAll(LINK_PATTERN)) {
    const target = match[1].split("#")[0].trim();
    if (!target) continue;
    if (!existsSync(path.join(REPO_ROOT, relative, "..", target)) && !existsSync(path.join(REPO_ROOT, target))) {
      problems.push(`${relative}: link target does not exist: ${target}`);
    }
  }
}

// ---------------------------------------------------------------- truth checks
//
// Three classes of defect have, at one time or another, shipped in this
// repository, and each of them is now a command that can fail.
//
//   1. A stale sentence that outlived the implementation it described.
//   2. A case count written into prose, which goes stale the first time a case
//      is added.
//   3. Two different production URLs in the same repository.

/** Sentences that describe behaviour this build does not have. */
const STALE_PHRASES = [
  "Operator fallback active",
  "operator fallback",
  "Server-side signing is disabled",
  "nine cases",
  "four releases",
  "four release cases",
  "twelve cases",
  "twelve-case",
  "appeal-simulation",
  "malformed-capability",
  "This is the only authority the vault accepts",
  "cannot observe a decision that has only reached the provisional stage",
  "can only see a decision that has already settled into consensus",
  "re-reads this contract's FINAL storage state",
  "read that capability from final storage state",
  "local replay",
  "invisible to anyone reading final state",
  "visible to a final-scope read",
  "Only a final-scope read can see",
];

/**
 * Copy that ships to a visitor, checked for the same class of sentence.
 *
 * A document is not the only place a mechanism can be misdescribed: the landing
 * page carried the disproven claim about final-scope reads for as long as the
 * documents did, and nothing was checking it.
 */
const UI_SOURCES = [
  "app/page.tsx",
  "components/landing/BoundaryToggle.tsx",
  "components/demo/LifecycleDemo.tsx",
  "components/console/ConsoleBoard.tsx",
  "components/console/NewActionForm.tsx",
  "lib/demo/rehearsal.ts",
];

/**
 * A count in front of the word "case" is a claim nobody regenerates.
 *
 * The generated report is the only place a case count is allowed to live. A
 * document refers to the report instead of restating it.
 */
const PROSE_COUNT = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\s+(?:release\s+|refusal\s+)?cases?\b/i;

/** Documents that are read by a reviewer and are not allowed to carry either. */
const PUBLIC_DOCS = [
  "README.md",
  "docs/PROOF.md",
  "docs/EVIDENCE.md",
  "docs/LIMITATIONS.md",
  "docs/DISCOVERY.md",
  "docs/ARCHITECTURE.md",
  "docs/JUDGING_MAP.md",
  "CONTRIBUTIONS.md",
  "TASK.md",
  "PROGRESS.md",
  "MILESTONES.md",
];

for (const relative of PUBLIC_DOCS) {
  const absolute = path.join(REPO_ROOT, relative);
  if (!existsSync(absolute)) continue;
  const text = readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");

  for (const phrase of STALE_PHRASES) {
    if (text.includes(phrase)) {
      problems.push(`${relative}: stale phrase "${phrase}"`);
    }
  }

  const counted = PROSE_COUNT.exec(text);
  if (counted) {
    problems.push(
      `${relative}: a case count is written into prose ("${counted[0]}"); read it from docs/evidence/proof-report.json instead`,
    );
  }
}

for (const relative of UI_SOURCES) {
  const absolute = path.join(REPO_ROOT, relative);
  if (!existsSync(absolute)) continue;
  const text = readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
  for (const phrase of STALE_PHRASES) {
    if (text.includes(phrase)) {
      problems.push(`${relative}: stale phrase in shipped copy "${phrase}"`);
    }
  }
}

// ------------------------------------------------ generated counts == corpus
const CASES_PATH = path.join(REPO_ROOT, "tests", "fixtures", "cases.json");
const REPORT_PATH = path.join(REPO_ROOT, "docs", "evidence", "proof-report.json");

if (existsSync(CASES_PATH) && existsSync(REPORT_PATH)) {
  try {
    const corpus = JSON.parse(readFileSync(CASES_PATH, "utf8"));
    const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
    const cases = corpus.cases ?? [];
    const declared = {
      total: cases.length,
      releaseExpected: cases.filter((item) => item.expected === "SETTLE").length,
      refusalExpected: cases.filter((item) => item.expected === "REFUSE").length,
    };
    const generated = report.caseCounts ?? null;

    if (!generated) {
      problems.push("docs/evidence/proof-report.json: no caseCounts field; run `npm run proof`");
    } else {
      for (const key of ["total", "releaseExpected", "refusalExpected"]) {
        if (generated[key] !== declared[key]) {
          problems.push(
            `proof-report.json caseCounts.${key} is ${generated[key]} but tests/fixtures/cases.json declares ${declared[key]}`,
          );
        }
      }
    }

    if ((report.metrics?.totalCases ?? -1) !== declared.total) {
      problems.push(
        `proof-report.json metrics.totalCases is ${report.metrics?.totalCases} but the corpus holds ${declared.total}`,
      );
    }
    if ((report.cases?.length ?? -1) !== declared.total) {
      problems.push(
        `proof-report.json lists ${report.cases?.length} case rows but the corpus holds ${declared.total}`,
      );
    }
  } catch (error) {
    problems.push(`could not reconcile the proof report with the corpus: ${error.message}`);
  }
} else {
  problems.push("the proof report is missing; run `npm run proof` before `npm run docs:check`");
}

// ------------------------------------------------------- one production URL
const URL_PATTERN = /https:\/\/[A-Za-z0-9.-]*vercel\.app[^\s)\]"'`*]*/g;
const hosts = new Map();

for (const relative of [...PUBLIC_DOCS, "docs/CLAIMS.json", "docs/evidence/summary.json"]) {
  const absolute = path.join(REPO_ROOT, relative);
  if (!existsSync(absolute)) continue;
  const text = readFileSync(absolute, "utf8");
  for (const match of text.matchAll(URL_PATTERN)) {
    const host = new globalThis.URL(match[0]).host;
    if (!hosts.has(host)) hosts.set(host, new Set());
    hosts.get(host).add(relative);
  }
}

if (hosts.size > 1) {
  for (const [host, files] of hosts) {
    problems.push(`contradictory production URL ${host} in ${[...files].join(", ")}`);
  }
}

// The app URL the application itself is configured with must be the documented one.
const documented = hosts.size === 1 ? [...hosts.keys()][0] : null;
const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
if (documented && appUrl) {
  try {
    if (new globalThis.URL(appUrl).host !== documented) {
      problems.push(
        `NEXT_PUBLIC_APP_URL points at ${new globalThis.URL(appUrl).host} but the documentation names ${documented}`,
      );
    }
  } catch {
    problems.push(`NEXT_PUBLIC_APP_URL is not a URL: ${appUrl}`);
  }
}

log.step("Documentation check");
log.info(`${Object.keys(REQUIRED_DOCS).length} documents required`);
if (documented) log.info(`production URL: ${documented}`);
if (problems.length === 0) {
  log.ok("the documentation set is complete, every link resolves, and the claims agree with the generated report");
} else {
  for (const problem of problems) log.fail(problem);
  process.exit(1);
}
