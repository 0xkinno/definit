/**
 * Run a Python test suite with the environment it needs.
 *
 * Two things have to be true for these suites to run anywhere:
 *
 *   1. the process-local caches must stay inside the repository, so nothing is
 *      written to a home directory the sandbox may not allow; and
 *   2. the compatibility bridge for the published test runner must be on the
 *      path before any contract is loaded.
 *
 * The integration suites additionally need a GenLayer node. Unless `--network`
 * names a remote one, this script starts `glsim` locally, waits for it to
 * answer, runs the suite and shuts it down again.
 *
 * Usage:
 *
 *     node scripts/run-python.mjs tests/direct
 *     node scripts/run-python.mjs tests/integration --integration
 *     node scripts/run-python.mjs tests/integration --network studionet
 */

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import net from "node:net";

import { REPO_ROOT, readEnv, log } from "./_shared.mjs";

const args = process.argv.slice(2);
const suite = args.find((value) => !value.startsWith("--"));
const wantsIntegration = args.includes("--integration");
const networkFlag = args.indexOf("--network");
const network = networkFlag === -1 ? null : args[networkFlag + 1];

if (!suite) {
  log.fail("usage: node scripts/run-python.mjs <suite-directory> [--integration] [--network <name>]");
  process.exit(1);
}

/** Keep every process-local cache inside the repository. */
const SANDBOX_HOME = path.join(REPO_ROOT, ".gltest-home");
mkdirSync(SANDBOX_HOME, { recursive: true });

function childEnv(extra = {}) {
  const env = readEnv();
  return {
    ...process.env,
    ...env,
    USERPROFILE: SANDBOX_HOME,
    HOME: SANDBOX_HOME,
    XDG_CACHE_HOME: path.join(SANDBOX_HOME, ".cache"),
    PYTHONPATH: [REPO_ROOT, path.join(REPO_ROOT, "tests"), process.env.PYTHONPATH ?? ""]
      .filter(Boolean)
      .join(path.delimiter),
    PYTHONIOENCODING: "utf-8",
    PYTHONDONTWRITEBYTECODE: "1",
    ...extra,
  };
}

function python() {
  const candidates = ["python", "python3", "py"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["-c", "print(1)"], { encoding: "utf8", env: childEnv() });
    if (probe.status === 0 && String(probe.stdout).trim() === "1") return candidate;
  }
  log.fail("no python interpreter found on PATH");
  process.exit(1);
}

const PYTHON = python();

async function waitForPort(port, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => resolve(false));
      socket.connect(port, "127.0.0.1");
    });
    if (ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function run(command, commandArgs, env) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: REPO_ROOT, env, stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

let simulator = null;

async function startSimulator() {
  const port = 4000;
  simulator = spawn(PYTHON, [path.join("scripts", "run-glsim.py"), "--port", String(port), "--no-browser"], {
    cwd: REPO_ROOT,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  simulator.stdout.on("data", (chunk) => process.stdout.write(`   [glsim] ${chunk}`));
  simulator.stderr.on("data", (chunk) => process.stderr.write(`   [glsim] ${chunk}`));

  const ready = await waitForPort(port, 90000);
  if (!ready) {
    log.fail("the local GenLayer network did not start within 90 seconds");
    simulator.kill();
    process.exit(1);
  }
  log.ok(`local GenLayer network answering on 127.0.0.1:${port}`);
  return port;
}

function stopSimulator() {
  if (simulator && !simulator.killed) {
    simulator.kill();
    simulator = null;
  }
}

async function main() {
  const pytestArgs = ["-m", "pytest", suite, "-q"];

  if (wantsIntegration || network) {
    if (network && network !== "localnet") {
      pytestArgs.push("--network", network);
    } else {
      await startSimulator();
      pytestArgs.push("--network", "localnet");
    }
  }

  log.step(`running ${suite}`);
  const code = await run(PYTHON, pytestArgs, childEnv());
  stopSimulator();

  if (code !== 0) {
    log.fail(`${suite} failed with exit code ${code}`);
    process.exit(code);
  }
  log.ok(`${suite} passed`);
}

main().catch((error) => {
  stopSimulator();
  log.fail(String(error?.stack ?? error));
  process.exit(1);
});
