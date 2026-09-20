/**
 * Offline rehearsal.
 *
 * When no contract addresses are configured, the console still has to be
 * reviewable. It walks the *same* state machine locally, using the *same*
 * canonical commitment encoding, so the transitions a reader sees are the
 * transitions the contracts enforce.
 *
 * It is labelled everywhere it appears. It is never presented as chain
 * evidence, it never produces a transaction hash, and it is not allowed to
 * feed the evidence ledger.
 */

import {
  actionIdOf,
  decisionIdOf,
  evidenceDigestOf,
  intentHashOf,
  policyHashOf,
} from "@/lib/commitments/commitment";
import {
  CONTRADICTING_EVIDENCE,
  SATISFYING_EVIDENCE,
  SCENARIO,
  deadlineUnixFromNow,
} from "@/lib/demo/scenario";
import type { DefinitLifecycle } from "@/lib/lifecycle/state";

export interface RehearsalAction {
  actionId: string;
  agent: string;
  recipient: string;
  recipientLabel: string;
  amount: number;
  asset: string;
  policyId: string;
  policyHash: string;
  evidenceUrl: string;
  evidenceDigest: string;
  /** Which snapshot the adjudicator is asked to read. */
  evidenceSet: EvidenceSet;
  intentHash: string;
  nonce: number;
  deadlineUnix: number;
  createdAt: string;
  state: DefinitLifecycle;
  decisionId: string;
  verdict: "APPROVE" | "REJECT" | "";
  reasonCode: string;
  confidence: number;
  note: string;
}

/**
 * Sentinel selecting the evidence set that must be refused.
 *
 * The proof campaign needs an evidence snapshot the adjudicator is required to
 * refuse, otherwise "it approved" would prove nothing about whether the
 * adjudicator is judging at all.
 */
export const CONTRADICTING_EVIDENCE_MARKER = "conflicting";

export const REHEARSAL_AGENT = "0x1111111111111111111111111111111111111111";
export const REHEARSAL_BENEFICIARY = "0x2222222222222222222222222222222222222222";
export const REHEARSAL_OUTSIDER = "0x3333333333333333333333333333333333333333";

function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The two evidence snapshots the rehearsal can ask the adjudicator to read.
 *
 * `satisfying` is the delivery record that the demo policy is written to
 * accept. `contradicting` is the partial-delivery record with an open dispute
 * that the same policy is written to refuse. Without the second one, "it
 * approved" would prove nothing about whether anything is being judged.
 */
export type EvidenceSet = "satisfying" | "contradicting";

export function buildRehearsalAction(options?: {
  evidence?: string;
  evidenceSet?: EvidenceSet;
  recipient?: string;
  recipientLabel?: string;
  nonce?: number;
  createdAt?: string;
}): RehearsalAction {
  const evidenceSet = options?.evidenceSet ?? "satisfying";
  const evidence =
    options?.evidence ??
    (evidenceSet === "contradicting" ? CONTRADICTING_EVIDENCE : SATISFYING_EVIDENCE);
  const recipient = options?.recipient ?? REHEARSAL_BENEFICIARY;
  const createdAt = options?.createdAt ?? isoNow();
  const nonce = options?.nonce ?? 1;
  const deadlineUnix = deadlineUnixFromNow(SCENARIO.deadlineHours);
  const policyHash = policyHashOf(SCENARIO.policyText);
  const evidenceDigest = evidenceDigestOf(evidence);
  const actionId = actionIdOf({
    agent: REHEARSAL_AGENT,
    recipient,
    amount: SCENARIO.amount,
    asset: SCENARIO.asset,
    policyHash,
    nonce,
    createdAt,
  });
  const intentHash = intentHashOf({
    agent: REHEARSAL_AGENT,
    recipient,
    amount: SCENARIO.amount,
    asset: SCENARIO.asset,
    policyHash,
    evidenceDigest,
    nonce,
    deadlineUnix,
  });

  return {
    actionId,
    agent: REHEARSAL_AGENT,
    recipient,
    recipientLabel: options?.recipientLabel ?? SCENARIO.supplier,
    amount: SCENARIO.amount,
    asset: SCENARIO.asset,
    policyId: SCENARIO.policyId,
    policyHash,
    evidenceUrl:
      evidenceSet === "contradicting"
        ? SCENARIO.contradictingEvidenceLocalPath
        : SCENARIO.evidenceLocalPath,
    evidenceDigest,
    evidenceSet,
    intentHash,
    nonce,
    deadlineUnix,
    createdAt,
    state: "submitted",
    decisionId: "",
    verdict: "",
    reasonCode: "",
    confidence: 0,
    note: "",
  };
}

export interface RehearsalStep {
  from: DefinitLifecycle;
  to: DefinitLifecycle;
  at: string;
  detail: string;
  /** Whether value left the vault at this step. */
  effect: boolean;
}

