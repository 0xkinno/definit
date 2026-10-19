/**
 * Is the code on chain the code in the repository?
 *
 *   node scripts/steward-code-match.mjs
 *
 * For each v1 contract address in artifacts/deployment-v1.json, as committed at the
 * head commit, fetch the deployed source with gen_getContractCode, hash it, and
 * compare it with the files at that commit: the minified build, the readable build,
 * and the readable source. Writes docs/evidence/milestone/code-match.json.
 * Exits non-zero if a deployed contract matches none of the committed files.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";
import { HEAD } from "./steward-diff.mjs";
import { explorerAddress, rpc } from "./lib/chain.mjs";

const git = (...a) => execFileSync("git", a, { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
const sha = (buf) => "0x" + createHash("sha256").update(buf).digest("hex");
const atHead = (p) => git("show", `${HEAD}:${p}`);

const dep = JSON.parse(atHead("artifacts/deployment-v1.json").toString("utf8"));
const contracts = [
  { name: "ScenarioRegistry", address: dep.addresses.scenarioRegistry, file: "scenario_registry.py" },
  { name: "FinalityVault", address: dep.addresses.finalityVault, file: "finality_vault.py" },
  { name: "DecisionGate", address: dep.addresses.decisionGate, file: "decision_gate.py" },
];

const rows = [];
for (const c of contracts) {
  const deployedB64 = await rpc("gen_getContractCode", [c.address]);
  const deployed = Buffer.from(deployedB64, "base64");
  const candidates = {
    minifiedBuild: `contracts/v1/build/${c.file.replace(/\.py$/, ".min.py")}`,
    readableBuild: `contracts/v1/build/${c.file}`,
    readableSource: `contracts/v1/${c.file}`,
  };
  const comparisons = {};
  for (const [k, p] of Object.entries(candidates)) {
    const buf = atHead(p);
    comparisons[k] = { path: p, sha256: sha(buf), bytes: buf.length, equalsDeployed: sha(buf) === sha(deployed) };
  }
  const matched = Object.entries(comparisons).filter(([, v]) => v.equalsDeployed).map(([k]) => k);
  rows.push({ name: c.name, address: c.address, explorer: explorerAddress(c.address), deployed: { sha256: sha(deployed), bytes: deployed.length }, matches: matched, comparisons });
  (matched.length ? log.ok : log.fail)(`${c.name} ${c.address}: deployed ${deployed.length} bytes ${matched.length ? "equals " + matched.join(", ") : "matches no committed file"}`);
}

const out = {
  generatedAt: new Date().toISOString(),
  head: HEAD,
  network: { name: dep.network, chainId: dep.chainId, rpc: dep.rpc, method: "gen_getContractCode" },
  deploymentRecord: `artifacts/deployment-v1.json at ${HEAD}`,
  contracts: rows,
  allMatch: rows.every((r) => r.matches.length > 0),
};
writeFileSync(path.join(REPO_ROOT, "docs", "evidence", "milestone", "code-match.json"), JSON.stringify(out, null, 2));
process.exit(out.allMatch ? 0 : 1);
