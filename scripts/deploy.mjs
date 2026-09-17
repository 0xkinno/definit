/**
 * Deploy DEFINIT to GenLayer Studio Next (chain 61997).
 *
 * The script refuses to do anything until it has checked, in order:
 *
 *   1. the target network answers and reports the expected chain id;
 *   2. the signing account holds enough GEN to pay for the deployment;
 *   3. every contract source is present and declares a runner;
 *
 * Then it deploys, wires the two contracts to each other, publishes the demo
 * policy, reads the deployed state back, and writes `artifacts/deployment.json`
 * with the addresses and transaction hashes.
 *
 * A deployment is only reported as done when a read against the deployed
 * contract returns the expected value. A transaction hash on its own is not
 * treated as evidence that anything exists.
 *
 * Usage:
 *
 *     npm run deploy              deploy and record
 *     npm run deploy:dry          run every check, deploy nothing
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  ARTIFACTS_DIR,
  DEPLOYMENT_PATH,
  TARGET_CHAIN_ID,
  contractSource,
  demoPolicyText,
  explorerAddress,
  explorerTx,
  feeOptions,
  formatGen,
  log,
  makeClient,
  readEnv,
  requirePrivateKey,
  runnerRef,
  shortHash,
  writeEnv,
} from "./_shared.mjs";

const DRY_RUN = process.argv.includes("--dry-run");

const DEMO_POLICY_ID = "delivery-milestone-v3";
const DEMO_POLICY_VERSION = "3.0.0";
const DEMO_POLICY_TITLE = "Milestone payment";

/** Deployment is accepted once a decision exists; finality is not required to *exist*. */
const DECIDE_WAIT = { waitUntil: "decided", interval: 4000, retries: 150 };

function fail(message) {
  log.fail(message);
  process.exit(1);
}

async function deploy(client, account, name, args) {
  const fees = await feeOptions(client);
  log.info(
    `deploying ${name}${args?.length ? ` (${args.length} arg)` : ""} -- fee ${formatGen(fees.feeValue)}`,
  );
  const hash = await client.deployContract({ code: contractSource(name), args, fees });
  const receipt = await client.waitForTransactionReceipt({ hash, ...DECIDE_WAIT });

  if (receipt?.status_name === "CANCELED" || receipt?.status_name === "UNDETERMINED") {
    fail(`${name} deployment did not succeed: ${receipt.status_name}`);
  }

  const address = receipt?.data?.contract_address ?? receipt?.contract_address;
  if (!address) fail(`${name} deployed but no address was returned`);

  log.ok(`${name} -> ${address}`);
  log.info(explorerTx(hash));
  return { address, hash, receipt };
}

async function write(client, label, address, functionName, args, value) {
  const fees = await feeOptions(client, { address, functionName, args, value });
  log.info(`${label}: ${functionName} -- fee ${formatGen(fees.feeValue)}`);
  const hash = await client.writeContract({
    address,
    functionName,
    args,
    fees,
    ...(value === undefined ? {} : { value }),
  });
  const receipt = await client.waitForTransactionReceipt({ hash, ...DECIDE_WAIT });
  if (receipt?.status_name === "CANCELED") fail(`${label}: ${functionName} was canceled`);
  log.ok(`${label}: ${functionName} -> ${shortHash(hash)}`);
  return { hash, receipt };
}

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, functionName, args });
}

async function readFinal(client, address, functionName, args = []) {
  return client.readContract({
    address,
    functionName,
    args,
    transactionHashVariant: "latest-final",
  });
}

