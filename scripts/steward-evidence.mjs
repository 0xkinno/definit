/**
 * Builds docs/milestone/STEWARD_EVIDENCE.md and checks every link in it.
 *
 *   node scripts/steward-evidence.mjs            build the document, verify every line anchor
 *   node scripts/steward-evidence.mjs --links    also fetch every URL and write steward-links.json
 *
 * Every source link is a permalink pinned to a full 40-character SHA with a line
 * range. The range is not typed: it is found by searching the file at that SHA for
 * the function it names, and the first and last line found are written to
 * steward-links.json so the claim "this range shows that function" can be read.
 * Numbers come from the generated evidence files. Nothing links to a branch.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const BASE = "b903f9423b46dfa45e87ac8db7d8d48edc167119";
const HEAD = "2b45ea5e34d17aa6e89045bff94df9405a139a79";
const REPO = "https://github.com/0xkinno/definit";
const EXPLORER = "https://explorer-studio-dev.genlayer.com";
const LIVE = "https://definit-snowy.vercel.app";

const git = (...a) => execFileSync("git", a, { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).replace(/\r/g, "");
const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const rd = (f) => JSON.parse(readFileSync(path.join(EV, f), "utf8"));
const fileAt = (sha, p) => git("show", `${sha}:${p}`);

// ---------------------------------------------------------------- anchors
// start: regex for the first line. end: regex for the last line (searched from the start line);
// endBefore: the last non-blank line before the first line matching it; endOffset: lines past the end match.
const A = [];
const ALIAS = {};
function anchor(id, sha, p, start, o = {}) {
  A.push({ id, sha, path: p, start, ...o });
}
const G = "contracts/v1/decision_gate.py", V = "contracts/v1/finality_vault.py", R = "contracts/v1/scenario_registry.py";
anchor("g_adj", HEAD, G, /def request_adjudication/, { end: /return self\._record_outcome/ });
anchor("g_emit", HEAD, G, /vault = gl\.contract\.get_at\(self\.vault\)/, { end: /^			\)$/, endNth: 2 });
anchor("g_rec", HEAD, G, /def _record_outcome/, { end: /self\.actions\[action_id\] = _dump\(action\)/ });
anchor("g_describe", HEAD, G, /def describe\(self\)/, { end: /'clock': 'none'/, endOffset: 1 });
anchor("g_never", HEAD, G, /What this contract never does/, { end: /emits the other message/ });
anchor("g_constraints", HEAD, G, /Measured constraints this file is written around/, { end: /\(O5\)\./ });
anchor("v_header", HEAD, V, /^Release authority is a delivery/, { end: /\(I11\)\./ });
anchor("v_open", HEAD, V, /def open_escrow/, { end: /if int\(action\['deadline_unix'\]\) != deadline_unix/, endOffset: 1 });
anchor("v_auth", HEAD, V, /def authorize_release/, { end: /'finality_source': FINALITY_SOURCE,/, endNth: 2, endOffset: 1 });
anchor("v_sender", HEAD, V, /# I1 -- only a message whose sender is the bound gate/, { end: /ERR_UNAUTHORIZED_SENDER\)/ });
anchor("v_dup", HEAD, V, /# I4, I11 -- a delivery that finds the escrow already closed/, { end: /'status': 'NOOP'/ });
anchor("v_deadline", HEAD, V, /# I7 -- a release that arrives after the deadline/, { end: /'status': 'EXPIRED'/ });
anchor("v_commit", HEAD, V, /# I3 -- every delivered field must equal/, { end: /if str\(intent_hash\) != recomputed:/, endOffset: 1 });
anchor("v_transfer", HEAD, V, /gl\.chain\.Account\(Address\(str\(escrow\['recipient'\]\)\)\)\.emit_transfer/, { end: /on='finalized'/, endOffset: 1 });
anchor("v_close", HEAD, V, /def close_refused/, { end: /'reason_code': reason_code\}/ });
anchor("v_withdraw", HEAD, V, /def withdraw_refund/, { end: /'status': STATE_WITHDRAWN, 'amount'/ });
anchor("v_reclaim", HEAD, V, /def reclaim_after_deadline/, { end: /'status': STATE_RECLAIMED/ });
anchor("v_json", HEAD, V, /# Records are JSON strings in a TreeMap/, { end: /neither\./ });
anchor("r_head", HEAD, R, /The v1 policy registry with identical behaviour/, { end: /path and no administrative override\./ });
anchor("r_publish", HEAD, R, /def publish_policy/, { end: /return policy_hash/ });
anchor("b_final", BASE, "contracts/decision_gate.py", /def finalize_decision/, { endBefore: /^\t@gl\.public/ });
anchor("b_window", BASE, "contracts/decision_gate.py", /^APPEAL_WINDOW_SECONDS = 120/, { end: /^APPEAL_WINDOW_SECONDS = 120/ });
anchor("b_settle", BASE, "contracts/finality_vault.py", /def settle\(/, { endBefore: /^	@gl\.public/ });
anchor("b_funder", BASE, "contracts/finality_vault.py", /The funder is allowed to \*ask\*/, { end: /ERR_UNAUTHORIZED_CALLER\)/ });
anchor("b_guard6c", BASE, "contracts/finality_vault.py", /Guard 6c/, { end: /ERR_DECISION_NOT_FINAL\)/ });
const P = "packages/definit-guard/src";
anchor("a_open", HEAD, `${P}/payments.ts`, /export async function openGuardedPayment/, { end: /^\}$/ });
anchor("a_receipt", HEAD, `${P}/payments.ts`, /export async function receipt/, { end: /^\}$/ });
anchor("a_settled", HEAD, `${P}/payments.ts`, /export async function settled/, { end: /^\}$/ });
anchor("a_contest", HEAD, `${P}/payments.ts`, /export async function contest/, { end: /^\}$/ });
anchor("a_refund", HEAD, `${P}/payments.ts`, /export async function refund/, { end: /^\}$/ });
anchor("a_msgalloc", HEAD, `${P}/kit.ts`, /export function withMessageAllocations/, { end: /^\}$/ });
anchor("a_kitctx", HEAD, `${P}/kit.ts`, /export function kitContext/, { end: /^\}$/ });
anchor("a_finality", HEAD, `${P}/finality.ts`, /export function finalityOf/, { end: /^\}$/ });
anchor("a_watch", HEAD, `${P}/finality.ts`, /export async function\* watchFinality/, { end: /^\}$/ });
const F = "scripts/lib/v1-flow.mjs";
anchor("f_write", HEAD, F, /export async function write\(/, { end: /^\}$/ });
anchor("f_run", HEAD, F, /export async function runPayment/, { end: /^\}$/ });
anchor("f_create", HEAD, F, /\/\/ 1\. propose/, { end: /step\("create_action"/ });
anchor("f_fund", HEAD, F, /\/\/ 2\. fund\./, { end: /record\.vault = \{ escrowBefore \}/ });
anchor("f_adj", HEAD, F, /\/\/ 3\. adjudicate\./, { end: /step\("request_adjudication submitted"/ });
anchor("f_appeal", HEAD, F, /if \(appeal && !appealed/, { end: /^    \}$/ });
anchor("f_child", HEAD, F, /if \(finalizedAtMs && !childHash\)/, { end: /^    \}$/ });
anchor("f_delivery", HEAD, F, /if \(childHash\) \{/, { end: /^  \}$/ });
anchor("f_refund", HEAD, F, /\/\/ 6\. a refusal sends the value home/, { end: /record\.vault\.escrowAfterWithdraw = / });
anchor("l_lifecycle", HEAD, "scripts/lib/chain.mjs", /export const lifecycle =/, { end: /export const lifecycle =/ });
const C = "components/console/V1Console.tsx";
anchor("c_handlers", HEAD, C, /const propose = \(\) =>/, { end: /const withdraw = \(\) =>/ });
anchor("c_send", HEAD, C, /async function send\(/, { end: /^  \}$/ });
anchor("c_poll", HEAD, C, /Poll the protocol's own lifecycle/, { end: /return \(\) => \{ stop = true; clearInterval\(t\); \};/, endOffset: 1 });
anchor("c_quote", HEAD, "lib/v1/console.ts", /export async function quoteWrite/, { end: /^\}$/ });
anchor("c_submit", HEAD, "lib/v1/console.ts", /export async function submitQuoted/, { end: /^\}$/ });
anchor("c_life", HEAD, "lib/v1/console.ts", /export async function readLifecycle/, { end: /^\}$/ });
anchor("m_clock", HEAD, "components/milestone/FinalityClock.tsx", /export function FinalityClock/, { end: /^\}$/ });
anchor("m_page", HEAD, "app/milestone/page.tsx", /\{m\.runs\.map\(/, { end: /\)\)\}/ });

