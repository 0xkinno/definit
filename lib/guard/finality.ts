/**
 * The intervention: release only against a decision that has cleared its appeal window.
 *
 * Every guard below is independent, and each one is driven by a named case in
 * the corpus. Removing any single guard is a real loss of security rather than
 * a simplification, which is why they are not merged.
 *
 * This mirrors `contracts/finality_vault.py` method for method. The contract is
 * the thing that runs; this exists so the logic can be attacked offline, in a
 * loop, without a network.
 */

import type { Outcome, RefusalCode, Settlement, World } from "./types.ts";

function termsMatch(escrow: {
  intent_hash: string;
  policy_hash: string;
  evidence_digest: string;
  nonce: number;
  recipient: string;
  amount: number;
}, claim: Settlement): boolean {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return (
    same(claim.intent_hash, escrow.intent_hash) &&
    same(claim.policy_hash, escrow.policy_hash) &&
    same(claim.evidence_digest, escrow.evidence_digest) &&
    claim.nonce === escrow.nonce &&
    same(claim.recipient, escrow.recipient) &&
    claim.amount === escrow.amount
  );
}

export function guardedSettle(
  world: World,
  caller: string,
  claim: Settlement,
): Outcome {
  const base: Outcome = {
    released: false,
    code: null,
    readScope: null,
    appealableAtRequest: false,
    matchedCommitment: false,
    boundToFinal: false,
  };

  const refuse = (code: RefusalCode, extra: Partial<Outcome> = {}): Outcome => ({
    ...base,
    code,
    ...extra,
  });

  const escrow = world.escrow(claim.action_id);
  if (!escrow) return refuse("ESCROW_UNKNOWN");

  // Guard 1 -- only the bound decision contract may instruct a release.
  if (caller !== world.gate) return refuse("UNAUTHORIZED_CALLER");

  // Guard 2 -- an escrow settles at most once, ever.
  if (escrow.state === "SETTLED") return refuse("ALREADY_SETTLED");

  // Guard 3 -- an expired authorization cannot be spent late.
  if (world.now > escrow.deadline_unix) return refuse("EXPIRED");

  // Guard 4 -- the caller must restate the recorded commitment exactly.
  const matched = termsMatch(escrow, claim);
  if (!matched) return refuse("COMMITMENT_MISMATCH", { matchedCommitment: false });

  // Guard 5 -- the settlement nonce is single-use.
  const nonceKey = `${claim.action_id}:${escrow.nonce}`;
  if (world.usedNonces.has(nonceKey)) return refuse("REPLAY_BLOCKED", { matchedCommitment: true });

  // Guard 6 -- the decision must be readable as a promoted capability. This is
  // the guard the whole product exists for.
  //
  // The deployed pair splits this across two contracts: the gate refuses to
  // promote a decision until its appeal window has closed, and the vault
  // re-derives the same window from the gate's adjudication stamp before
  // releasing. `world.final` is the composed result of both, so this mirror
  // and the contracts agree about *which* decisions are actionable even
  // though only the contracts are what actually run.
  const capability = world.final(claim.decision_id);
  const appealable = world.provisional(claim.decision_id) !== null && capability === null;
  if (!capability) {
    return refuse("DECISION_NOT_FINAL", {
      readScope: "final",
      appealableAtRequest: appealable,
      matchedCommitment: true,
    });
  }

  // Guard 7 -- the final decision must approve.
  if (capability.verdict !== "APPROVE") {
    return refuse("VERDICT_NOT_APPROVE", {
      readScope: "final",
      matchedCommitment: true,
    });
  }

  // Guard 8 -- the final decision must name this action and this commitment.
  if (capability.action_id !== claim.action_id) {
    return refuse("COMMITMENT_MISMATCH", { readScope: "final", matchedCommitment: true });
  }
  if (!termsMatch(capability, claim)) {
    return refuse("COMMITMENT_MISMATCH", { readScope: "final", matchedCommitment: true });
  }

  escrow.state = "SETTLED";
  world.usedNonces.add(nonceKey);
  return {
    released: true,
    code: null,
    readScope: "final",
    appealableAtRequest: appealable,
    matchedCommitment: true,
    boundToFinal: true,
  };
}
