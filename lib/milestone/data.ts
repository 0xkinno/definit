/**
 * The milestone numbers, typed. Every value comes from
 * `data.generated.json`, which scripts/gen-milestone-data.mjs writes from the
 * evidence files. Nothing in this module or in any page is a typed figure.
 */
import raw from "./data.generated.json";

export type Arm = { unsafe: number; of: number; refusedLegitimate: number; medianSecondsFromFinalToPayment: number };

export interface RunRecord {
  id: string;
  kind: string;
  verdict: string;
  reasonCode: string;
  actionId: string;
  submittedAtS: number;
  acceptedAtS: number;
  finalAppealDeadlineS: number;
  deliveryCreatedS: number;
  deliveryMethod: string;
  escrow: string[];
  appeal: { chargeWei: string } | null;
  links: { createAction: string | null; openEscrow: string | null; adjudication: string; delivery: string; withdraw: string | null };
  receipt: { finalitySource: string; deliveredBy: string; status: string } | null;
}

export const milestone = raw as unknown as {
  generatedAt: string;
  network: { name: string; chainId: number; explorer: string };
  deployment: {
    deployedAt: string;
    addresses: { scenarioRegistry: string; finalityVault: string; decisionGate: string };
    links: { scenarioRegistry: string; finalityVault: string; decisionGate: string };
    describe: { vault: Record<string, string | number>; gate: Record<string, string | number> };
    policy: { id: string; version: string; hash: string };
  };
  runs: RunRecord[];
  corpus: {
    headline: { cases: number; passed: number; steps: number; refusals: number; recordedNoops: number };
    byInvariant: Array<{ invariant: string; cases: number; passed: number; attackedBy: string }>;
    refusalsByCode: Record<string, number>;
    reconciliation: string[];
  };
  property: { seeds: number; lifecycles: number; events: number; perSeed: Array<{ seed: string; lifecycles: number }> };
  counterfactual: {
    medianWindowSeconds: number;
    arms: { baseline: Arm; control: Arm; v1: Arm; v2: Arm };
    v1FunderPath: { unsafe: number; of: number };
    timelines: number;
    caveats: string[];
  };
  differential: {
    promotionLifecycle: { projectedStatus: string; resolutionAction: string };
    promotionAppealDeadline: number;
    settleDecidedAt: number;
    settleExecution: string;
    vaultStatus: string;
    link: string;
  };
  spike: { reproductions: number; decisions: number; appealWindowSeconds: number; childCreatedSecondsAfterDeadline: number };
  faults: Array<{ id: string; fault: string; expected: string; invariant: string; where: string; status: string; note: string | null }>;
  verification: { pass: number; fail: number; notEvidenced: number; checks: Array<{ id: string; title: string; status: string; invariants: string[] }> };
  noClock: { comparisons: number; pass: boolean };
  sizes: Record<string, { readableBytes: number; minifiedBytes: number }>;
  networks: Array<{ network: string; chainId: number; lifecycleMethod: boolean; executesContracts: boolean | string; funding: string }>;
  evidenceFiles: Array<{ file: string; url: string; digest: string }>;
};

/** The proof line, built from the counterfactual and nothing else. */
export function proofLine(): string {
  const a = milestone.counterfactual.arms;
  const f = milestone.counterfactual.v1FunderPath;
  return (
    `Across ${milestone.counterfactual.timelines} recorded protocol timelines, a pay-on-Accepted agent executed ${a.baseline.unsafe}/${a.baseline.of} payments before the decision was final, ` +
    `a fixed-timer agent ${a.control.unsafe}/${a.control.of}, DEFINIT v1's funder path ${f.unsafe}/${f.of} (measured separately), and DEFINIT v2 ${a.v2.unsafe}/${a.v2.of}, ` +
    `with ${a.v2.refusedLegitimate} legitimate releases refused.`
  );
}

export const gen = (n: number) => new Date(n * 1000).toISOString().slice(11, 19) + " UTC";
