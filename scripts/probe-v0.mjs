/**
 * Phase 0: do the v0 contracts from the accepted baseline still answer?
 *
 * Reads artifacts/deployment.json (never writes it) and calls `describe()` (the
 * registry: `count()`) on each v0 contract. Output: docs/evidence/milestone/v0-liveness.json
 *
 * Studio-dev may reset. This records, from the network, whether it has.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "genlayer-js";
import { studioDevnet } from "genlayer-js/chains";
import { REPO_ROOT } from "./_shared.mjs";

const deployment = JSON.parse(readFileSync(path.join(REPO_ROOT, "artifacts", "deployment.json"), "utf8"));
const client = createClient({ chain: studioDevnet });
const out = { checkedAt: new Date().toISOString(), network: deployment.network, chainId: deployment.chainId, rpc: deployment.rpc, results: {} };

for (const [name, address] of Object.entries(deployment.addresses)) {
  try {
    // The registry has no describe(); count() is its cheapest view.
    const functionName = name === "scenarioRegistry" ? "count" : "describe";
    const value = await client.readContract({ address, functionName, args: [] });
    out.results[name] = { address, answers: true, call: name === "scenarioRegistry" ? "count" : "describe", result: JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) };
  } catch (error) {
    out.results[name] = { address, answers: false, error: String(error?.details ?? error?.shortMessage ?? error?.message ?? error).slice(0, 240) };
  }
}
out.allAnswer = Object.values(out.results).every((r) => r.answers);
mkdirSync(path.join(REPO_ROOT, "docs", "evidence", "milestone"), { recursive: true });
writeFileSync(path.join(REPO_ROOT, "docs", "evidence", "milestone", "v0-liveness.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ allAnswer: out.allAnswer, results: Object.fromEntries(Object.entries(out.results).map(([k, v]) => [k, v.answers ? "answers" : v.error])) }, null, 1));
process.exit(0);
