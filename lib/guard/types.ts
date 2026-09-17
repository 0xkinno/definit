/**
 * The vocabulary of the settlement boundary.
 *
 * These types describe the smallest world in which the product claim can be
 * tested: a decision that is readable in two storage scopes, an escrow that
 * waits, and a caller who wants value moved.
 *
 * Nothing here talks to a network. The same shapes are produced by the
 * contracts, and the corpus in `lib/guard/corpus.ts` replays them offline so
 * the argument can be checked without a node.
 */

export type Scope = "provisional" | "final";

export type Verdict = "APPROVE" | "REJECT";

export type EscrowState = "OPEN" | "SETTLED";

export type RefusalCode =
  | "ESCROW_UNKNOWN"
  | "UNAUTHORIZED_CALLER"
  | "ALREADY_SETTLED"
  | "EXPIRED"
  | "COMMITMENT_MISMATCH"
  | "REPLAY_BLOCKED"
  | "DECISION_NOT_FINAL"
  | "VERDICT_NOT_APPROVE";

/** A decision as it is readable in one storage scope. */
export interface Capability {
  action_id: string;
  intent_hash: string;
  policy_hash: string;
  evidence_digest: string;
  nonce: number;
  recipient: string;
  amount: number;
  verdict: Verdict;
}

/** The commitment the vault recorded when the escrow was funded. */
export interface Escrow {
  action_id: string;
  funder: string;
  recipient: string;
  amount: number;
  asset: string;
  intent_hash: string;
  policy_hash: string;
  evidence_digest: string;
  nonce: number;
  deadline_unix: number;
  state: EscrowState;
}

/** What a caller presents when it asks for a release. */
export interface Settlement {
  action_id: string;
  decision_id: string;
  intent_hash: string;
  policy_hash: string;
  evidence_digest: string;
  nonce: number;
  recipient: string;
  amount: number;
}

export interface Outcome {
  released: boolean;
  code: RefusalCode | null;
  /** The scope the capability was consulted at, when one was consulted. */
  readScope: Scope | null;
  /** True when the decision existed at provisional scope but not at final. */
  appealableAtRequest: boolean;
  /** True when the released terms matched the recorded escrow commitment. */
  matchedCommitment: boolean;
  /** True when the release was authorised by a decision readable at final scope. */
  boundToFinal: boolean;
}

export interface World {
  /** Unix seconds. */
  now: number;
  /** Address of the decision contract. Only it may instruct a release. */
  gate: string;
  provisional(decisionId: string): Capability | null;
  final(decisionId: string): Capability | null;
  escrow(actionId: string): Escrow | null;
  usedNonces: Set<string>;
}

export const GEN = "GEN";

export function zeroAddress(): string {
  return "0x" + "0".repeat(40);
}

/** Canonical commitment payload, byte-identical to the contracts'. */
export function commitmentPayload(fields: {
  agent: string;
  recipient: string;
  amount: number;
  asset: string;
  policyHash: string;
  evidenceDigest: string;
  nonce: number;
  deadlineUnix: number;
}): string {
  return [
    "DEFINIT-COMMITMENT-v1",
    `agent=${fields.agent}`,
    `recipient=${fields.recipient}`,
    `amount=${fields.amount}`,
    `asset=${fields.asset}`,
    `policy_hash=${fields.policyHash}`,
    `evidence_digest=${fields.evidenceDigest}`,
    `nonce=${fields.nonce}`,
    `deadline=${fields.deadlineUnix}`,
  ].join("|");
}