export function adjudicateRehearsal(action: RehearsalAction): RehearsalAction {
  const approved = action.evidenceSet !== "contradicting";
  const decisionId = decisionIdOf({
    actionId: action.actionId,
    attempt: 1,
    intentHash: action.intentHash,
    adjudicatedAt: isoNow(),
  });
  return {
    ...action,
    decisionId,
    verdict: approved ? "APPROVE" : "REJECT",
    reasonCode: approved ? "EVIDENCE_SATISFIES_POLICY" : "EVIDENCE_CONTRADICTS",
    confidence: approved ? 93 : 88,
    note: approved
      ? "The record names order #742 and states full receipt with no dispute."
      : "The record shows a partial delivery with an open dispute.",
    state: approved ? "accepted" : "rejected",
  };
}

export function finalizeRehearsal(action: RehearsalAction): RehearsalAction {
  if (action.state !== "accepted") return action;
  return { ...action, state: "finalized" };
}

export function settleRehearsal(action: RehearsalAction): RehearsalAction {
  if (action.state !== "finalized") return action;
  return { ...action, state: "settled" };
}

export interface RehearsalAttempt {
  label: string;
  outcome: "BLOCKED" | "PASS";
  invariant: string;
  detail: string;
}

/**
 * The control case: the same decision, a different beneficiary.
 *
 * DEFINIT is not merely waiting for time. It is enforcing identity. This is
 * the demonstration that the wait is not the whole product.
 */
export function attemptSubstitutedBeneficiary(action: RehearsalAction): RehearsalAttempt {
  const substituted = intentHashOf({
    agent: action.agent,
    recipient: REHEARSAL_OUTSIDER,
    amount: action.amount,
    asset: action.asset,
    policyHash: action.policyHash,
    evidenceDigest: action.evidenceDigest,
    nonce: action.nonce,
    deadlineUnix: action.deadlineUnix,
  });
  const matches = substituted === action.intentHash;
  return {
    label: "Substituted beneficiary",
    outcome: matches ? "PASS" : "BLOCKED",
    invariant: "commitment binding",
    detail: matches
      ? "The substituted intent hash matched."
      : "The escrow commitment names a different beneficiary than the caller restated. Settlement is refused.",
  };
}

export function attemptReplay(action: RehearsalAction, alreadySettled: boolean): RehearsalAttempt {
  return {
    label: "Replayed settlement",
    outcome: alreadySettled ? "BLOCKED" : "PASS",
    invariant: "one-time settlement",
    detail: alreadySettled
      ? "The settlement nonce is already spent. The second delivery is refused."
      : "No settlement has been recorded yet.",
  };
}

export function attemptProvisionalRelease(action: RehearsalAction): RehearsalAttempt {
  const provisional = action.state === "accepted";
  return {
    label: "Release while still appealable",
    outcome: provisional ? "BLOCKED" : "PASS",
    invariant: "finality boundary",
    detail: provisional
      ? "The decision is provisional and still inside its appeal window. A scoped read changes which transaction's storage is consulted, not whether the decision is appealable, so the release is refused on the window instead."
      : "The decision is not in the provisional state.",
  };
}

export function attemptChangedAmount(action: RehearsalAction): RehearsalAttempt {
  const changed = intentHashOf({
    agent: action.agent,
    recipient: action.recipient,
    amount: action.amount + 1,
    asset: action.asset,
    policyHash: action.policyHash,
    evidenceDigest: action.evidenceDigest,
    nonce: action.nonce,
    deadlineUnix: action.deadlineUnix,
  });
  return {
    label: "Altered amount",
    outcome: changed === action.intentHash ? "PASS" : "BLOCKED",
    invariant: "commitment binding",
    detail:
      changed === action.intentHash
        ? "The altered amount produced the same intent hash."
        : "Restating a different amount changes the intent hash, so the release is refused.",
  };
}

export function attemptChangedPolicy(action: RehearsalAction): RehearsalAttempt {
  const changed = policyHashOf(`${SCENARIO.policyText}\n(revised)`);
  return {
    label: "Altered policy",
    outcome: changed === action.policyHash ? "PASS" : "BLOCKED",
    invariant: "policy immutability",
    detail:
      changed === action.policyHash
        ? "The revised policy produced the same hash."
        : "The policy is content-addressed. Editing it produces a different hash, so the decision no longer binds.",
  };
}

export function fullAttemptCorpus(action: RehearsalAction, settled: boolean): RehearsalAttempt[] {
  return [
    attemptProvisionalRelease(action),
    attemptSubstitutedBeneficiary(action),
    attemptChangedAmount(action),
    attemptChangedPolicy(action),
    attemptReplay(action, settled),
  ];
}

