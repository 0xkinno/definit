/**
 * Steward diff: what is new in the milestone, measured between two fixed commits.
 *
 *   node scripts/steward-diff.mjs
 *
 * BASE is the last rewarded revision. HEAD is the commit that changes code last
 * in the milestone. Everything below is read from git; nothing is typed.
 *
 *   1. The rewarded v0 contracts must be byte-identical at HEAD.
 *   2. A per-area breakdown, with generated evidence counted apart from code, and
 *      each number given twice: raw, and ignoring end-of-line changes (some files
 *      were rewritten with different line endings, which inflates raw counts).
 *   3. Every file that existed at BASE and was modified, with a reason. The script
 *      fails if a modified file has no stated reason.
 *   4. The commit list.
 *
 * Writes docs/evidence/milestone/diff-summary.json. Exits non-zero if the rewarded
 * contracts changed or a modified file has no reason.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

export const BASE = "b903f9423b46dfa45e87ac8db7d8d48edc167119";
export const HEAD = "2b45ea5e34d17aa6e89045bff94df9405a139a79";
const git = (...args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).replace(/\r/g, "");

const REWARDED = ["contracts/decision_gate.py", "contracts/finality_vault.py", "contracts/scenario_registry.py", "contracts/control/"];

const REASONS = {
  ".gitignore": "ignores the private reference/ folder and tracks research/spike; the rest is a line-ending rewrite",
  "MILESTONES.md": "adds the Milestone v1 rows (generated block)",
  "README.md": "adds the Milestone v1 section (generated block) and v0 baseline notes",
  "app/console/page.tsx": "now renders the v1 console; the accepted console moved to app/console/v0/page.tsx with its title and eyebrow relabelled as v0",
  "app/page.tsx": "landing hero rewritten to state the problem and show the generated proof line",
  "app/proof/page.tsx": "adds the live v1 contract addresses and the refusal breakdown, both read from generated data",
  "components/Shell.tsx": "adds the Milestone v1 navigation item and a 44px brand-link touch target",
  "docs/ARCHITECTURE.md": "adds the v1 architecture section (generated block)",
  "docs/JUDGING_MAP.md": "adds the Milestone v1 criteria table (generated block)",
  "docs/LIMITATIONS.md": "adds the Milestone v1 limits (generated block) and a v0 note on the fee blob; line endings also normalized",
  "lib/commitments/commitment.ts": "adds the v1 decision-id domain, lets amount be a bigint or string (found by the parity suite), and lets decisionIdOf take a domain",
  "package-lock.json": "lockfile for the new workspace and pinned toolchain dependencies; line endings normalized",
  "package.json": "adds the v1 scripts, the packages/* workspace and the pinned Transaction Kit packages",
  "scripts/audit-isolation.mjs": "excludes the private reference/ folder from the shipped-tree audit",
  "scripts/docs-check.mjs": "adds a check that no current document presents the v0 appeal-window constant as live behaviour",
  "scripts/run-python.mjs": "adds a default local runner hash and a pinned interpreter for the direct-mode suites",
  "scripts/validate-contracts.mjs": "also compiles the three v1 contracts on the network before deployment",
  "tests/e2e/a11y.spec.ts": "adds the /console/v0 route",
  "tests/e2e/production.spec.ts": "points the accepted-console test at /console/v0",
  "tests/e2e/responsive.spec.ts": "adds the /console/v0 route and exempts the visually hidden skip link from the touch-target check",
  "vitest.config.ts": "includes the definit-guard package tests",
};

const AREAS = ["contracts/v1/", "lib/", "app/", "components/", "packages/definit-guard/", "skills/", "examples/", "scripts/", "tests/", "docs/"];

const isGenerated = (p) =>
  p.startsWith("docs/evidence/") || p === "lib/milestone/data.generated.json" || p === "package-lock.json" ||
  p.startsWith("contracts/v1/build/") || p === "fee-profile.json" || p === "lib/fees/fee-profile.json" ||
  p === "tests/v1/fixtures/parity-vectors.json" || p.startsWith("artifacts/");

function numstat(extra = []) {
  const rows = new Map();
  for (const line of git("diff", "--numstat", "-M", ...extra, BASE, HEAD).split("\n").filter(Boolean)) {
    const [a, d, ...rest] = line.split("\t");
    rows.set(rest.join("\t"), { added: Number(a), removed: Number(d) });
  }
  return rows;
}
const raw = numstat();
const effective = numstat(["--ignore-space-at-eol"]);
const status = new Map(git("diff", "--name-status", BASE, HEAD).split("\n").filter(Boolean).map((l) => { const [s, ...r] = l.split("\t"); return [r[r.length - 1], s[0]]; }));

// 1. rewarded contracts untouched
const rewardedDiff = git("diff", "--stat", BASE, HEAD, "--", ...REWARDED).trim();
const rewarded = { paths: REWARDED, diffStat: rewardedDiff, identical: rewardedDiff === "" };

// 2. areas
const sum = (files, src) => files.reduce((s, f) => ({ added: s.added + (src.get(f)?.added ?? 0), removed: s.removed + (src.get(f)?.removed ?? 0) }), { added: 0, removed: 0 });
function bucket(prefix) {
  const files = [...status.keys()].filter((f) => f.startsWith(prefix));
  const gen = files.filter(isGenerated), hand = files.filter((f) => !isGenerated(f));
  const pick = (list, s) => list.filter((f) => status.get(f) === s).length;
  return {
    area: prefix,
    files: files.length,
    handWritten: { files: hand.length, added: pick(hand, "A"), modified: pick(hand, "M"), lines: sum(hand, effective), linesRaw: sum(hand, raw) },
    generated: { files: gen.length, added: pick(gen, "A"), modified: pick(gen, "M"), lines: sum(gen, effective) },
  };
}
const areas = AREAS.map(bucket);
const covered = new Set(areas.flatMap((a) => [...status.keys()].filter((f) => f.startsWith(a.area))));
const otherFiles = [...status.keys()].filter((f) => !covered.has(f));
const other = { area: "other (root files, artifacts, research/spike, requirements)", files: otherFiles.length, list: otherFiles };

const allFiles = [...status.keys()];
const total = {
  files: allFiles.length,
  added: allFiles.filter((f) => status.get(f) === "A").length,
  modified: allFiles.filter((f) => status.get(f) === "M").length,
  deleted: allFiles.filter((f) => status.get(f) === "D").length,
  rawLines: sum(allFiles, raw),
  linesIgnoringEol: sum(allFiles, effective),
  handWrittenLinesIgnoringEol: sum(allFiles.filter((f) => !isGenerated(f)), effective),
  generatedLinesIgnoringEol: sum(allFiles.filter(isGenerated), effective),
};

// 3. modified files, each with a reason
const modified = allFiles.filter((f) => status.get(f) === "M").map((f) => ({
  path: f, reason: REASONS[f] ?? null, rawLines: raw.get(f) ?? null, linesIgnoringEol: effective.get(f) ?? null,
}));
const unexplained = modified.filter((m) => !m.reason).map((m) => m.path);
const eolRewritten = modified
  .filter((m) => m.rawLines && m.linesIgnoringEol && m.rawLines.added + m.rawLines.removed > 2 * (m.linesIgnoringEol.added + m.linesIgnoringEol.removed) + 20)
  .map((m) => ({ path: m.path, raw: m.rawLines, ignoringEol: m.linesIgnoringEol }));

// the milestone contracts, file by file
const contracts = allFiles.filter((f) => f.startsWith("contracts/v1/")).map((f) => ({ path: f, status: status.get(f), lines: raw.get(f)?.added ?? 0, generated: isGenerated(f) }));

// 4. commits
const commits = git("log", "--reverse", "--format=%H%x09%an <%ae>%x09%cI%x09%s", `${BASE}..${HEAD}`).split("\n").filter(Boolean).map((l) => { const [sha, author, date, ...s] = l.split("\t"); return { sha, author, date, subject: s.join("\t") }; });

const out = {
  generatedAt: new Date().toISOString(),
  base: BASE, head: HEAD,
  compare: `https://github.com/0xkinno/definit/compare/${BASE}...${HEAD}`,
  rewardedContracts: rewarded,
  total, areas, other, modified, eolRewritten, contracts, commits,
  note: "Line counts are given ignoring end-of-line changes. Some files were rewritten with different line endings, which inflates raw counts; both are recorded.",
};
writeFileSync(path.join(REPO_ROOT, "docs", "evidence", "milestone", "diff-summary.json"), JSON.stringify(out, null, 2));

log.step("Steward diff");
log.info(`${total.files} files: ${total.added} added, ${total.modified} modified, ${total.deleted} deleted; ${commits.length} commits`);
log.info(`hand-written ${total.handWrittenLinesIgnoringEol.added} added / ${total.handWrittenLinesIgnoringEol.removed} removed; generated ${total.generatedLinesIgnoringEol.added} / ${total.generatedLinesIgnoringEol.removed} (ignoring end-of-line changes)`);
for (const a of areas) log.info(`${a.area.padEnd(26)} ${String(a.handWritten.files).padStart(3)} hand-written (+${a.handWritten.lines.added}) ${String(a.generated.files).padStart(3)} generated`);
if (!rewarded.identical) { log.fail("the rewarded v0 contracts differ from base"); process.exit(1); }
log.ok("the rewarded v0 contracts are byte-identical at head");
if (unexplained.length) { for (const p of unexplained) log.fail(`modified file without a reason: ${p}`); process.exit(1); }
log.ok(`every one of the ${modified.length} modified files has a stated reason`);
