/**
 * Invariant I2 gate: neither v1 contract may use the clock to authorize a
 * release. The analysis is a Python AST walk (scripts/check_no_clock.py); this
 * wrapper finds the interpreter and runs it.
 *
 * Usage: node scripts/check-no-clock.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./_shared.mjs";

const pinned = process.env.DEFINIT_PYTHON ?? (existsSync("C:/glvenv/Scripts/python.exe") ? "C:/glvenv/Scripts/python.exe" : null);
const candidates = [...(pinned ? [pinned] : []), "python", "python3", "py"];
let status = 1;
for (const python of candidates) {
  const r = spawnSync(python, [path.join(REPO_ROOT, "scripts", "check_no_clock.py")], { cwd: REPO_ROOT, stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.error) continue;
  status = r.status ?? 1;
  break;
}
process.exit(status);
