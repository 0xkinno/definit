/**
 * Build the deployable v2 contracts.
 *
 *   npm run build:contracts            write contracts/v2/build/*.py and *.min.py
 *   npm run build:contracts -- --check fail if the committed build differs from a fresh one
 *
 * Two outputs per contract:
 *   <name>.py       the readable source, unchanged
 *   <name>.min.py   docstrings and comments stripped, the runner header kept; this is
 *                   the byte-for-byte form that is deployed
 *
 * The readable build is what the tests read. The minified build is what the
 * network runs, and the whole direct suite runs against it too, so the two cannot
 * differ in behaviour (finding F8). Sizes are measured and written to
 * docs/evidence/milestone/size-budget.json for docs/milestone/SIZE_BUDGET.md.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const SRC = path.join(REPO_ROOT, "contracts", "v2");
const OUT = path.join(SRC, "build");
const NAMES = ["scenario_registry", "finality_vault", "decision_gate"];
const CHECK = process.argv.includes("--check");

const python = existsSync("C:/glvenv/Scripts/python.exe") ? "C:/glvenv/Scripts/python.exe" : "python";
const MINIFY = String.raw`
import ast, sys
src = open(sys.argv[1], encoding="utf-8").read()
header = src.split("\n", 1)[0]
tree = ast.parse(src)

class Strip(ast.NodeTransformer):
    def _strip(self, node):
        self.generic_visit(node)
        body = node.body
        if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) and isinstance(body[0].value.value, str):
            body = body[1:] or [ast.Pass()]
        node.body = body
        return node
    visit_FunctionDef = _strip
    visit_ClassDef = _strip
    def visit_Module(self, node):
        self.generic_visit(node)
        if node.body and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant) and isinstance(node.body[0].value.value, str):
            node.body = node.body[1:]
        return node

tree = Strip().visit(tree)
ast.fix_missing_locations(tree)
sys.stdout.write(header + "\n" + ast.unparse(tree) + "\n")
`;

mkdirSync(OUT, { recursive: true });
const sizes = {};
let drift = 0;

for (const name of NAMES) {
  const file = path.join(SRC, `${name}.py`);
  const readable = readFileSync(file, "utf8");
  const r = spawnSync(python, ["-c", MINIFY, file], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (r.status !== 0) throw new Error(`minify failed for ${name}: ${r.stderr}`);
  const minified = r.stdout;
  sizes[name] = { readableBytes: Buffer.byteLength(readable), minifiedBytes: Buffer.byteLength(minified) };
  const targets = [[path.join(OUT, `${name}.py`), readable], [path.join(OUT, `${name}.min.py`), minified]];
  for (const [target, content] of targets) {
    if (CHECK) {
      if (!existsSync(target) || readFileSync(target, "utf8") !== content) {
        drift += 1;
        log.fail(`${path.relative(REPO_ROOT, target)} differs from a fresh build`);
      }
    } else {
      writeFileSync(target, content);
    }
  }
}

const budgetFile = path.join(REPO_ROOT, "docs", "evidence", "milestone", "size-budget.json");
if (!CHECK) {
  writeFileSync(budgetFile, JSON.stringify({ generatedAt: new Date().toISOString(), sizes }, null, 2));
  for (const [name, s] of Object.entries(sizes)) log.ok(`${name}: ${s.readableBytes} bytes readable, ${s.minifiedBytes} bytes minified`);
}
if (drift) process.exit(1);
if (CHECK) log.ok("the committed build equals a fresh build");
