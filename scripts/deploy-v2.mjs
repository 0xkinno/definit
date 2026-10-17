/**
 * Deploy the v2 contracts to the target network and record them.
 *
 *   npm run deploy:v2
 *
 * Writes artifacts/deployment-v2.json. v1's artifacts/deployment.json is never
 * touched: v1 stays deployed and stays the comparison arm.
 */
import { log } from "./_shared.mjs";
import { counter, ensureFunded, makeClient } from "./lib/chain.mjs";
import { deployV2 } from "./lib/v2-flow.mjs";

const { client, account } = makeClient();
await ensureFunded(account);
const ctx = { client, account };
log.step("Deploying DEFINIT v2");
const d = await deployV2(ctx);
log.ok(`registry ${d.addresses.scenarioRegistry}`);
log.ok(`vault    ${d.addresses.finalityVault}`);
log.ok(`gate     ${d.addresses.decisionGate}`);
log.info(`vault describe: ${JSON.stringify(d.describe.vault)}`);
log.info(`${counter.calls} requests, ${d.tookSeconds}s`);
process.exit(0);