const resolved = new Map();
const cache = new Map();
function resolve(a) {
  const key = `${a.sha}:${a.path}`;
  if (!cache.has(key)) cache.set(key, fileAt(a.sha, a.path).split("\n"));
  const lines = cache.get(key);
  const s = lines.findIndex((l) => a.start.test(l));
  if (s === -1) throw new Error(`anchor ${a.id}: start not found in ${a.path}@${a.sha.slice(0, 7)}`);
  let e = s;
  if (a.endBefore) {
    let n = lines.findIndex((l, i) => i > s && a.endBefore.test(l));
    if (n === -1) n = lines.length;
    e = n - 1;
    while (e > s && lines[e].trim() === "") e -= 1;
  } else if (a.end) {
    let found = 0;
    for (let i = s; i < lines.length; i++) {
      if (a.end.test(lines[i])) { found += 1; if (found >= (a.endNth ?? 1)) { e = i; break; } }
    }
    if (found < (a.endNth ?? 1)) throw new Error(`anchor ${a.id}: end not found`);
    e += a.endOffset ?? 0;
  }
  const out = { ...a, a: s + 1, b: e + 1, first: lines[s].trim().slice(0, 110), last: lines[e].trim().slice(0, 110) };
  out.url = `${REPO}/blob/${a.sha}/${a.path}#L${out.a}${out.b > out.a ? `-L${out.b}` : ""}`;
  return out;
}
for (const a of A) resolved.set(a.id, resolve(a));
const U = (id) => resolved.get(id).url;
const L = (id, text) => `[${text ?? `${resolved.get(id).path}#L${resolved.get(id).a}${resolved.get(id).b > resolved.get(id).a ? "-L" + resolved.get(id).b : ""}`}](${U(id)})`;
const count = (sha, p, re) => (fileAt(sha, p).match(re) ?? []).length;

