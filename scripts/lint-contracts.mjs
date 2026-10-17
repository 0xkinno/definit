/**
 * Lint the v2 contracts with genvm-lint (the fast AST pass).
 *
 * `genvm-lint check` also tries a semantic validation that downloads a GenVM
 * runner. The network's own `gen_getContractSchemaForCode` is the authority for
 * that part and `npm run contracts:check` runs it, so this gate uses `lint`.
 *
 * Usage: node scripts/lint-contracts.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const bin = existsSync("C:/glvenv/Scripts/genvm-lint.exe") ? "C:/glvenv/Scripts/genvm-lint.exe" : "genvm-lint";
const dir = path.join(REPO_ROOT, "contracts", "v2");
const files = readdirSync(dir).filter((f) => f.endsWith(".py"));
let failed = 0;

for (const file of files) {
  const r = spawnSync(bin, ["lint", path.join("contracts", "v2", file)], { cwd: REPO_ROOT, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status === 0) log.ok(`${file}: ${out.split("\n").pop()}`);
  else {
    failed += 1;
    log.fail(`${file}\n${out}`);
  }
}
if (failed) process.exit(1);
log.ok(`${files.length} v2 contracts lint clean`);
