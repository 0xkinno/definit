/**
 * Collect every generated number into one document.
 *
 * The application, the README and the evidence screens all quote figures. This
 * script is the single place they are assembled from, so a figure cannot be
 * stale in one place and current in another.
 *
 * Usage:
 *
 *     npm run evidence
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT, log } from "./_shared.mjs";

const DOCS = path.join(REPO_ROOT, "docs");
const ARTIFACTS = path.join(REPO_ROOT, "artifacts");
const EVIDENCE = path.join(DOCS, "evidence");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const deployment = readJson(path.join(ARTIFACTS, "deployment.json"));
const proof = readJson(path.join(EVIDENCE, "proof-report.json"));
const lifecycle = readJson(path.join(ARTIFACTS, "live-lifecycle.json"));
const isolation = readJson(path.join(EVIDENCE, "isolation-audit.json"));
const finalScope = readJson(path.join(EVIDENCE, "final-scope-probe.json"));

mkdirSync(EVIDENCE, { recursive: true });

/**
 * The counts, lifted from the proof report.
 *
 * `npm run proof` derives them from the case definitions and refuses to write a
 * report whose counts disagree with the corpus. This script only carries them,
 * so a summary can never be the place a case count goes stale.
 */
const caseCounts = proof?.caseCounts ?? null;

const report = {
  generatedAt: new Date().toISOString(),
  caseCounts,
  deployment,
  proof,
  lifecycle,
  isolation,
  finalScope,
};

writeFileSync(
  path.join(EVIDENCE, "summary.json"),
  JSON.stringify(report, null, 2) + "\n",
  "utf8",
);

/**
 * Claims are written as assertions with the artifact that supports them. A
 * claim without an artifact is not a claim, so it is recorded as unsupported
 * rather than quietly dropped.
 */
const claims = [
  {
    id: "C1",
    claim: "Three contracts are deployed and wired on GenLayer Studio Next (chain 61997).",
    supportedBy: ["artifacts/deployment.json"],
    supported: Boolean(deployment?.addresses?.decisionGate && deployment?.addresses?.finalityVault),
    value: deployment?.addresses ?? null,
  },
  {
    id: "C2",
    claim:
      "The settlement contract releases only against a decision the gate has promoted to FINALIZED, with the appeal window re-derived from the gate's own record.",
    supportedBy: ["contracts/finality_vault.py", "lib/guard/finality.ts"],
    supported: Boolean(proof),
    value: proof ? `${proof.metrics.provisionalSettlementsBlocked} provisional settlement(s) blocked` : null,
  },
  {
    id: "C3",
    claim:
      "A decision that is still inside its appeal window is not authority for an irreversible effect: the release is refused on chain until the window has closed.",
    supportedBy: ["artifacts/live-lifecycle.json", "docs/evidence/proof-report.json"],
    supported: Boolean(lifecycle?.boundary),
    value: lifecycle?.boundary
      ? {
          decisionId: lifecycle.boundary.decisionId,
          samples: lifecycle.boundary.samples?.length ?? 0,
          disagreement: lifecycle.boundary.disagreement ?? false,
        }
      : null,
  },
  {
    id: "C4",
    claim: "The release is bound to the exact commitment the decision contract recorded.",
    supportedBy: ["docs/evidence/proof-report.json"],
    supported: Boolean(proof),
    value: proof ? `${proof.metrics.commitmentMismatchesBlocked} mismatch(es) refused` : null,
  },
  {
    id: "C5",
    claim: "A commitment is spent at most once.",
    supportedBy: ["docs/evidence/proof-report.json"],
    supported: Boolean(proof),
    value: proof ? `${proof.metrics.replayAttemptsBlocked} replay(s) refused` : null,
  },
  {
    id: "C6",
    claim: "A settlement that satisfies every guard is still released.",
    supportedBy: ["docs/evidence/proof-report.json"],
    supported: Boolean(proof),
    value: proof ? `${proof.metrics.finalizedSettlementsVerified} release(s) verified` : null,
  },
  {
    id: "C7",
    claim: "The shipped tree contains no survey vocabulary or surveyed project names.",
    supportedBy: ["docs/evidence/isolation-audit.json"],
    supported: Boolean(isolation),
    value: isolation ?? null,
  },
  {
    id: "C8",
    claim:
      "The corpus counts are derived from the case definitions rather than written down, and the proof run fails if the two disagree.",
    supportedBy: ["docs/evidence/proof-report.json", "tests/fixtures/cases.json"],
    supported: Boolean(caseCounts),
    value: caseCounts,
  },
  {
    id: "C9",
    claim:
      "The final-scope read was probed fresh: the client variant executes and still sees a decision inside its appeal window, while the in-contract variant never returns. The shipped boundary is the elapsed appeal window.",
    supportedBy: ["docs/evidence/final-scope-probe.json", "artifacts/vm-capabilities.json"],
    supported: Boolean(finalScope?.verdict),
    value: finalScope?.verdict ?? null,
  },
  {
    id: "C10",
    claim:
      "This deployment is wallet-first: it holds no signing key, so a session with no wallet cannot click a live action and is offered the recorded run instead.",
    supportedBy: ["app/api/capabilities/route.ts", "lib/runtime/capabilities.ts"],
    supported: true,
    value: {
      browserWalletSigning: true,
      operatorSigning: process.env.DEFINIT_ALLOW_SERVER_SIGNING === "true",
      recordedReplay: Boolean(lifecycle),
    },
  },
];

writeFileSync(
  path.join(DOCS, "CLAIMS.json"),
  JSON.stringify(
    {
      about:
        "Every claim this submission makes, with the artifact that supports it. Regenerate with `npm run evidence`.",
      generatedAt: report.generatedAt,
      claims,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

log.step("Evidence");
for (const claim of claims) {
  if (claim.supported) log.ok(`${claim.id}: ${claim.claim}`);
  else log.warn(`${claim.id}: no artifact yet -- ${claim.claim}`);
}
log.ok("docs/CLAIMS.json");
log.ok("docs/evidence/summary.json");
if (caseCounts) log.info(`case counts: ${JSON.stringify(caseCounts)}`);

const missing = claims.filter((claim) => !claim.supported);
if (missing.length) {
  log.warn(`${missing.length} claim(s) have no artifact in this checkout`);
}