// ---------------------------------------------------------------- data
const diff = rd("diff-summary.json");
const match = rd("code-match.json");
const dep = JSON.parse(fileAt(HEAD, "artifacts/deployment-v1.json"));
const cf = rd("counterfactual.json");
const prop = rd("property.json");
const mut = rd("mutation.json");
const books = rd("books.json");
const verify = rd("offline-verification.json");
const proofReport = rd("proof-v1-report.json");
const R1 = rd("v1-run-R1.json"), R2 = rd("v1-run-R2.json"), R3 = rd("v1-run-R3.json");
const agentApprove = rd("agent-run-approve.json");
const tx = (h) => `[\`${h.slice(0, 12)}…${h.slice(-6)}\`](${EXPLORER}/tx/${h})`;
const addr = (a) => `[\`${a.slice(0, 10)}…${a.slice(-6)}\`](${EXPLORER}/address/${a})`;
const blob = (p, sha = HEAD) => `${REPO}/blob/${sha}/${p}`;
const num = (n) => Number(n).toLocaleString("en-US");

const baseDate = git("log", "-1", "--format=%cI", BASE).trim();
const headDate = git("log", "-1", "--format=%cI", HEAD).trim();
const between = git("log", "--format=%H %cI %s", "--date=iso", "1286058^..18562cf").trim().split("\n");
const compare = `${REPO}/compare/${BASE}...${HEAD}`;

const eth = (s) => (Number(BigInt(s)) / 1e18).toString();
const settledFinal = (r) => ({
  acc: r.adjudication.lifecycleSamples.filter((s) => s.projectedStatus === "Accepted").map((s) => s.evaluatedAt),
  fin: r.adjudication.lifecycleSamples.find((s) => s.projectedStatus === "Finalized")?.evaluatedAt,
  deadline: r.adjudication.finalAppealDeadline,
  child: r.delivery.createdTimestamp,
});
const t1 = settledFinal(R1), t2 = settledFinal(R2);

const rewardedStat = git("diff", "--stat", BASE, HEAD, "--", "contracts/decision_gate.py", "contracts/finality_vault.py", "contracts/scenario_registry.py", "contracts/control/").trim();
const eventFiles = git("status", "--porcelain").split("\n").filter(Boolean).map((l) => l.slice(3).trim());
const protectedDirs = ["contracts/", "app/", "lib/", "components/", "packages/", "tests/", "skills/", "examples/"];
const touchesCode = eventFiles.filter((f) => protectedDirs.some((d) => f.startsWith(d)));

const areaRows = diff.areas.map((a) => `| \`${a.area}\` | ${a.handWritten.files} (${a.handWritten.added} new, ${a.handWritten.modified} modified) | +${num(a.handWritten.lines.added)} / -${num(a.handWritten.lines.removed)} | ${a.generated.files} | +${num(a.generated.lines.added)} |`).join("\n");
const modRows = diff.modified.map((m) => `| \`${m.path}\` | ${m.reason} |`).join("\n");
const commitRows = diff.commits.map((c) => `| [\`${c.sha}\`](${REPO}/commit/${c.sha}) | ${c.date.slice(0, 10)} | ${c.subject} |`).join("\n");
const contractRows = diff.contracts.map((c) => `| [\`${c.path}\`](${blob(c.path)}) | ${c.generated ? "generated build" : "hand-written"} | ${c.lines} |`).join("\n");
const matchRows = match.contracts.map((c) => `| ${c.name} | ${addr(c.address)} | \`${c.deployed.sha256.slice(0, 18)}…\` (${c.deployed.bytes} bytes) | ${c.matches.map((m) => `\`${c.comparisons[m].path}\``).join(", ")} |`).join("\n");

const mintxt = (r) => r.adjudication.attempt;
const doc = `# Steward evidence: DEFINIT Milestone v1

Written for the steward's request for the repository, an exact base...head comparison from the last rewarded revision, pinned source links for the new gate, vault and registry, and the application calls that exercise finalized-message release. It answers three questions, in this order: what is new compared with what was rewarded (overlap), whether the new contracts exist, are the code on chain, and are driven by the application (functionality), and whether the change is substantial (materiality).

