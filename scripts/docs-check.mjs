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

log.step("Documentation check");
log.info(`${Object.keys(REQUIRED_DOCS).length} documents required`);
if (problems.length === 0) {
  log.ok("the documentation set is complete and every link resolves");
} else {
  for (const problem of problems) log.fail(problem);
  process.exit(1);
}
