/**
 * The single place where raw network state becomes product state.
 *
 * Every other module in this application consumes `DefinitLifecycle`. If you
 * find yourself comparing a status string inside a component, the abstraction
 * has been bypassed and the safety argument behind it stops holding.
 *
 * Two rules are load-bearing:
 *
 *   1. `ACCEPTED` is never treated as permission to act. Only the finalized
 *      resolution can unlock an effect.
 *   2. A timeout, a hanging round or a missing receipt is never treated as
 *      failure. It means the transaction is still unresolved. Blindly
 *      resubmitting in that window is how a system pays twice.
 */

import type { DefinitLifecycle } from "./state";

export const RAW_STATUSES = [
  "UNINITIALIZED",
  "PENDING",
  "PROPOSING",
  "COMMITTING",
  "REVEALING",
  "ACCEPTED",
  "UNDETERMINED",
  "FINALIZED",
  "CANCELED",
  "APPEAL_REVEALING",
  "APPEAL_COMMITTING",
  "VALIDATORS_TIMEOUT",
  "LEADER_TIMEOUT",
  "LEADER_REVEALING",
] as const;

export type RawStatus = (typeof RAW_STATUSES)[number];

/** Subset of the SDK's TransactionLifecycle that this module depends on. */
export type LifecycleShape =
  | { state: "processing"; phase?: string }
  | { state: "decided"; outcome?: string }
  | { state: "finalized"; outcome?: string }
  | { state: "canceled" };

export interface LifecycleInput {
  /** State recorded by the decision contract. */
  contractState?: string | null;
  /** Raw transaction status, if the caller has one. */
  txStatus?: string | null;
  /** Normalised SDK lifecycle, if the caller has one. */
  txLifecycle?: LifecycleShape | null;
  /** Protocol resolution action; "Finalize" is the finalisation capability. */
  resolutionAction?: string | null;
  /** Whether the vault has released value for this action. */
  settled?: boolean;
  /** Explicit operator hold. */
  held?: boolean;
}

export interface LifecycleReading {
  state: DefinitLifecycle;
  /** Plain-language reason, suitable for display. */
  reason: string;
  /** Which signal decided it. Useful in the technical view. */
  decidedBy: string;
  /** True when the transaction is unresolved rather than failed. */
  unresolved: boolean;
}

const PROGRESS: Record<RawStatus, boolean> = {
  UNINITIALIZED: true,
  PENDING: true,
  PROPOSING: true,
  COMMITTING: true,
  REVEALING: true,
  LEADER_REVEALING: true,
  ACCEPTED: false,
  UNDETERMINED: false,
  FINALIZED: false,
  CANCELED: false,
  APPEAL_REVEALING: false,
  APPEAL_COMMITTING: false,
  VALIDATORS_TIMEOUT: false,
  LEADER_TIMEOUT: false,
};

const UNRESOLVED: Record<string, boolean> = {
  VALIDATORS_TIMEOUT: true,
  LEADER_TIMEOUT: true,
  UNINITIALIZED: true,
};

export function toDefinitLifecycle(input: LifecycleInput): LifecycleReading {
  const contractState = (input.contractState ?? "").toUpperCase();
  const txStatus = (input.txStatus ?? "").toUpperCase();

  if (input.settled || contractState === "SETTLED") {
    return {
      state: "settled",
      reason: "Value was released against a finalized commitment.",
      decidedBy: "vault settlement record",
      unresolved: false,
    };
  }

  if (input.held || contractState === "HELD") {
    return {
      state: "held",
      reason:
        "A lifecycle or binding condition was not satisfied, so the effect was frozen.",
      decidedBy: "decision contract state",
      unresolved: false,
    };
  }

  if (contractState === "REJECTED") {
    return {
      state: "rejected",
      reason: "The evidence did not satisfy the policy. Nothing was released.",
      decidedBy: "decision contract state",
      unresolved: false,
    };
  }

  // Finality first: the resolution action is the protocol's finalisation
  // capability, and it outranks any stored status.
  const finalByResolution = (input.resolutionAction ?? "") === "Finalize";
  const finalByLifecycle = input.txLifecycle?.state === "finalized";
  const finalByStatus = txStatus === "FINALIZED";
  const finalByContract = contractState === "FINALIZED";

  if (finalByResolution || finalByLifecycle || finalByStatus || finalByContract) {
    return {
      state: "finalized",
      reason:
        "The appeal window has closed. The commitment may now authorise a release.",
      decidedBy: finalByResolution
        ? "protocol resolution action"
        : finalByLifecycle
          ? "lifecycle read"
          : finalByStatus
            ? "transaction status"
            : "decision contract state",
      unresolved: false,
    };
  }

  if (txStatus.startsWith("APPEAL")) {
    return {
      state: "appealed",
      reason:
        "The accepted judgment has been challenged. The outcome may still change.",
      decidedBy: "transaction status",
      unresolved: false,
    };
  }

  if (UNRESOLVED[txStatus]) {
    return {
      state: "proposing",
      reason:
        "The transaction is unresolved -- this is not a failure. Do not resubmit it.",
      decidedBy: "transaction status",
      unresolved: true,
    };
  }

  if (contractState === "ACCEPTED" || txStatus === "ACCEPTED") {
    return {
      state: "accepted",
      reason:
        "A judgment exists, but it is still appealable. No money may move yet.",
      decidedBy: contractState === "ACCEPTED" ? "decision contract state" : "transaction status",
      unresolved: false,
    };
  }

  if (txStatus === "CANCELED" || input.txLifecycle?.state === "canceled") {
    return {
      state: "held",
      reason: "The transaction was canceled before it produced a judgment.",
      decidedBy: "transaction status",
      unresolved: false,
    };
  }

  if (contractState === "SUBMITTED" && !txStatus) {
    return {
      state: "submitted",
      reason: "The action exists on chain and is waiting to be judged.",
      decidedBy: "decision contract state",
      unresolved: false,
    };
  }

  if (txStatus && PROGRESS[txStatus as RawStatus] !== undefined) {
    return {
      state: "proposing",
      reason: "Validators are deciding whether the evidence satisfies the policy.",
      decidedBy: "transaction status",
      unresolved: false,
    };
  }

  if (contractState === "SUBMITTED") {
    return {
      state: "submitted",
      reason: "The action exists on chain and is waiting to be judged.",
      decidedBy: "decision contract state",
      unresolved: false,
    };
  }

  return {
    state: "draft",
    reason: "Nothing has been submitted yet.",
    decidedBy: "default",
    unresolved: false,
  };
}

export function isUnresolved(status: string | null | undefined): boolean {
  return Boolean(status && UNRESOLVED[status.toUpperCase()]);
}

export function assertNeverFinalisesOnAccepted(reading: LifecycleReading): boolean {
  return reading.state !== "finalized" || reading.decidedBy !== "transaction status accepted";
}