Every source link below is a permalink pinned to a full 40-character commit SHA with a line range. The ranges are found by searching the file at that SHA for the function named and are recorded, first and last line included, in \`docs/evidence/milestone/steward-links.json\` (added by the evidence commit). Every number is read from a generated file under \`docs/evidence/milestone/\`.

## Repository and comparison

- Repository: ${REPO}
- **Base, the last rewarded revision:** \`${BASE}\` (\`b903f94\`, ${baseDate.slice(0, 10)}), tag \`agent-tank-accepted\`. [Commit](${REPO}/commit/${BASE}). It is the head of \`main\` when DEFINIT was accepted.
- **Code head, the milestone code:** \`${HEAD}\` (\`2b45ea5\`, ${headDate.slice(0, 10)}), tag \`milestone-v1-code\`. [Commit](${REPO}/commit/${HEAD}). It is the last commit that changes code.
- **Full comparison:** ${compare}
- Every pinned source link below uses \`${HEAD.slice(0, 7)}\`, except the links to the accepted v0 code, which use the base SHA and say so.
- GitHub truncates large diffs (this one is ${diff.total.files} files), so the contract files are listed one by one in the next table, each with its own permalink.

Base to first milestone commit, from \`git log --format='%H %ad %s' --date=iso 1286058^..18562cf\`; \`18562cf\` is the first milestone commit and nothing sits between it and the base:

\`\`\`text
${between.join("\n")}
\`\`\`

**The evidence commit is docs-only in effect.** It is the commit that adds this file, on top of \`${HEAD.slice(0, 7)}\`. Its changed paths, from \`git status --porcelain\` at the moment this document was generated:

\`\`\`text
${eventFiles.join("\n")}
\`\`\`

${touchesCode.length === 0 ? "None of these is under `contracts/`, `app/`, `lib/`, `components/`, `packages/`, `tests/`, `skills/` or `examples/`. The only non-documentation paths are the three evidence scripts `scripts/steward-*.mjs`, which read git and the network and change nothing, and a one-line text edit in `scripts/gen-docs.mjs` that keeps the README link regenerable. This differs from a pure documentation diff in that one respect." : `WARNING: these paths are under code directories: ${touchesCode.join(", ")}`}

### The milestone contracts, file by file

| File | Kind | Lines |
| --- | --- | --- |
${contractRows}

## Overlap

**The rewarded v0 contracts are byte-identical at head; the milestone contracts are new files under \`contracts/v1/\`.**

\`\`\`text
$ git diff --stat ${BASE.slice(0, 7)}..${HEAD.slice(0, 7)} -- contracts/decision_gate.py contracts/finality_vault.py contracts/scenario_registry.py contracts/control/
${rewardedStat === "" ? "(no output)" : rewardedStat}
\`\`\`

\`scripts/steward-diff.mjs\` writes the figures below to \`docs/evidence/milestone/diff-summary.json\` (added by the evidence commit). ${diff.total.files} files changed: ${diff.total.added} added, ${diff.total.modified} modified, ${diff.total.deleted} deleted, in ${diff.commits.length} commits. Hand-written and generated files are counted apart so evidence JSON is not mistaken for code volume. Counts ignore end-of-line changes; see the note after the modified-file table.

| Area | Hand-written files | Hand-written lines | Generated files | Generated lines |
| --- | --- | --- | --- | --- |
${areaRows}

Totals ignoring end-of-line changes: ${num(diff.total.handWrittenLinesIgnoringEol.added)} lines added and ${num(diff.total.handWrittenLinesIgnoringEol.removed)} removed in hand-written files; ${num(diff.total.generatedLinesIgnoringEol.added)} added in generated files (evidence JSON, builds, lockfile, measured profiles). Files outside the listed areas: ${diff.other.files} (${diff.other.list.map((f) => "`" + f + "`").join(", ")}).

### Files that existed at base and were modified

| File | What changed |
| --- | --- |
${modRows}

**End-of-line note.** ${diff.eolRewritten.length} of these files were rewritten with different line endings, so a raw count shows far more changed lines than changed: ${diff.eolRewritten.map((e) => `\`${e.path}\` (raw +${e.raw.added}/-${e.raw.removed}, real +${e.ignoringEol.added}/-${e.ignoringEol.removed})`).join("; ")}. Raw totals are ${num(diff.total.rawLines.added)} added and ${num(diff.total.rawLines.removed)} removed; the figures above ignore that churn. The history was not rewritten to remove it.

### Commits, \`b903f94..2b45ea5\`

| SHA | Date | Subject |
| --- | --- | --- |
${commitRows}

