/**
 * Report exactly what is configured and what is still missing.
 *
 * This is the first command to run after editing `.env.local`. It never
 * guesses: every line is either a value it read, a format check it performed,
 * or a live call it made.
 *
 * Usage:
 *
 *     npm run verify
 */

import { existsSync } from "node:fs";
import path from "node:path";

import {
  DEPLOYMENT_PATH,
  ENV_PATH,
  TARGET_CHAIN_ID,
  formatGen,
  log,
  makeClient,
  readEnv,
  requirePrivateKey,
} from "./_shared.mjs";

/**
 * Each contract is probed with a read it actually implements. The vault and
 * the gate both expose `describe()`; the registry answers `count()`, because
 * a registry has nothing to say about a finality window.
 */
const ADDRESS_KEYS = [
  ["NEXT_PUBLIC_DECISION_GATE_ADDRESS", "DecisionGate", "describe"],
  ["NEXT_PUBLIC_FINALITY_VAULT_ADDRESS", "FinalityVault", "describe"],
  ["NEXT_PUBLIC_SCENARIO_REGISTRY_ADDRESS", "ScenarioRegistry", "count"],
];

const problems = [];

async function main() {
  log.step("Configuration");

  if (!existsSync(ENV_PATH)) {
    log.fail(".env.local does not exist. Copy .env.example and fill it in.");
    process.exit(1);
  }
  log.ok(".env.local present");

  const env = readEnv();

  try {
    requirePrivateKey();
    log.ok("GENLAYER_PRIVATE_KEY is well formed (0x + 64 hex)");
  } catch (error) {
    problems.push(error.message);
    log.fail(error.message);
  }

  const signing = (env.DEFINIT_ALLOW_SERVER_SIGNING ?? "false").trim();
  if (signing === "true") {
    log.ok("DEFINIT_ALLOW_SERVER_SIGNING=true -- the console write path is armed");
  } else {
    log.warn("DEFINIT_ALLOW_SERVER_SIGNING is not true -- the console runs read-only");
  }

  for (const [key, label] of ADDRESS_KEYS) {
    const value = (env[key] ?? "").trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) {
      log.ok(`${label} ${value}`);
    } else {
      problems.push(`${key} is empty or malformed`);
      log.fail(`${key} is empty or malformed -- run \`npm run deploy\``);
    }
  }

  const evidenceUrl = (env.DEFINIT_DEMO_EVIDENCE_URL ?? "").trim();
  if (evidenceUrl.startsWith("https://")) {
    log.ok(`demo evidence URL ${evidenceUrl}`);
  } else {
    problems.push("DEFINIT_DEMO_EVIDENCE_URL is not an https URL");
    log.fail("DEFINIT_DEMO_EVIDENCE_URL must be a public https URL the node can fetch");
  }

  if (problems.length > 0) {
    log.step("Stopping before the network checks");
    log.fail(`${problems.length} configuration problem(s)`);
    process.exit(1);
  }

  log.step("Network");
  const client = makeClient();
  const chainId = Number(await client.getChainId());
  if (chainId !== TARGET_CHAIN_ID) {
    log.fail(`wrong chain: expected ${TARGET_CHAIN_ID}, got ${chainId}`);
    process.exit(1);
  }
  log.ok(`chain ${chainId}`);

  const address = client.account.address;
  log.info(`operator ${address}`);
  const balance = await client.getBalance({ address });
  log.info(`balance ${formatGen(balance)}`);
  if (balance === 0n) {
    problems.push(`operator ${address} has no GEN`);
    log.fail("fund the operator address from the Studio Next faucet");
  }

  log.step("Deployed contracts");
  for (const [key, label, probe] of ADDRESS_KEYS) {
    const target = (env[key] ?? "").trim();
    try {
      const answer = await client.readContract({ address: target, functionName: probe, args: [] });
      log.ok(`${label}.${probe}(): ${JSON.stringify(answer).slice(0, 110)}`);
    } catch (error) {
      problems.push(`${label} at ${target} did not answer ${probe}()`);
      log.fail(`${label}: ${String(error.shortMessage ?? error.message ?? error).slice(0, 140)}`);
    }
  }

  log.step(existsSync(DEPLOYMENT_PATH) ? "Deployment record present" : "Deployment record missing");
  if (existsSync(DEPLOYMENT_PATH)) log.ok(path.relative(process.cwd(), DEPLOYMENT_PATH));

  if (problems.length > 0) {
    log.fail(`${problems.length} problem(s) remain`);
    process.exit(1);
  }
  log.ok("everything the project needs is configured and answering");
}

main().catch((error) => {
  log.fail(String(error?.stack ?? error));
  process.exit(1);
});
