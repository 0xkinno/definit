/**
 * Live integration: the two complete v2 payment paths on the target network.
 *
 *   APPROVE  create, fund, adjudicate, the protocol delivers authorize_release
 *            after the deciding transaction survives its window, the vault settles
 *   REJECT   the same, with close_refused, then the funder withdraws
 *
 * Each path is driven end to end by scripts/lib/v2-flow.mjs and judged by
 * scripts/lib/run-checks.mjs, the checks verify:offline applies to recorded runs.
 * Runs are written as v2-run-T1.json and v2-run-T2.json; the milestone records
 * (R1 to R3) are produced by npm run lifecycle:v2.
 *
 * Usage: npm run test:v2:integration   (needs artifacts/deployment-v2.json and a funded .env.local)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { ensureFunded, makeClient } from "../../../scripts/lib/chain.mjs";
import { checkRun } from "../../../scripts/lib/run-checks.mjs";
import { DEFAULT_EVIDENCE_URL, PARTIAL_EVIDENCE_URL, loadDeployment, runPayment } from "../../../scripts/lib/v2-flow.mjs";

const { client, account } = makeClient();
await ensureFunded(account);
const ctx = { client, account };
const deployment = loadDeployment();

test("APPROVE: the release is a protocol delivery and the vault settles", { timeout: 15 * 60_000 }, async () => {
  const run = await runPayment(ctx, deployment, { run: "T1", kind: "approve", evidenceUrl: DEFAULT_EVIDENCE_URL });
  assert.equal(run.adjudication.verdict, "APPROVE");
  assert.equal(run.vault.escrowBefore.state, "OPEN");
  assert.equal(run.vault.escrowAfter.state, "SETTLED");
  assert.equal(run.delivery.method, "authorize_release");
  assert.equal(run.vault.receipt.finality_source, "protocol-delivery");
  assert.deepEqual(checkRun(run), []);
});

test("REJECT: a finalized refusal closes the escrow and the funder withdraws", { timeout: 15 * 60_000 }, async () => {
  const run = await runPayment(ctx, deployment, { run: "T2", kind: "reject", evidenceUrl: PARTIAL_EVIDENCE_URL });
  assert.equal(run.adjudication.verdict, "REJECT");
  assert.equal(run.delivery.method, "close_refused");
  assert.equal(run.vault.escrowAfter.state, "REFUNDABLE");
  assert.equal(run.vault.escrowAfterWithdraw.state, "WITHDRAWN");
  assert.deepEqual(checkRun(run), []);
});
