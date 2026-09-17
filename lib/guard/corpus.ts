/**
 * The settlement corpus.
 *
 * Each case is a small world, a caller and a claim. Every case is replayed
 * against two implementations:
 *
 *   * the baseline, which consults the decision at provisional storage scope;
 *   * the intervention, which requires the decision to have cleared its
 *     appeal window *and* an exact commitment match.
 *
 * The point of running both is attribution. A case that is refused by the
 * intervention but released by the baseline has a cause, and that cause is the
 * single property that differs between them.
 *
 * Four cases must be *released*. Without them, "everything was refused" would
 * look like a result.
 */

import { unsafeRelease } from "./baseline.ts";
import { guardedSettle } from "./finality.ts";
import type { Capability, Escrow, Outcome, Settlement, World } from "./types.ts";
import { GEN, zeroAddress } from "./types.ts";

export const GATE = "0x00000000000000000000000000000000000000aa";
export const VAULT = "0x00000000000000000000000000000000000000bb";
export const AGENT = "0x00000000000000000000000000000000000000c1";
export const BENEFICIARY = "0x00000000000000000000000000000000000000d1";
export const OTHER_BENEFICIARY = "0x00000000000000000000000000000000000000d2";
export const OUTSIDER = "0x00000000000000000000000000000000000000e1";

export const POLICY_HASH = "0x" + "11".repeat(32);
export const OTHER_POLICY_HASH = "0x" + "22".repeat(32);
export const EVIDENCE_DIGEST = "0x" + "33".repeat(32);
export const OTHER_EVIDENCE_DIGEST = "0x" + "44".repeat(32);
export const INTENT_HASH = "0x" + "55".repeat(32);

export const AMOUNT = 10;
export const NONCE = 7;
export const DEADLINE = 4_000_000_000;

export interface CaseWorld {
  world: World;
  caller: string;
  claim: Settlement;
  /** Deliver the instruction twice, as a duplicated message would. */
  deliverTwice?: boolean;
}

function escrowFor(overrides: Partial<Escrow> = {}): Escrow {
  return {
    action_id: "action-1",
    funder: AGENT,
    recipient: BENEFICIARY,
    amount: AMOUNT,
    asset: GEN,
    intent_hash: INTENT_HASH,
    policy_hash: POLICY_HASH,
    evidence_digest: EVIDENCE_DIGEST,
    nonce: NONCE,
    deadline_unix: DEADLINE,
    state: "OPEN",
    ...overrides,
  };
}

function claimFor(overrides: Partial<Settlement> = {}): Settlement {
  return {
    action_id: "action-1",
    decision_id: "decision-1",
    intent_hash: INTENT_HASH,
    policy_hash: POLICY_HASH,
    evidence_digest: EVIDENCE_DIGEST,
    nonce: NONCE,
    recipient: BENEFICIARY,
    amount: AMOUNT,
    ...overrides,
  };
}

function capabilityFor(overrides: Partial<Capability> = {}): Capability {
  return {
    action_id: "action-1",
    intent_hash: INTENT_HASH,
    policy_hash: POLICY_HASH,
    evidence_digest: EVIDENCE_DIGEST,
    nonce: NONCE,
    recipient: BENEFICIARY,
    amount: AMOUNT,
    verdict: "APPROVE",
    ...overrides,
  };
}

function makeWorld(scopes: {
  provisional?: Capability | null;
  final?: Capability | null;
  escrow?: Escrow | null;
  usedNonces?: string[];
  now?: number;
}): World {
  return {
    now: scopes.now ?? 1_700_000_000,
    gate: GATE,
    usedNonces: new Set(scopes.usedNonces ?? []),
    provisional: () => scopes.provisional ?? null,
    final: () => scopes.final ?? null,
    escrow: () => scopes.escrow ?? null,
  };
}