Subjects written before commit \`24a5887\` call the milestone "Milestone 2" and "v2". See the naming map.

### Naming map

| Where | Label | Meaning |
| --- | --- | --- |
| Repository and docs | **v0** | the accepted, rewarded build; contracts at \`contracts/*.py\` |
| Repository and docs | **v1** | this milestone; contracts at \`contracts/v1/*.py\`; scripts \`*-v1.*\`; runs \`v1-run-R*.json\` |
| On-chain \`describe().version\` and the docstring headers of the three deployed v1 contracts | \`v2\` | the milestone. For example the header of ${L("r_head", "contracts/v1/scenario_registry.py")} reads \`DEFINIT v2 -- ScenarioRegistry\` |
| Inside those same docstrings | \`v1\` | the accepted build (v0 in the repository). The registry header says "The v1 policy registry with identical behaviour" |
| Hash tag \`DEFINIT-DECISION-v2\` | \`v2\` | the milestone's decision-id domain, so a v0 and a v1 decision id cannot collide |
| Hash tags \`DEFINIT-COMMITMENT-v1\`, \`-ACTION-v1\`, \`-POLICY-v1\`, \`-EVIDENCE-v1\` | \`v1\` | the encoding version, byte-identical in both builds (proved by the parity suite) |
| Commit subjects before \`24a5887\` | "Milestone 2", "v2" | the milestone, before the rename |

Commit \`24a5887\` renamed the accepted build to v0 and the milestone to v1 in the repository. The labels inside the deployed contracts were not edited because editing them would change the deployed bytes, and the deployed bytes are what the code-match check below compares.

## Functionality

All links in this section are pinned to \`${HEAD.slice(0, 7)}\` unless marked **base**.

### New gate, \`contracts/v1/decision_gate.py\`

- ${L("g_adj", "`request_adjudication`")}: adjudicates the evidence, then calls \`_record_outcome\`. It refuses unless the escrow is already open and funded.
- ${L("g_rec", "`_record_outcome`")}, and within it ${L("g_emit", "the two branches")}. On APPROVE the deciding transaction schedules \`vault.emit(on='finalized').authorize_release(...)\`; on REJECT it schedules \`vault.emit(on='finalized').close_refused(...)\`. One message per outcome, both on the finalized stage.
- **No timer, no promotion step.** ${L("g_never", "The header")} states it. Counts at head: \`APPEAL_WINDOW_SECONDS\` appears ${count(HEAD, G, /APPEAL_WINDOW_SECONDS/g)} times in the v1 gate and ${count(HEAD, V, /APPEAL_WINDOW_SECONDS/g)} in the v1 vault; \`def finalize_decision\` appears ${count(HEAD, G, /def finalize_decision/g)} times and \`def settle\` ${count(HEAD, V, /def settle\b/g)} times. At **base** the gate defined ${L("b_window", "`APPEAL_WINDOW_SECONDS = 120`")} and ${L("b_final", "`finalize_decision`")}, the agent-sent promotion step.
- ${L("g_describe", "`describe()`")} returns \`finality_rule: protocol-finalized-delivery\`, \`settlement_message_stage: finalized\` and \`clock: none\`.
- **A gap, stated plainly.** ${L("g_constraints", "The measured constraints")} record that \`emit(on='accepted')\` raised an execution error in the VM under the pinned runner, so the gate does **not** emit an accepted-stage (provisional) notice. The vault's gate-only \`note_provisional\` exists and is tested in direct mode only. The record is the observation O5 in [\`spike/findings-session1.json\`](${blob("docs/evidence/milestone/spike/findings-session1.json")}); the offline verifier lists it under invariant I5.

### New vault, \`contracts/v1/finality_vault.py\`

- ${L("v_header", "Header")}: the claim, release authority as a delivery, and the liveness paths.
- ${L("v_open", "`open_escrow`")}: the commitment fields come from the funder's own arguments and are checked against the action the gate registered. The gate is read once, here, as a consistency check; it is not release authority.
- \`authorize_release\`, ${L("v_auth", "whole function")}, with each guard separately:
  - ${L("v_sender", "sender must be the bound gate")} (\`gl.message.sender_address != self.gate\` refuses with \`UNAUTHORIZED_SENDER\`)
  - ${L("v_dup", "a duplicate delivery is a recorded no-op")}
  - ${L("v_deadline", "a release after the deadline does not release; it routes the escrow to a refund")}
  - ${L("v_commit", "delivered fields are compared and the commitment is recomputed by the vault")}
  - ${L("v_transfer", "the transfer is emitted on the finalized stage")}
- ${L("v_close", "`close_refused`")}: a finalized refusal closes the escrow to the funder. Gate-only.
- ${L("v_withdraw", "`withdraw_refund`")} and ${L("v_reclaim", "`reclaim_after_deadline`")}: the liveness path. Both are funder-only and both only send value back to the funder.
- **Time comparisons in the vault.** There are three, all deny-only or return-to-funder: \`open_escrow\` refuses a deadline that is not in the future, \`authorize_release\` routes a late delivery to a refund, and \`reclaim_after_deadline\` lets the funder take value back after the deadline. None authorizes a release to the recipient. \`scripts/check_no_clock.py\` fails the build otherwise; its result is in [\`no-clock-check.json\`](${blob("docs/evidence/milestone/no-clock-check.json")}).
- **No funder-callable release.** At head there is no \`settle\` and no method that releases on a caller's request (\`def settle\` count above). At **base** the vault's ${L("b_settle", "`settle`")} admitted the funder: ${L("b_funder", "the caller set included the funder")}, and the window was checked by ${L("b_guard6c", "a clock comparison")}.

### Registry, \`contracts/v1/scenario_registry.py\`

Modest by design: behaviour and content hash are identical to v0, so it is not new functionality. The hash formula is the same line at base and head (\`_keccak_hex(POLICY_DOMAIN + '|' + text)\`, domain \`DEFINIT-POLICY-v1\`). The change is storage: records are JSON strings in a \`TreeMap[str, str]\` instead of a typed storage class. The reason is stated ${L("v_json", "in the vault")}: typed storage classes need a decorator whose name differs between the linter's SDK and the runner the network executes, and the network rejects the linter's spelling. ${L("r_head", "Registry header")}; ${L("r_publish", "`publish_policy`")}. The never-incremented \`uses\` counter of the v0 record is not carried over.

### Deployed bytes are the committed code

\`scripts/steward-code-match.mjs\` fetches each deployed contract with \`gen_getContractCode\` on Studio-dev (chain ${match.network.chainId}), hashes it, and compares it with the files at \`${HEAD.slice(0, 7)}\`. Result in \`docs/evidence/milestone/code-match.json\` (added by the evidence commit): **${match.allMatch ? "all three match" : "MISMATCH"}**.

| Contract | Address | Deployed | Equals the file(s) at ${HEAD.slice(0, 7)} |
| --- | --- | --- | --- |
${matchRows}

**This differs from an assumption that the minified build is what runs.** The deployed bytes equal the readable build and readable source. The minified builds (\`contracts/v1/build/*.min.py\`, made by [\`scripts/build-contracts.mjs\`](${blob("scripts/build-contracts.mjs")})) compile on the network (\`npm run contracts:check\`) but were not deployed. Deployment record: [\`artifacts/deployment-v1.json\`](${blob("artifacts/deployment-v1.json")}), deployed ${dep.deployedAt}.

### Application calls that exercise finalized-message release

| Where | Calls | Place in the flow |
| --- | --- | --- |
| ${L("a_open", "`openGuardedPayment`")} (\`definit-guard\`) | \`create_action\`, \`open_escrow\` (exact value), \`request_adjudication\` | opens a payment; the adjudication is sent with both message branches funded |
| ${L("a_settled", "`settled`")} and ${L("a_receipt", "`receipt`")} | \`gen_getTransactionLifecycle\`, then \`get_escrow\` and \`get_receipt\` | waits for Finalized, then for the vault; \`paid\` is true only if the vault is SETTLED and holds a receipt |
| ${L("a_contest", "`contest`")}, ${L("a_refund", "`refund`")} | \`getAppealCharge\`, \`appealTransaction\`; \`withdraw_refund\`, \`reclaim_after_deadline\` | appeal an Accepted verdict; the funder's way home |
| ${L("a_kitctx", "`kitContext`")}, ${L("a_msgalloc", "`withMessageAllocations`")} | Transaction Kit \`estimate\`, then \`writeContract\` with one fee allocation per emitted message | fee quote and verification; funds the finalized release message |
| ${L("a_finality", "`finalityOf`")}, ${L("a_watch", "`watchFinality`")} | lifecycle snapshots | the rule: only \`Finalized\` is final |
| ${L("f_run", "`runPayment`")} in \`scripts/lib/v1-flow.mjs\` | the whole lifecycle that produced runs R1, R2, R3 and R5: ${L("f_create", "propose")}, ${L("f_fund", "fund")}, ${L("f_adj", "adjudicate")}, ${L("f_appeal", "appeal")}, ${L("f_child", "find the child the protocol created")}, ${L("f_delivery", "record the delivery")}, ${L("f_refund", "refund")} | the scripted payment behind every recorded run |
| ${L("f_write", "`write`")} | any write | the success check: \`txExecutionResultName === "FINISHED_WITH_RETURN"\` |
| ${L("c_handlers", "`propose`, `fund`, `adjudicate`, `contest`, `withdraw`")} in the v1 console, ${L("c_send", "`send`")}, ${L("c_quote", "`quoteWrite`")}, ${L("c_submit", "`submitQuoted`")} | the same contract methods, signed by the user's wallet | the web path; ${L("c_poll", "the console polls")} the lifecycle and the vault, and ${L("c_life", "`readLifecycle`")} calls \`gen_getTransactionLifecycle\` |
| ${L("m_page", "run list")} and ${L("m_clock", "\`FinalityClock\`")} on \`/milestone\` | none (renders recorded runs) | the finality clock for each recorded payment, drawn from chain timestamps |

Notes where this differs from an assumption: the wallet step module \`lib/wallet/steps.ts\` is unchanged from base and still drives the accepted v0 flow (the v0 console at \`/console/v0\`); the v1 wallet calls are in \`components/console/V1Console.tsx\` and \`lib/v1/console.ts\`. There is no call to a function named \`isSuccessful\`; success is judged by \`txExecutionResultName\` (above) and by \`scripts/lib/run-checks.mjs\`. The lifecycle is read through the raw RPC (\`gen_getTransactionLifecycle\` with \`{ txId }\`) because the SDK's typed wrapper sends \`{ hash }\`, which this endpoint does not accept (spike observation O1).

### One release, end to end, on Studio-dev (chain ${R1.network.chainId})

Source: [\`v1-run-R1.json\`](${blob("docs/evidence/milestone/v1-run-R1.json")}) (APPROVE) and [\`v1-run-R2.json\`](${blob("docs/evidence/milestone/v1-run-R2.json")}) (REJECT and refund). Contracts: gate ${addr(R1.contracts.gate)}, vault ${addr(R1.contracts.vault)}, registry ${addr(dep.addresses.scenarioRegistry)}.

**R1, APPROVE**

| Step | Transaction | Status and chain time |
| --- | --- | --- |
| \`create_action\` | ${tx(R1.steps.find((s) => s.name === "create_action").tx)} | accepted |
| \`open_escrow\` | ${tx(R1.steps.find((s) => s.name === "open_escrow").tx)} | escrow OPEN, 0.01 GEN |
| \`request_adjudication\` | ${tx(R1.adjudication.txHash)} | verdict ${R1.adjudication.verdict} (${R1.adjudication.reasonCode}); Accepted by chain time ${t1.acc[0]} (t1); appeal deadline ${t1.deadline}; first lifecycle sample showing Finalized at chain time ${t1.fin} (t2) |
| \`authorize_release\` child, sender = gate | ${tx(R1.delivery.childTxHash)} | from ${addr(R1.delivery.from)} (the gate), to the vault, \`triggered_by\` the adjudication transaction; created at ${t1.child} (t3); status ${R1.delivery.status}, ${R1.delivery.execution} |
| transfer to the recipient | message in the child's \`messages\`: ${eth(R1.delivery.emittedMessages[0].value)} GEN to \`${R1.delivery.emittedMessages[0].recipient}\`, \`onAcceptance: ${R1.delivery.emittedMessages[0].onAcceptance}\` | emitted on the finalized stage |
| receipt read | \`get_receipt\` on the vault (a read, no transaction) | status ${R1.vault.receipt.status}, \`finality_source: ${R1.vault.receipt.finality_source}\`, \`delivered_by\` the gate, \`message_stage: ${R1.vault.receipt.message_stage}\` |

**The child transaction that released the money was created only after the adjudication transaction survived its appeal window, and its sender is the gate contract.** The record contains: the chain's appeal deadline for the decision (${t1.deadline}); the child's creation time (${t1.child}), which is at or after that deadline (here equal to it); the child's \`from_address\`, which equals the gate address; and the lifecycle samples, which show the decision still Accepted and active at chain times ${t1.acc.join(", ")} and Finalized at ${t1.fin}. The poll interval is about ten seconds, so ${t1.fin} is an upper bound for t2, not the exact instant of finalization; the exact boundary is the appeal deadline. The vault samples show OPEN while the status was Accepted and SETTLED afterwards. The offline verifier re-derives the ordering for every recorded run (check V4 and V7 in [\`offline-verification.json\`](${blob("docs/evidence/milestone/offline-verification.json")})).

**R2, REJECT then refund**

| Step | Transaction | Status and chain time |
| --- | --- | --- |
| \`create_action\` | ${tx(R2.steps.find((s) => s.name === "create_action").tx)} | accepted |
| \`open_escrow\` | ${tx(R2.steps.find((s) => s.name === "open_escrow").tx)} | escrow OPEN |
| \`request_adjudication\` | ${tx(R2.adjudication.txHash)} | verdict ${R2.adjudication.verdict} (${R2.adjudication.reasonCode}); Accepted by ${t2.acc[0]}; appeal deadline ${t2.deadline}; Finalized sample at ${t2.fin} |
| \`close_refused\` child, sender = gate | ${tx(R2.delivery.childTxHash)} | from ${addr(R2.delivery.from)} (the gate); created at ${t2.child} (at or after the deadline ${t2.deadline}); ${R2.delivery.execution}; escrow ${R2.vault.escrowAfter.state} |
| \`withdraw_refund\` by the funder | ${tx(R2.withdraw.txHash)} | escrow ${R2.vault.escrowAfterWithdraw.state}; transfer of ${eth(R2.withdraw.emittedMessages[0].value)} GEN to the funder |
| receipt read | \`get_receipt\` | \`exists: ${R2.vault.receipt.exists}\`, \`reason_code: ${R2.vault.receipt.reason_code}\`: there is no release receipt because nothing was released |

Studio-dev did not credit a transfer a contract emits ([\`transfer-credit-probe.json\`](${blob("docs/evidence/milestone/transfer-credit-probe.json")})), so a balance is not evidence here; the evidence is the emitted transfer message plus the vault's state and receipt.

## Materiality

- v0 released value after a hard-coded 120-second timer plus an agent-sent promotion; v1 releases only on a protocol finalized-stage delivery from the deciding transaction. [\`docs/milestone/DELTA.md\`](${blob("docs/milestone/DELTA.md")}), [\`docs/milestone/PROOF_V1.md\`](${blob("docs/milestone/PROOF_V1.md")})
- v0 let the funder call \`settle\` against gate state that could still be appealed; v1 has no caller-triggered release, and the same attempt could not be constructed against it. [\`h1-differential.json\`](${blob("docs/evidence/milestone/h1-differential.json")}), [\`docs/milestone/FINDING.md\`](${blob("docs/milestone/FINDING.md")})
- Liveness: the funder can reclaim after the deadline and withdraw after a refusal, so funds are not stranded; the vault's states are specified in a document that a test reads. [\`docs/milestone/VAULT_STATE_MACHINE.md\`](${blob("docs/milestone/VAULT_STATE_MACHINE.md")}), [\`property.json\`](${blob("docs/evidence/milestone/property.json")})
- Property testing: ${num(Object.values(prop.runs).reduce((n, r) => n + r.lifecycles, 0))} random lifecycles over ${Object.keys(prop.runs).length} seeds (${num(Object.values(prop.runs).reduce((n, r) => n + r.events, 0))} events) checked against a pure model of the vault, and ${proofReport.headline.cases} labelled cases with ${proofReport.headline.refusals} refusals. [\`property.json\`](${blob("docs/evidence/milestone/property.json")}), [\`proof-v1-report.json\`](${blob("docs/evidence/milestone/proof-v1-report.json")})
- Mutation sweep: ${mut.killed} of ${mut.total} single-guard mutants of the vault were caught by a test, ${mut.survived} survived. [\`mutation.json\`](${blob("docs/evidence/milestone/mutation.json")})
- Parity suite: the TypeScript commitment code and the Python contracts hash ${rd("diff-summary.json") && JSON.parse(fileAt(HEAD, "tests/v1/fixtures/parity-vectors.json")).vectors.length} seeded vectors identically; it found that amounts above 2^53 were unsafe as numbers, now fixed. [\`tests/unit/parity.test.ts\`](${blob("tests/unit/parity.test.ts")})
- Books: ${books.totals.escrows} recorded escrows reconcile, in equals out plus held. [\`books.json\`](${blob("docs/evidence/milestone/books.json")})
- Offline verifier: ${verify.counts.pass} checks pass, ${verify.counts.fail} fail, ${verify.counts["not-evidenced"]} not evidenced, re-deriving hashes and ordering from recorded runs. [\`offline-verification.json\`](${blob("docs/evidence/milestone/offline-verification.json")})
- Four-arm counterfactual over ${cf.timelines.length} recorded timelines, unsafe payments: pay on Accepted ${cf.arms.baseline.unsafe}/${cf.arms.baseline.of}, fixed timer ${cf.arms.control.unsafe}/${cf.arms.control.of}, v0 rule ${cf.arms.v0.unsafe}/${cf.arms.v0.of}, v1 ${cf.arms.v1.unsafe}/${cf.arms.v1.of}; v0's funder path ${cf.v1FunderPath.unsafe}/${cf.v1FunderPath.of}. [\`counterfactual.json\`](${blob("docs/evidence/milestone/counterfactual.json")})
- Adoption: the \`definit-guard\` package, an agent skill, a fee profile through the Transaction Kit, and a live agent run that ended PAID with a vault receipt (${tx(agentApprove.payment.adjudicationTx)}). [\`agent-run-approve.json\`](${blob("docs/evidence/milestone/agent-run-approve.json")}), [\`agent-run-kit-submit-finding.json\`](${blob("docs/evidence/milestone/agent-run-kit-submit-finding.json")}) (a failure we found and fixed: the Kit's own submit cannot fund an emitted message)

**Honest limits.**
- The milestone ran only on Studio-dev (chain ${dep.chainId}). Bradbury was not used: its lifecycle method did not answer on the probed host and the probe account could not be funded (its faucet needs a wallet holding mainnet ETH). Studionet answered but did not execute contracts. [\`network-matrix.json\`](${blob("docs/evidence/milestone/network-matrix.json")}), [\`docs/milestone/NETWORK_DECISION.md\`](${blob("docs/milestone/NETWORK_DECISION.md")})
- The accepted-stage (provisional) notice was not shipped on chain, as described above.
- No appeal reversal was observed. In run R3 an appeal was submitted and recorded (${tx(R3.adjudication.txHash)}, bond ${eth(R3.adjudication.appeal.charge)} GEN); the verdict stayed ${R3.adjudication.verdict} at attempt ${mintxt(R3)}, and the release followed finality. [\`v1-run-R3.json\`](${blob("docs/evidence/milestone/v1-run-R3.json")})
- The fee profile is measured by simulation with the Transaction Kit's profile format, not by a \`gltest --fee-profile\` run.

## Reproduce

From a clean clone at \`${HEAD}\`. These were run on a clean clone at that commit before this document was written; the last line of each is quoted.

\`\`\`bash
git clone ${REPO} && cd definit && git checkout ${HEAD}
npm ci
npm run verify:offline
export GENLAYER_PRIVATE_KEY=0x1111111111111111111111111111111111111111111111111111111111111111   # any throwaway value; direct mode never signs
npm run test:v1:direct
python3 scripts/check_no_clock.py
\`\`\`

@@REPRODUCE@@
`;