async function main() {
  const env = readEnv();
  const key = requirePrivateKey();
  const client = makeClient();

  // ------------------------------------------------------------- 1. network
  log.step("Checking target network");
  const chainId = await client.getChainId();
  log.info(`endpoint reports chain id ${chainId}`);
  if (Number(chainId) !== TARGET_CHAIN_ID) {
    fail(
      `Wrong network. Expected chain ${TARGET_CHAIN_ID} (GenLayer Studio Next), got ${chainId}. ` +
        "Set NEXT_PUBLIC_GENLAYER_RPC_URL in .env.local to https://studio-dev.genlayer.com/api or https://studio-next.genlayer.com/api.",
    );
  }
  log.ok(`chain ${chainId} confirmed`);

  const account = client.account;
  log.info(`signing as ${account.address}`);

  // ------------------------------------------------------------- 2. balance
  log.step("Checking wallet balance");
  const balance = await client.getBalance({ address: account.address });
  const gen = Number(balance) / 1e18;
  log.info(`${gen} GEN available`);
  if (balance === 0n) {
    fail(
      `The wallet ${account.address} has no GEN on chain ${TARGET_CHAIN_ID}. ` +
        "Fund it from the GenLayer Studio Next faucet before deploying.",
    );
  }
  if (gen < 1) {
    log.warn("Less than 1 GEN available. Deployment needs a small amount of gas.");
  }

  // -------------------------------------------------------------- 3. sources
  log.step("Checking contract sources");
  const sources = ["ScenarioRegistry", "FinalityVault", "DecisionGate"];
  for (const name of sources) {
    const code = contractSource(name);
    if (!code.startsWith('# { "Depends"')) {
      fail(`${name}: contract source must start with a runner header`);
    }
    log.ok(`${name}: ${code.length} bytes, header present`);
  }

  const policy = demoPolicyText();
  if (policy.length < 40) fail("Demo policy text is missing or too short");
  log.ok(`demo policy: ${policy.length} bytes`);

  if (DRY_RUN) {
    log.step("Dry run -- every check passed, nothing deployed");
    return;
  }

  // --------------------------------------------------------------- 4. deploy
  log.step("Deploying");
  const existing = existsSync(DEPLOYMENT_PATH)
    ? JSON.parse(readFileSync(DEPLOYMENT_PATH, "utf8"))
    : null;
  if (existing?.addresses?.decisionGate && !process.argv.includes("--force")) {
    log.warn(
      `A deployment is already recorded (${existing.addresses.decisionGate}). ` +
        "Re-run with --force to deploy again; the record will be replaced.",
    );
  }

  const registry = await deploy(client, account, "ScenarioRegistry", []);
  const vault = await deploy(client, account, "FinalityVault", [account.address]);
  const gate = await deploy(client, account, "DecisionGate", [vault.address, registry.address]);

  // ---------------------------------------------------------- 5. wire + seed
  log.step("Wiring the contracts");
  const bind = await write(client, "FinalityVault", vault.address, "set_gate", [gate.address]);

  log.step("Publishing the demo policy");
  const publish = await write(client, "ScenarioRegistry", registry.address, "publish_policy", [
    DEMO_POLICY_ID,
    DEMO_POLICY_VERSION,
    DEMO_POLICY_TITLE,
    policy,
  ]);

  // -------------------------------------------------------------- 6. verify
  log.step("Verifying deployed state by reading it back");

  const vaultDescription = await read(client, vault.address, "describe", []);
  if (String(vaultDescription.gate).toLowerCase() !== gate.address.toLowerCase()) {
    fail("FinalityVault did not accept the gate binding");
  }
  log.ok(`vault bound to gate (release stage: ${vaultDescription.release_message_stage})`);

  const gateDescription = await read(client, gate.address, "describe", []);
  if (String(gateDescription.vault).toLowerCase() !== vault.address.toLowerCase()) {
    fail("DecisionGate is not pointing at the vault");
  }
  if (gateDescription.capability_read_scope !== "FINALIZED_CAPABILITY") {
    fail("DecisionGate capability read scope is not FINALIZED_CAPABILITY");
  }
  if (gateDescription.finality_rule !== "promoted-plus-appeal-window") {
    fail("DecisionGate finality rule is not promoted-plus-appeal-window");
  }
  log.ok(
    `gate read scope: ${gateDescription.capability_read_scope}, ` +
      `rule: ${gateDescription.finality_rule}, ` +
      `window: ${gateDescription.appeal_window_seconds}s`,
  );

  const policyRecord = await read(client, registry.address, "get_policy", [DEMO_POLICY_ID]);
  if (policyRecord.exists !== true) fail("Demo policy was not published");
  log.ok(`policy hash: ${policyRecord.policy_hash}`);

  // Before the appeal window closes the escrow must be untouched.
  const escrowCount = await readFinal(client, vault.address, "describe", []);
  log.info(`final-state reads answer (settlement_count=${escrowCount.settlement_count})`);

  // --------------------------------------------------------------- 7. record
  log.step("Recording the deployment");
  const record = {
    network: "GenLayer Studio Next",
    chainId: Number(chainId),
    rpc: env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio-dev.genlayer.com/api",
    explorer: env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL ?? "https://explorer-studio-dev.genlayer.com",
    deployer: account.address,
    runner: runnerRef("DecisionGate"),
    deployedAt: new Date().toISOString(),
    addresses: {
      scenarioRegistry: registry.address,
      finalityVault: vault.address,
      decisionGate: gate.address,
    },
    transactions: {
      scenarioRegistry: registry.hash,
      finalityVault: vault.hash,
      decisionGate: gate.hash,
      setGate: bind.hash,
      publishDemoPolicy: publish.hash,
    },
    demoPolicy: {
      id: DEMO_POLICY_ID,
      version: DEMO_POLICY_VERSION,
      hash: policyRecord.policy_hash,
    },
    links: {
      scenarioRegistry: explorerAddress(registry.address),
      finalityVault: explorerAddress(vault.address),
      decisionGate: explorerAddress(gate.address),
      decisionGateDeployTx: explorerTx(gate.hash),
    },
  };

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  log.ok(`artifacts/deployment.json`);

  // ------------------------------------------------------------ 8. wire env
  if (!process.argv.includes("--no-env")) {
    writeEnv({
      NEXT_PUBLIC_SCENARIO_REGISTRY_ADDRESS: registry.address,
      NEXT_PUBLIC_FINALITY_VAULT_ADDRESS: vault.address,
      NEXT_PUBLIC_DECISION_GATE_ADDRESS: gate.address,
    });
    log.ok(".env.local addresses updated");
  }

  log.step("Deployed");
  log.info(`DecisionGate    ${gate.address}`);
  log.info(`FinalityVault   ${vault.address}`);
  log.info(`ScenarioRegistry ${registry.address}`);
  log.info(`Explorer        ${explorerAddress(gate.address)}`);
  console.log(
    "\nNext: npm run seed   (publish the demo scenario and open a funded escrow)\n",
  );
}

main().catch((error) => {
  fail(error?.stack ?? String(error));
});
