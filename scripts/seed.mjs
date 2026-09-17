/**
 * Put the deployment into a known demo state.
 *
 * Idempotent by construction: it checks the registry before publishing, and it
 * reports the action it created so the console can be opened directly on it.
 *
 * Usage:
 *
 *     npm run seed
 */

import {
  explorerTx,
  feeOptions,
  log,
  makeClient,
  readEnv,
  requireAddresses,
  requirePrivateKey,
} from "./_shared.mjs";

const DEMO_POLICY_ID = "delivery-milestone-v3";
const DEMO_POLICY_VERSION = "3.0.0";
const DEMO_POLICY_TITLE = "Milestone payment";
const DEMO_RECIPIENT = "0x1111111111111111111111111111111111111111";

async function main() {
  requirePrivateKey();
  const addresses = requireAddresses();
  const env = readEnv();
  const client = makeClient();

  const policyText = (
    await import("node:fs")
  ).readFileSync(new URL("../public/demo/policy-delivery-milestone-v3.txt", import.meta.url), "utf8").replace(/^\uFEFF/, "").trimEnd();

  log.step("Seeding the demo scenario");

  const existing = await client.readContract({
    address: addresses.scenarioRegistry,
    functionName: "get_policy",
    args: [DEMO_POLICY_ID],
  });

  if (existing.exists === true) {
    log.ok(`policy ${DEMO_POLICY_ID} already published (${existing.policy_hash})`);
  } else {
    const fees = await feeOptions(client, {
      address: addresses.scenarioRegistry,
      functionName: "publish_policy",
      args: [DEMO_POLICY_ID, DEMO_POLICY_VERSION, DEMO_POLICY_TITLE, policyText],
    });
    const hash = await client.writeContract({
      address: addresses.scenarioRegistry,
      functionName: "publish_policy",
      args: [DEMO_POLICY_ID, DEMO_POLICY_VERSION, DEMO_POLICY_TITLE, policyText],
      fees,
    });
    await client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 3000, retries: 200 });
    log.ok(`published ${DEMO_POLICY_ID}`);
    log.info(explorerTx(hash));
  }

  const evidenceUrl = (env.DEFINIT_DEMO_EVIDENCE_URL ?? "").trim();
  if (!evidenceUrl.startsWith("https://")) {
    log.fail("DEFINIT_DEMO_EVIDENCE_URL must be a public https URL before seeding an action");
    process.exit(1);
  }

  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
  const nonce = Math.floor(Date.now() / 1000);
  const amount = 10_000_000_000_000_000n;

  const args = [DEMO_RECIPIENT, amount, "GEN", DEMO_POLICY_ID, evidenceUrl, deadline, nonce];
  const fees = await feeOptions(client, {
    address: addresses.decisionGate,
    functionName: "create_action",
    args,
  });
  const hash = await client.writeContract({
    address: addresses.decisionGate,
    functionName: "create_action",
    args,
    fees,
  });
  await client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 3000, retries: 200 });
  log.ok(`action proposed`);
  log.info(explorerTx(hash));

  const listed = await client.readContract({
    address: addresses.decisionGate,
    functionName: "list_actions_for",
    args: [client.account.address.toLowerCase()],
  });
  if (listed.length > 0) {
    const actionId = listed[listed.length - 1].action_id;
    log.step("Open this action");
    console.log(`   /actions/${actionId}`);
  }
}

main().catch((error) => {
  log.fail(String(error?.stack ?? error));
  process.exit(1);
});
