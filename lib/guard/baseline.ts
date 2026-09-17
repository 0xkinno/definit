/**
 * The baseline: the same settlement contract with one property removed.
 *
 * It consults the decision at *provisional* storage scope, which is what an
 * integration does when it treats "the network accepted the judgement" as
 * "the judgement is safe to act on".
 *
 * Nothing else is weakened. It commits to the same payload, enforces the same
 * deadline, binds to the same decision contract, and moves the same value.
 * That is deliberate: a difference in outcome can then only be caused by the
 * one thing that differs.
 */

import type { Outcome, Settlement, World } from "./types.ts";

export function unsafeRelease(
  world: World,
  caller: string,
  claim: Settlement,
): Outcome {
  const escrow = world.escrow(claim.action_id);
  const base: Outcome = {
    released: false,
    code: null,
    readScope: null,
    appealableAtRequest: false,
    matchedCommitment: false,
    boundToFinal: false,
  };

  if (!escrow) return { ...base, code: "ESCROW_UNKNOWN" };
  if (caller !== world.gate) return { ...base, code: "UNAUTHORIZED_CALLER" };
  if (escrow.state === "SETTLED") return { ...base, code: "ALREADY_SETTLED" };
  if (world.now > escrow.deadline_unix) return { ...base, code: "EXPIRED" };

  // The defect: the provisional scope is consulted, and it is enough.
  const capability = world.provisional(claim.decision_id);
  const appealable = capability !== null && world.final(claim.decision_id) === null;

  if (!capability) {
    return { ...base, code: "DECISION_NOT_FINAL", readScope: "provisional", appealableAtRequest: appealable };
  }
  if (capability.verdict !== "APPROVE") {
    return { ...base, code: "VERDICT_NOT_APPROVE", readScope: "provisional", appealableAtRequest: appealable };
  }

  escrow.state = "SETTLED";
  return {
    released: true,
    code: null,
    readScope: "provisional",
    appealableAtRequest: appealable,
    matchedCommitment: false,
    boundToFinal: false,
  };
}
