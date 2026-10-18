/**
 * Compact every generated number the pages show into one bundled JSON.
 *
 *   npm run gen:milestone-data     writes lib/milestone/data.generated.json
 *
 * Pages import this file at build time, so they work on Vercel without reading
 * the evidence directory, and they contain no typed figure: everything here is
 * read from docs/evidence/milestone, artifacts/deployment-v1.json and the
 * public demo files. Re-run it after any evidence changes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";
import { evidenceDigestOf } from "../lib/commitments/commitment.ts";

const EV = path.join(REPO_ROOT, "docs", "evidence", "milestone");
const rd = (p) => JSON.parse(readFileSync(p, "utf8"));
const tx = (h) => `https://explorer-studio-dev.genlayer.com/tx/${h}`;

const deployment = rd(path.join(REPO_ROOT, "artifacts", "deployment-v1.json"));
const report = rd(path.join(EV, "proof-v1-report.json"));
const cf = rd(path.join(EV, "counterfactual.json"));
const faults = rd(path.join(EV, "faults.json")).rows;
const matrix = rd(path.join(EV, "network-matrix.json"));
const property = rd(path.join(EV, "property.json"));
const sizes = rd(path.join(EV, "size-budget.json")).sizes;
const verification = rd(path.join(EV, "offline-verification.json"));
const noClock = rd(path.join(EV, "no-clock-check.json"));

const runs = ["R1", "R2", "R3"].map((id) => {
  const r = rd(path.join(EV, `v1-run-${id}.json`));
  const a = r.adjudication;
  const stepTx = (name) => r.steps.find((s) => s.name === name)?.tx;
  return {
    id,
    kind: r.kind,
    verdict: a.verdict,
    reasonCode: a.reasonCode,
    actionId: r.action.id,
    submittedAtS: Math.floor(a.submittedAtMs / 1000),
    acceptedAtS: a.materializedAt,
    finalAppealDeadlineS: a.finalAppealDeadline,
    deliveryCreatedS: r.delivery.createdTimestamp,
    deliveryMethod: r.delivery.method,
    escrow: [r.vault.escrowBefore.state, r.vault.escrowAfter.state, r.vault.escrowAfterWithdraw?.state].filter(Boolean),
    appeal: a.appeal && !a.appeal.error ? { chargeWei: a.appeal.charge } : null,
    links: {
      createAction: stepTx("create_action") ? tx(stepTx("create_action")) : null,
      openEscrow: stepTx("open_escrow") ? tx(stepTx("open_escrow")) : null,
      adjudication: tx(a.txHash),
      delivery: tx(r.delivery.childTxHash),
      withdraw: r.withdraw ? tx(r.withdraw.txHash) : null,
    },
    receipt: r.vault.receipt?.exists ? { finalitySource: r.vault.receipt.finality_source, deliveredBy: r.vault.receipt.delivered_by, status: r.vault.receipt.status } : null,
  };
});

const spike = ["repro-1", "repro-2"].map((d) => rd(path.join(EV, "spike", d, "summary.json")));
const e6 = rd(path.join(EV, "spike", "e6-h1-v0-run2.json"));
const matrixStudio = matrix.networks["studio-dev"];

const demo = ["delivery-742.txt", "delivery-742-partial.txt", "delivery-742-injected.txt"].map((f) => ({
  file: f,
  url: `https://definit-snowy.vercel.app/demo/${f}`,
  digest: evidenceDigestOf(readFileSync(path.join(REPO_ROOT, "public", "demo", f), "utf8").replace(/^﻿/, "")),
}));

const opt = (f) => (existsSync(path.join(EV, f)) ? rd(path.join(EV, f)) : null);
const mutation = opt("mutation.json");
const books = opt("books.json");
const profile = rd(path.join(REPO_ROOT, "fee-profile.json"));
const parity = rd(path.join(REPO_ROOT, "tests", "v1", "fixtures", "parity-vectors.json"));
const injectedRun = opt("v1-run-R5.json");
const guardTests = (readFileSync(path.join(REPO_ROOT, "packages", "definit-guard", "test", "guard.test.ts"), "utf8").match(/^\s+it\(/gm) ?? []).length;
const agentRuns = readdirSync(EV).filter((f) => /^agent-run-[\w-]+\.json$/.test(f)).map((f) => {
  const a = rd(path.join(EV, f));
  return { kind: f.replace(/^agent-run-|\.json$/g, ""), state: a.result.state, paid: a.result.paid, finalized: a.result.finalized, adjudication: tx(a.payment.adjudicationTx), delivery: a.deliveryTx ? tx(a.deliveryTx) : null, refund: a.refundTx ? tx(a.refundTx) : null };
});

const data = {
  generatedAt: new Date().toISOString(),
  network: { name: deployment.network, chainId: deployment.chainId, explorer: deployment.explorer },
  deployment: {
    deployedAt: deployment.deployedAt,
    addresses: deployment.addresses,
    links: deployment.links,
    describe: { vault: deployment.describe.vault, gate: deployment.describe.gate },
    policy: deployment.demoPolicy,
  },
  runs,
  corpus: { headline: report.headline, byInvariant: report.byInvariant, refusalsByCode: report.refusalsByCode, reconciliation: report.reconciliation },
  property: {
    seeds: Object.keys(property.runs).length,
    lifecycles: Object.values(property.runs).reduce((n, r) => n + r.lifecycles, 0),
    events: Object.values(property.runs).reduce((n, r) => n + r.events, 0),
    perSeed: Object.entries(property.runs).map(([seed, r]) => ({ seed, lifecycles: r.lifecycles })),
  },
  counterfactual: { medianWindowSeconds: cf.medianWindowSeconds, arms: cf.arms, v1FunderPath: { unsafe: cf.v1FunderPath.unsafe, of: cf.v1FunderPath.of }, timelines: cf.timelines.length, caveats: cf.caveats },
  differential: {
    promotionLifecycle: e6.result.promotionLifecycleWhenSettleSubmitted,
    promotionAppealDeadline: e6.result.promotionAppealDeadline,
    settleDecidedAt: e6.result.settleMaterializedAt,
    settleExecution: e6.settle.execution,
    vaultStatus: e6.vaultReceipt.status,
    link: tx(e6.settle.hash),
  },
  spike: {
    reproductions: spike.length,
    decisions: spike.reduce((n, s) => n + s.E1.runs.length, 0),
    appealWindowSeconds: matrixStudio.appealWindowSeconds,
    childCreatedSecondsAfterDeadline: matrixStudio.finalizedMessageDelivery?.childCreatedSecondsAfterAppealDeadline,
  },
  faults: faults.map(({ id, fault, expected, invariant, where, status, note }) => ({ id, fault, expected, invariant, where, status, note: note ?? null })),
  verification: { pass: verification.counts.pass, fail: verification.counts.fail, notEvidenced: verification.counts["not-evidenced"], checks: verification.checks.map((c) => ({ id: c.id, title: c.title, status: c.status, invariants: c.invariants })) },
  noClock: { comparisons: noClock.comparisons.length, pass: noClock.pass },
  sizes,
  networks: Object.values(matrix.networks).map((n) => ({
    network: n.network, chainId: n.chainId, lifecycleMethod: n.lifecycleMethodAnswers,
    executesContracts: typeof n.executesContracts === "boolean" ? n.executesContracts : "not measured",
    funding: n.fundingMethod,
  })),
  evidenceFiles: demo,
  extras: {
    parity: { vectors: parity.vectors.length },
    mutation: mutation ? { total: mutation.total, killed: mutation.killed, survived: mutation.survived, target: mutation.target, mutants: mutation.mutants.map((m) => ({ id: m.id, invariant: m.invariant, mutation: m.mutation, status: m.status })) } : null,
    books: books ? { escrows: books.totals.escrows, balanced: books.balanced, totals: books.totals, rows: books.rows } : null,
    feeProfile: { chainId: Number(profile.chainId), measuredAt: profile.measuredAt, methods: Object.entries(profile.measurements).map(([name, m]) => ({ name, basis: m.basis })) },
    guard: { tests: guardTests, skill: "skills/definit-finality-guard" },
    injected: injectedRun ? { verdict: injectedRun.adjudication.verdict, reasonCode: injectedRun.adjudication.reasonCode, adjudication: tx(injectedRun.adjudication.txHash), delivery: injectedRun.delivery ? tx(injectedRun.delivery.childTxHash) : null } : null,
    agentRuns,
  },
};

mkdirSync(path.join(REPO_ROOT, "lib", "milestone"), { recursive: true });
writeFileSync(path.join(REPO_ROOT, "lib", "milestone", "data.generated.json"), JSON.stringify(data, null, 2));
log.ok(`lib/milestone/data.generated.json: ${runs.length} runs, ${data.corpus.headline.cases} corpus cases, ${data.property.lifecycles} property lifecycles`);