// ---------------------------------------------------------------- reproduce block
const reproFile = path.join(REPO_ROOT, "docs", "evidence", "milestone", "steward-repro.json");
let reproBlock = "Reproduction results: not yet recorded.";
if (existsSync(reproFile)) {
  const r = JSON.parse(readFileSync(reproFile, "utf8"));
  reproBlock = `| Command | Last line of output | Needs |\n| --- | --- | --- |\n` + r.steps.map((s) => `| \`${s.command}\` | \`${s.lastLine}\` | ${s.needs} |`).join("\n") + `\n\nClean clone at \`${r.head}\`, ${r.platform}, Node ${r.node}. The clone was made from a local copy of this repository checked out at that SHA, so its files are identical to the GitHub commit.`;
}
writeFileSync(path.join(REPO_ROOT, "docs", "milestone", "STEWARD_EVIDENCE.md"), doc.replace("@@REPRODUCE@@", reproBlock));

// ---------------------------------------------------------------- anchors written out
const anchorsOut = [...resolved.values()].map((a) => ({ id: a.id, sha: a.sha, path: a.path, lines: `${a.a}-${a.b}`, firstLine: a.first, lastLine: a.last, url: a.url }));
log.step("Steward evidence");
log.ok(`${anchorsOut.length} line anchors resolved`);
for (const a of anchorsOut) log.info(`${a.id.padEnd(12)} ${a.path}#L${a.lines}  ${a.firstLine.slice(0, 60)}`);