/** Build the world a case describes. Unknown ids throw, so a drifted corpus fails loudly. */
export function buildCase(id: string): CaseWorld {
  switch (id) {
    case "valid-finalization":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor(),
      };

    case "valid-second-action":
      return {
        world: makeWorld({
          provisional: capabilityFor({ action_id: "action-2", nonce: 8, recipient: BENEFICIARY }),
          final: capabilityFor({ action_id: "action-2", nonce: 8, recipient: BENEFICIARY }),
          escrow: escrowFor({ action_id: "action-2", nonce: 8 }),
        }),
        caller: GATE,
        claim: claimFor({ action_id: "action-2", nonce: 8 }),
      };

    case "valid-after-appeal-window":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
          now: DEADLINE - 1,
        }),
        caller: GATE,
        claim: claimFor(),
      };

    case "accepted-not-final":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: null,
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor(),
      };

    case "appeal-overturned":
      return {
        world: makeWorld({
          provisional: capabilityFor({ verdict: "APPROVE" }),
          final: capabilityFor({ verdict: "REJECT" }),
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor(),
      };

    case "wrong-recipient":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor({ recipient: OTHER_BENEFICIARY }),
      };

    case "wrong-amount":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor({ amount: AMOUNT + 1 }),
      };

    case "wrong-policy":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor({ policy_hash: OTHER_POLICY_HASH }),
      };

    case "wrong-evidence":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor({ evidence_digest: OTHER_EVIDENCE_DIGEST }),
      };

    case "replay":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor({ state: "SETTLED" }),
          usedNonces: [`action-1:${NONCE}`],
        }),
        caller: GATE,
        claim: claimFor(),
      };

    case "duplicate-message":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
          usedNonces: [`action-1:${NONCE}`],
        }),
        caller: GATE,
        claim: claimFor(),
      };

    case "expiry":
      return {
        world: makeWorld({
          provisional: capabilityFor(),
          final: capabilityFor(),
          escrow: escrowFor(),
          now: DEADLINE + 1,
        }),
        caller: GATE,
        claim: claimFor(),
      };

    case "rejected-decision":
      return {
        world: makeWorld({
          provisional: capabilityFor({ verdict: "REJECT" }),
          final: capabilityFor({ verdict: "REJECT" }),
          escrow: escrowFor(),
        }),
        caller: GATE,
        claim: claimFor(),
      };

    default:
      throw new Error(`Unknown corpus case: ${id}`);
  }
}

export interface CaseResult {
  released: boolean;
  code: string | null;
  outcome: Outcome;
  /** A second delivery of the same instruction was also attempted. */
  secondDeliveryReleased?: boolean;
}

export interface CorpusEntry {
  id: string;
  title: string;
  invariant: string;
  expected: string;
  actual: string;
  expectedCode: string | null;
  baseline: CaseResult;
  intervention: CaseResult;
  outcome: "PASS" | "FAIL";
  detail: string;
}

export interface CorpusReport {
  entries: CorpusEntry[];
  metrics: {
    provisionalSettlementsBlocked: number;
    commitmentMismatchesBlocked: number;
    replayAttemptsBlocked: number;
    finalizedSettlementsVerified: number;
    totalCases: number;
    passing: number;
  };
  arms: Array<{
    id: string;
    label: string;
    description: string;
    settlementsFromProvisional: number;
    duplicateSettlements: number;
    commitmentMismatchesAccepted: number;
    settledBoundToFinalized: number;
  }>;
  control: { description: string; outcome: "PASS" | "FAIL"; detail: string };
}

export interface CorpusInput {
  id: string;
  title: string;
  invariant: string;
  expected: string;
  expectedCode: string | null;
}

function replay(
  id: string,
  arm: (world: World, caller: string, claim: Settlement) => Outcome,
): CaseResult {
  const scenario = buildCase(id);
  const first = arm(scenario.world, scenario.caller, scenario.claim);
  const second = scenario.deliverTwice
    ? arm(scenario.world, scenario.caller, scenario.claim)
    : null;
  return {
    released: first.released,
    code: first.code,
    outcome: first,
    secondDeliveryReleased: second?.released,
  };
}

