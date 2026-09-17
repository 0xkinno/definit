/**
 * Validate every contract source against the live GenVM, without spending gas.
 *
 * `gen_getContractSchemaForCode` runs the submitted code through the same
 * manager and runner pipeline a deployment would use, and returns the derived
 * schema. If a contract cannot compile there, it cannot deploy, and this tool
 * says so before any transaction is signed.
 *
 * This is the cheapest correctness gate in the repository. Run it before
 * `npm run deploy` and after any contract edit.
 *
 * Usage:
 *
 *     npm run contracts:check
 *     npm run contracts:check -- --json
 */

import path from "node:path";
import { readFileSync, existsSync } from "node:fs";

import { REPO_ROOT, readEnv, log } from "./_shared.mjs";

/**
 * Order matters for humans, not for the tool: the registry is deployed first,
 * so it is checked first.
 */
const SOURCES = [
  { name: "ScenarioRegistry", file: path.join("contracts", "scenario_registry.py") },
  { name: "FinalityVault", file: path.join("contracts", "finality_vault.py") },
  { name: "DecisionGate", file: path.join("contracts", "decision_gate.py") },
  { name: "UnsafeRelease", file: path.join("contracts", "control", "unsafe_release.py") },
];

const AS_JSON = process.argv.includes("--json");

function decodePythonRepr(value) {
  if (typeof value !== "string") return JSON.stringify(value);
  return value
    .replace(/\\\\n/g, "\n")
    .replace(/\\\\t/g, "\t")
    .replace(/\\\\r/g, "\r")
    .replace(/\\\\'/g, "'")
    .replace(/\\\\\\\\/g, "\\");
}

async function rpc(method, params) {
  const endpoint = (readEnv().GENLAYER_RPC_URL ?? "").trim();
  if (!endpoint) throw new Error("GENLAYER_RPC_URL is not set in .env.local");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`RPC endpoint answered HTTP ${response.status}`);
  }
  return await response.json();
}

function runnerHeader(source) {
  const first = source.split("\n")[0] ?? "";
  const match = /"Depends"\s*:\s*"([^"]+)"/.exec(first);
  return match ? match[1] : null;
}

async function validate(entry) {
  const absolute = path.join(REPO_ROOT, entry.file);
  if (!existsSync(absolute)) {
    return { ...entry, ok: false, error: `missing source file ${entry.file}` };
  }
  const source = readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
  const header = runnerHeader(source);

  let payload;
  try {
    payload = await rpc("gen_getContractSchemaForCode", [source]);
  } catch (error) {
    return { ...entry, ok: false, runner: header, error: String(error.message ?? error) };
  }

  if (!payload.error) {
    const schema = payload.result ?? {};
    const methods = schema.methods ? Object.keys(schema.methods) : [];
    return { ...entry, ok: true, runner: header, methods, schema };
  }

  const data = decodePythonRepr(payload.error.data ?? "");
  const resultLine = /"result":\s*"([^"]*)"/.exec(data);
  const lastLine = data
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-1)[0];
  return {
    ...entry,
    ok: false,
    runner: header,
    error: resultLine ? resultLine[1] : lastLine || String(payload.error.message ?? ""),
    detail: data,
  };
}

const results = [];
for (const entry of SOURCES) {
  results.push(await validate(entry));
}

if (AS_JSON) {
  console.log(
    JSON.stringify(
      results.map(({ detail, schema, ...rest }) => rest),
      null,
      2,
    ),
  );
} else {
  log.step("Validating contract sources against the live GenVM");
  for (const result of results) {
    if (result.ok) {
      log.ok(`${result.name}: compiles, ${result.methods.length} public methods`);
    } else {
      log.fail(`${result.name}: ${result.error}`);
      if (result.detail) {
        const tail = result.detail.split("\n").slice(-12).join("\n");
        console.log(tail.replace(/^/gm, "       "));
      }
    }
  }
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  if (!AS_JSON) log.fail(`${failed.length} of ${results.length} contract(s) failed validation`);
  process.exit(1);
}
if (!AS_JSON) log.ok(`all ${results.length} contract(s) compile on the live GenVM`);