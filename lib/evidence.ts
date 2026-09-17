/**
 * Evidence loading.
 *
 * Headline numbers are read from a machine-generated report. They are never
 * typed into a component, a page or a document by hand. If the report does not
 * exist, the application says so instead of inventing a figure.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

export interface ProofCase {
  id: string;
  title: string;
  invariant: string;
  expected: string;
  actual: string;
  outcome: "PASS" | "FAIL";
  detail: string;
}

export interface ProofReport {
  generatedAt: string;
  source: string;
  arms: Array<{
    id: string;
    label: string;
    description: string;
    settlementsFromProvisional: number;
    duplicateSettlements: number;
    commitmentMismatchesAccepted: number;
    settledBoundToFinalized: number;
  }>;
  metrics: {
    provisionalSettlementsBlocked: number;
    commitmentMismatchesBlocked: number;
    replayAttemptsBlocked: number;
    finalizedSettlementsVerified: number;
    totalCases: number;
    passing: number;
  };
  cases: ProofCase[];
  control: {
    description: string;
    outcome: "PASS" | "FAIL";
    detail: string;
  };
}

export interface EvidenceState {
  report: ProofReport | null;
  available: boolean;
}

const REPORT_PATH = path.join(process.cwd(), "docs", "evidence", "proof-report.json");

export async function loadProofReport(): Promise<EvidenceState> {
  try {
    const raw = await readFile(REPORT_PATH, "utf8");
    return { report: JSON.parse(raw) as ProofReport, available: true };
  } catch {
    return { report: null, available: false };
  }
}

export const NOT_MEASURED_COPY =
  "Not measured yet. The proof harness has not produced a report in this checkout, so this application shows no number rather than an invented one. Run `npm run proof` to generate it.";

/** One stage of the recorded live run. Everything here came off the network. */
export interface LiveLifecycleStep {
  name: string;
  at: string;
  transaction?: string;
  explorer?: string;
  execStatus?: string | null;
  refusalCode?: string | null;
  detail?: string | null;
  [key: string]: unknown;
}

export interface LiveLifecycleRecord {
  product: string;
  generatedAt: string;
  completedAt?: string;
  outcome: "complete" | "partial";
  ok: boolean;
  blockedAt: string | null;
  blockedReason: string | null;
  network: { name: string; chainId: number; rpc: string | null; explorer: string | null };
  operator: string;
  contracts: { decisionGate: string; finalityVault: string; scenarioRegistry: string };
  actionId?: string;
  decisionId?: string;
  steps: LiveLifecycleStep[];
  boundary: {
    observableOnThisNetwork?: boolean;
    appealWindowSeconds?: number;
    earlyPromotion?: {
      attempted: boolean;
      refused: boolean;
      reasonCode: string | null;
      transaction?: string;
      explorer?: string;
      execStatus?: string | null;
      detail?: string | null;
    };
    samples?: Array<{
      at: string;
      transactionStatus: string;
      provisionalExists: boolean;
      finalExists: boolean;
    }>;
    promoted?: { state?: string; finalizedAt?: string | null };
  };
  settlement: {
    attempted: boolean;
    executed: boolean;
    reason: string | null;
    status?: string;
    transaction?: string;
    explorer?: string;
    decisionReadScope?: string;
    finalityProof?: string | null;
    amountWei?: string;
    recipient?: string;
    settledAt?: string;
  };
}

const LIFECYCLE_PATHS = [
  path.join(process.cwd(), "artifacts", "live-lifecycle.json"),
  path.join(process.cwd(), "docs", "evidence", "live-lifecycle.json"),
];

/**
 * Load the recorded live run.
 *
 * This is the only place the application reads a claim about the network. It is
 * a *record*, not a live read: the file was written by `npm run lifecycle` and
 * carries the transaction hashes it wrote down. The page says so, and links
 * every hash to the explorer so a reader does not have to take it on trust.
 */
export async function loadLiveLifecycle(): Promise<{
  record: LiveLifecycleRecord | null;
  available: boolean;
}> {
  for (const candidate of LIFECYCLE_PATHS) {
    try {
      const raw = await readFile(candidate, "utf8");
      const record = JSON.parse(raw) as LiveLifecycleRecord;
      if (record?.steps?.length) return { record, available: true };
    } catch {
      // Try the next location. A missing record is a normal state, not an error:
      // the caller falls back to the labelled rehearsal.
    }
  }
  return { record: null, available: false };
}

export const NOT_RECORDED_COPY =
  "No live run has been recorded in this checkout, so this page is showing the offline replay from lib/demo/rehearsal.ts and not chain evidence. Run `npm run lifecycle` with a funded operator key to produce a record.";