export function runCorpus(inputs: CorpusInput[]): CorpusReport {
  const entries: CorpusEntry[] = inputs.map((input) => {
    const baseline = replay(input.id, unsafeRelease);
    const intervention = replay(input.id, guardedSettle);

    const shouldSettle = input.expected === "SETTLE";
    const releasedCorrectly = intervention.released === shouldSettle;
    const codeCorrect =
      shouldSettle || input.expectedCode === null
        ? true
        : intervention.code === input.expectedCode;

    return {
      id: input.id,
      title: input.title,
      invariant: input.invariant,
      expected: shouldSettle
        ? "released"
        : `refused with ${input.expectedCode}`,
      actual: intervention.released
        ? "released"
        : `refused with ${intervention.code ?? "no code"}`,
      outcome: releasedCorrectly && codeCorrect ? "PASS" : "FAIL",
      detail: shouldSettle
        ? `The escrow moved ${intervention.released ? "exactly" : "not at all"}, and the baseline ${
            baseline.released ? "also moved it" : "refused it"
          }.`
        : `Baseline ${baseline.released ? `released (${baseline.code ?? "no refusal"})` : `refused (${baseline.code})`}; the intervention refused with ${
            intervention.code ?? "no code"
          }.`,
      expectedCode: input.expectedCode,
      baseline,
      intervention,
    } as CorpusEntry;
  });

  const refusalIds = entries.filter((entry) => entry.expectedCode !== null);
  const interventions = entries.map((entry) => entry.intervention);
  const baselines = entries.map((entry) => entry.baseline);

  const metrics = {
    provisionalSettlementsBlocked: interventions.filter(
      (result) => result.code === "DECISION_NOT_FINAL" || result.outcome.appealableAtRequest,
    ).length,
    commitmentMismatchesBlocked: interventions.filter(
      (result) => result.code === "COMMITMENT_MISMATCH",
    ).length,
    replayAttemptsBlocked: interventions.filter(
      (result) => result.code === "REPLAY_BLOCKED" || result.code === "ALREADY_SETTLED",
    ).length,
    finalizedSettlementsVerified: interventions.filter(
      (result) => result.released && result.outcome.boundToFinal,
    ).length,
    totalCases: entries.length,
    passing: entries.filter((entry) => entry.outcome === "PASS").length,
  };

  const arms = [
    {
      id: "baseline",
      label: "Provisional-scope settlement",
      description:
        "The same settlement contract consulting the decision at provisional storage scope, which is the property an integration inherits when it treats an accepted judgement as actionable.",
      settlementsFromProvisional: baselines.filter(
        (result) => result.released && result.outcome.appealableAtRequest,
      ).length,
      duplicateSettlements: baselines.filter((result) => result.secondDeliveryReleased).length,
      commitmentMismatchesAccepted: baselines.filter(
        (result) => result.released && !result.outcome.matchedCommitment,
      ).length,
      settledBoundToFinalized: baselines.filter(
        (result) => result.released && result.outcome.boundToFinal,
      ).length,
    },
    {
      id: "intervention",
      label: "Finality-gated settlement",
      description:
        "The deployed pair: a decision contract that refuses to promote inside the appeal window, and a vault that re-derives that same window from the gate's own record and requires the commitment to match exactly.",
      settlementsFromProvisional: interventions.filter(
        (result) => result.released && result.outcome.appealableAtRequest,
      ).length,
      duplicateSettlements: interventions.filter((result) => result.secondDeliveryReleased)
        .length,
      commitmentMismatchesAccepted: interventions.filter(
        (result) => result.released && !result.outcome.matchedCommitment,
      ).length,
      settledBoundToFinalized: interventions.filter(
        (result) => result.released && result.outcome.boundToFinal,
      ).length,
    },
  ];

  const refusalsSettled = refusalIds.filter((entry) => entry.baseline.released).length;
  const acceptancesReleased = entries.filter(
    (entry) => entry.expectedCode === null && entry.intervention.released,
  ).length;
  const acceptances = entries.filter((entry) => entry.expectedCode === null).length;

  const control = {
    description:
      "Negative control on the corpus: the release cases must actually be released by the intervention. A guard that refuses everything would otherwise score identically on the refusal cases.",
    outcome: (acceptancesReleased === acceptances ? "PASS" : "FAIL") as "PASS" | "FAIL",
    detail: `${acceptancesReleased} of ${acceptances} release cases were released by the intervention; the baseline released ${refusalsSettled} of ${refusalIds.length} refusal cases.`,
  };

  return { entries, metrics, arms, control };
}
