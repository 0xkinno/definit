/**
 * Live runs of one v1 payment, recorded for the offline verifier.
 *
 *   npm run lifecycle:v1 -- R1 R2 R3
 *
 *   R1  APPROVE, unappealed. The release child must appear only after the
 *       adjudicating transaction is Finalized (I8).
 *   R2  REJECT. A finalized close_refused is delivered and the funder
 *       withdraws (I6).
 *   R3  APPROVE, appealed inside the window. Records the appeal, the window,
 *       and that no release exists until the deciding decision has finalized.
 *       Whatever outcome the committee reaches is recorded. No overturn is
 *       engineered or claimed.
 *
 * R4 (a provisional storm) is not producible on this network: accepted-stage
 * emission raises an execution error in the VM under the pinned runner
 * (spike observation O5). That is recorded in docs/milestone/FINDING.md, not
 * faked here.
 *
 * Each run writes docs/evidence/milestone/v1-run-<id>.json and is judged by
 * scripts/lib/run-checks.mjs, the same checks verify:offline applies.
 */
import { log } from "./_shared.mjs";
import { counter, ensureFunded, makeClient } from "./lib/chain.mjs";
import { checkRun } from "./lib/run-checks.mjs";
import { DEFAULT_EVIDENCE_URL, PARTIAL_EVIDENCE_URL, loadDeployment, runPayment } from "./lib/v1-flow.mjs";

const PLAN = {
  R1: { kind: "approve", evidenceUrl: DEFAULT_EVIDENCE_URL, appeal: false },
  R2: { kind: "reject", evidenceUrl: PARTIAL_EVIDENCE_URL, appeal: false },
  R3: { kind: "appeal", evidenceUrl: DEFAULT_EVIDENCE_URL, appeal: true },
};

const wanted = process.argv.slice(2).filter((a) => PLAN[a]);
if (!wanted.length) {
  console.error("usage: npm run lifecycle:v1 -- R1 [R2] [R3]");
  process.exit(2);
}

const { client, account } = makeClient();
await ensureFunded(account);
const ctx = { client, account };
const deployment = loadDeployment();
let failed = 0;

for (const id of wanted) {
  log.step(`${id}: ${PLAN[id].kind}`);
  const record = await runPayment(ctx, deployment, { run: id, ...PLAN[id] });
  const a = record.adjudication;
  log.info(`verdict ${a.verdict} (${a.reasonCode}); adjudicating tx ${a.status}/${a.execution}`);
  log.info(`final appeal deadline ${a.finalAppealDeadline}; delivery created ${record.delivery?.createdTimestamp} (${record.delivery?.method})`);
  log.info(`vault: ${record.vault.escrowBefore.state} -> ${record.vault.escrowAfter.state}${record.vault.escrowAfterWithdraw ? " -> " + record.vault.escrowAfterWithdraw.state : ""}`);
  log.info(`recipient received ${record.balances.recipientDeltaWei} wei; ${record.requestsUsed} requests`);
  if (record.adjudication.appeal) log.info(`appeal: ${JSON.stringify(record.adjudication.appeal).slice(0, 220)}`);
  const problems = checkRun(record);
  if (problems.length) {
    failed += 1;
    for (const p of problems) log.fail(p);
  } else {
    log.ok(`${id} satisfies the recorded-run checks`);
  }
}
log.info(`${counter.calls} requests in total`);
process.exit(failed ? 1 : 0);
