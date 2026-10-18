/**
 * Mutation sweep over the FinalityVault.
 *
 * A passing suite proves little unless it fails when the contract is weakened.
 * Each mutant removes or flips one guard in a copy of the vault; the direct vault
 * suites run against the copy through DEFINIT_CONTRACT_DIR. A mutant is KILLED when
 * some test fails and SURVIVED when none does. The result, including survivors,
 * is written to docs/evidence/milestone/mutation.json.
 *
 *   npm run mutation            all mutants
 *   npm run mutation -- M03     one mutant
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const SOURCE = path.join(REPO_ROOT, "contracts", "v1");
const SUITES = ["test_vault_funding.py", "test_vault_provisional_refusal.py", "test_vault_liveness.py", "test_vault_release.py"].map((f) => `tests/v1/direct/${f}`);

// find: the exact guard text; nth: which occurrence (1-based); to: what replaces it.
const MUTANTS = [
  { id: "M01", inv: "I1", what: "authorize_release accepts any sender", find: "if gl.message.sender_address != self.gate:", nth: 2, to: "if False:" },
  { id: "M02", inv: "I1", what: "close_refused accepts any sender", find: "if gl.message.sender_address != self.gate:", nth: 3, to: "if False:" },
  { id: "M03", inv: "I1", what: "note_provisional accepts any sender", find: "if gl.message.sender_address != self.gate:", nth: 1, to: "if False:" },
  { id: "M04", inv: "I4", what: "a settled escrow can be released again (replay)", find: "if escrow['state'] != STATE_OPEN:", nth: 2, to: "if False:" },
  { id: "M05", inv: "I3", what: "the delivered amount is not compared", find: "if int(amount) != int(escrow['amount']):", nth: 1, to: "if False:" },
  { id: "M06", inv: "I3", what: "the delivered recipient is not compared", find: "if _addr_hex(recipient) != str(escrow['recipient']):", nth: 1, to: "if False:" },
  { id: "M07", inv: "I3", what: "the commitment is not recomputed", find: "if str(intent_hash) != recomputed:", nth: 1, to: "if False:" },
  { id: "M08", inv: "I3", what: "the policy hash is not compared", find: "if str(policy_hash) != str(escrow['policy_hash']):", nth: 1, to: "if False:" },
  { id: "M09", inv: "I1", what: "anyone can withdraw a refund", find: "if _addr_hex(gl.message.sender_address) != str(escrow['funder']):", nth: 1, to: "if False:" },
  { id: "M10", inv: "I11", what: "anyone can reclaim after the deadline", find: "if _addr_hex(gl.message.sender_address) != str(escrow['funder']):", nth: 2, to: "if False:" },
  { id: "M11", inv: "I9", what: "reclaim is allowed before the deadline", find: "if _now_unix() <= int(escrow['deadline_unix']):", nth: 1, to: "if False:" },
  { id: "M12", inv: "I11", what: "a release is accepted after the deadline", find: "if _now_unix() > int(escrow['deadline_unix']):", nth: 1, to: "if False:" },
  { id: "M13", inv: "I2", what: "escrow value is not checked against the amount", find: "if int(gl.message.value) != amount:", nth: 1, to: "if False:" },
  { id: "M14", inv: "I2", what: "the escrow is not bound to the proposing agent", find: "if _addr_hex(action['agent']) != _addr_hex(gl.message.sender_address):", nth: 1, to: "if False:" },
  { id: "M15", inv: "I6", what: "a refund can be withdrawn from any state", find: "if escrow['state'] != STATE_REFUNDABLE and escrow['state'] != STATE_EXPIRED_REFUNDABLE:", nth: 1, to: "if False:" },
  { id: "M16", inv: "I5", what: "a provisional notice is accepted on a settled escrow", find: "if escrow['state'] != STATE_OPEN:", nth: 1, to: "if False:" },
];

function mutate(text, m) {
  let from = -1;
  for (let i = 0; i < m.nth; i++) {
    from = text.indexOf(m.find, from + 1);
    if (from === -1) return null;
  }
  return text.slice(0, from) + m.to + text.slice(from + m.find.length);
}

const only = process.argv.slice(2).filter((a) => /^M\d+$/.test(a));
const original = readFileSync(path.join(SOURCE, "finality_vault.py"), "utf8");
const results = [];

for (const m of MUTANTS.filter((x) => !only.length || only.includes(x.id))) {
  const mutated = mutate(original, m);
  if (mutated === null) { results.push({ ...m, status: "INVALID", note: "guard text not found" }); log.fail(`${m.id}: guard text not found`); continue; }
  const dir = mkdtempSync(path.join(os.tmpdir(), "definit-mut-"));
  for (const f of ["decision_gate.py", "scenario_registry.py"]) copyFileSync(path.join(SOURCE, f), path.join(dir, f));
  writeFileSync(path.join(dir, "finality_vault.py"), mutated);
  let killedBy = null;
  for (const suite of SUITES) {
    const r = spawnSync(process.execPath, ["scripts/run-python.mjs", suite], { cwd: REPO_ROOT, env: { ...process.env, DEFINIT_CONTRACT_DIR: dir }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      const failed = (String(r.stdout) + String(r.stderr)).match(/FAILED\s+(\S+)/);
      killedBy = failed ? failed[1] : suite;
      break;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  const status = killedBy ? "KILLED" : "SURVIVED";
  results.push({ id: m.id, invariant: m.inv, mutation: m.what, status, killedBy });
  (killedBy ? log.ok : log.fail)(`${m.id} [${m.inv}] ${m.what}: ${status}${killedBy ? ` by ${killedBy}` : ""}`);
}

const killed = results.filter((r) => r.status === "KILLED").length;
const report = {
  generatedAt: new Date().toISOString(),
  target: "contracts/v1/finality_vault.py",
  suites: SUITES,
  total: results.length, killed, survived: results.filter((r) => r.status === "SURVIVED").length, invalid: results.filter((r) => r.status === "INVALID").length,
  mutants: results,
};
if (!only.length) {
  mkdirSync(path.join(REPO_ROOT, "docs", "evidence", "milestone"), { recursive: true });
  writeFileSync(path.join(REPO_ROOT, "docs", "evidence", "milestone", "mutation.json"), JSON.stringify(report, null, 2));
}
log.info(`${killed}/${results.length} mutants killed`);
process.exit(report.survived || report.invalid ? 1 : 0);