// ---------------------------------------------------------------- link check
if (process.argv.includes("--links")) {
  const text = readFileSync(path.join(REPO_ROOT, "docs", "milestone", "STEWARD_EVIDENCE.md"), "utf8");
  const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s)\]`"'>]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")))];
  const results = [];
  for (const u of urls) {
    let status = 0, note = "";
    for (let t = 0; t < 3 && status !== 200; t++) {
      try {
        const res = await fetch(u, { redirect: "follow", headers: { "user-agent": "definit-steward-link-check" } });
        status = res.status;
        if (status === 429) await new Promise((r) => setTimeout(r, 4000));
      } catch (e) { note = String(e.message ?? e).slice(0, 80); await new Promise((r) => setTimeout(r, 2000)); }
    }
    results.push({ url: u, status, note });
    await new Promise((r) => setTimeout(r, 120));
  }
  const bad = results.filter((r) => r.status !== 200);
  writeFileSync(path.join(EV, "steward-links.json"), JSON.stringify({ checkedAt: new Date().toISOString(), head: HEAD, total: results.length, ok: results.length - bad.length, failed: bad, anchors: anchorsOut, results }, null, 2));
  log.info(`${results.length - bad.length}/${results.length} URLs returned 200`);
  for (const b of bad) log.fail(`${b.status} ${b.url} ${b.note}`);
  if (bad.length) process.exit(1);
}
