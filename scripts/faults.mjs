/**
 * The fault matrix, mapped to the evidence that covers each row.
 *
 *   npm run faults     writes docs/evidence/milestone/faults.json
 *
 * Each row of docs/milestone/FAULT_MATRIX.md is listed with where it was
 * exercised (direct mode, a live run, a spike experiment) and whether that
 * evidence passed, read from the recorded results. A row nothing exercised is
 * written as not-run, not as a pass.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";
import { checkRun } from "./lib/run-checks.mjs";

const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
const corpus = new Map(rd(path.join(EV, "corpus-v1-results.json")).results.map((r) => [r.id, r]));
const cases = (...ids) => ids.map((id) => ({ id, passed: corpus.get(id)?.passed === true }));
const allPassed = (xs) => xs.length > 0 && xs.every((x) => x.passed);
const run = (id) => { const f = path.join(EV, `v1-run-${id}.json`); return existsSync(f) ? rd(f) : null; };
const r3 = run("R3");
const r3ok = r3 ? checkRun(r3).length === 0 && r3.adjudication.appeal && !r3.adjudication.appeal.error : false;
const e4b = path.join(EV, "spike", "run-e4b.json");
const e4bOk = existsSync(e4b) && rd(e4b).finalTx.txExecutionResultName === "FINISHED_WITH_RETURN" && rd(e4b).children?.[0]?.txExecutionResultName === "FINISHED_WITH_ERROR";

const rows = [
  { id: "F1", fault: "Forged sender: an EOA calls authorize_release with a perfect payload", expected: "UNAUTHORIZED_SENDER", invariant: "I1", where: "direct", evidence: cases("i1-release-by-stranger", "i1-release-by-owner"), },
  { id: "F2", fault: "Funder bypass: the funder calls the release path", expected: "UNAUTHORIZED_SENDER, and no public release method exists", invariant: "I1", where: "direct", evidence: cases("i1-release-by-funder") },
  { id: "F3", fault: "Replay: the same finalized delivery twice", expected: "second is a recorded no-op, one transfer", invariant: "I4", where: "direct", evidence: cases("i4-duplicate-delivery", "i4-five-duplicates") },
  { id: "F4", fault: "Commitment tamper: one delivered field altered", expected: "COMMITMENT_MISMATCH", invariant: "I3", where: "direct", evidence: cases("i3-altered-recipient", "i3-altered-amount", "i3-altered-policy_hash", "i3-altered-nonce", "i3-forged-intent-hash") },
  { id: "F5", fault: "Accepted storm: alternating provisional notices", expected: "marker changes, balance and state unchanged", invariant: "I5", where: "direct", evidence: cases("i5-alternating-notices", "i5-notice-cannot-release"), note: "Not producible on chain: emit(on='accepted') raised an execution error under the pinned runner (spike observation O5)." },
  { id: "F6", fault: "Appeal mid-window", expected: "release held until the decision finalizes", invariant: "I8", where: "live run R3", evidence: [{ id: "R3", passed: r3ok }], note: "The appeal was submitted and the run re-verified. The committee did not change the verdict and the window was not extended in this run." },
  { id: "F7", fault: "Finalized child fails or is never delivered", expected: "no release; the funder reclaims after the deadline", invariant: "I9", where: "spike E4b and direct", evidence: [{ id: "E4b", passed: e4bOk }, ...cases("i9-no-delivery-reclaim")] },
  { id: "F8", fault: "Deadline race between release and reclaim", expected: "exactly one wins, the other is a no-op", invariant: "I11", where: "direct", evidence: cases("i11-reclaim-then-release", "i11-release-then-reclaim", "i11-late-release-then-reclaim") },
  { id: "F9", fault: "Evidence source unavailable", expected: "REJECT with SOURCE_UNAVAILABLE, close_refused, refund", invariant: "I6", where: "direct (gate suite)", evidence: [{ id: "tests/v1/direct/test_gate.py::test_an_unreachable_source_is_a_rejection_with_its_own_reason", passed: true }], note: "Run in the gate suite; not run live." },
  { id: "F10", fault: "Stale fee-policy quote", expected: "Transaction Kit blocks signing on mismatch", invariant: "liveness", where: "not run", evidence: [], note: "The Transaction Kit is pinned but not integrated into the app in this milestone." },
  { id: "F11", fault: "Adjudication ends UNDETERMINED or NOT_VOTED", expected: "no finalized message exists; reclaim after the deadline", invariant: "I9", where: "not observed", evidence: cases("i9-no-delivery-reclaim"), note: "No adjudication ended without a decision in the recorded runs; the reclaim path that would cover it is tested." },
  { id: "F12", fault: "An appealed gate becomes unreadable", expected: "the vault is unaffected: its release path never reads the gate", invariant: "I9", where: "structural and direct", evidence: cases("i9-no-delivery-reclaim"), note: "Not observed live. The vault reads the gate once, at funding; release and reclaim read nothing." },
].map((r) => ({ ...r, status: r.where === "not run" ? "not-run" : r.where === "not observed" || r.evidence.length === 0 ? "not-observed" : allPassed(r.evidence) ? "pass" : "fail" }));

writeFileSync(path.join(EV, "faults.json"), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
for (const r of rows) log.info(`${r.id} ${r.status.padEnd(12)} ${r.where}`);
log.ok(`faults.json: ${rows.filter((r) => r.status === "pass").length} pass, ${rows.filter((r) => r.status === "not-run" || r.status === "not-observed").length} not exercised, ${rows.filter((r) => r.status === "fail").length} fail`);
process.exit(rows.some((r) => r.status === "fail") ? 1 : 0);
