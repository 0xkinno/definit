/**
 * Record the message fee-parameter template from the network.
 *
 * The network's `sim_estimateTransactionFees` actually executes the call, so it
 * cannot price a call that is expected to revert or whose logic reads chain
 * time -- and both contracts depend on chain time. The fee tree therefore has to
 * be built from the policy quote, and the only part of it that is not derivable
 * from that quote is the encoded `feeParams` blob. This script captures one from
 * a call the network will happily simulate, and writes it to
 * `artifacts/fee-template.json`, which is committed.
 *
 * Run once after deploying, and again only if the network's fee policy changes:
 *
 *     node scripts/fee-template.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ARTIFACTS_DIR, REPO_ROOT, log, makeClient } from "./_shared.mjs";

const OUT = path.join(ARTIFACTS_DIR, "fee-template.json");

/** Any deployed contract that emits an internal message on every call will do. */
const DONOR = JSON.parse(
  readFileSync(path.join(REPO_ROOT, ".gltest-home", "probe-deployment.json"), "utf8"),
);

async function main() {
  const client = makeClient();
  const quote = await client.estimateTransactionFeesForWrite({
    address: DONOR.address,
    functionName: "emit_message",
    args: [],
  });
  const template = (quote.messageAllocations ?? [])[0];
  if (!template) throw new Error("the donor call produced no message allocation to record");

  const record = {
    recordedAt: new Date().toISOString(),
    donor: DONOR.address,
    note:
      "Message fee parameters are policy-derived. This blob is the network's own encoding of the current fee policy for one internal message. It is reused only when the network cannot quote the call being sent, and it is refreshed by re-running this script.",
    messageAllocation: {
      messageType: template.messageType,
      onAcceptance: template.onAcceptance,
      parentIndex: String(template.parentIndex),
      budget: String(template.budget),
      feeParams: template.feeParams,
    },
    callKeyWildcard: "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
  };

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  log.ok(`wrote ${path.relative(REPO_ROOT, OUT)}`);
  log.info(`budget ${record.messageAllocation.budget}`);
}

main().catch((error) => {
  log.fail(String(error?.stack ?? error));
  process.exit(1);
});
