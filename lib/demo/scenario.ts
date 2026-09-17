/**
 * The single demo scenario.
 *
 * One scenario, deliberately. The product is one journey, not a catalogue.
 * Every value here is synthetic test data.
 */

import { APP_URL, RUNTIME_MODE } from "@/lib/config";

export interface DemoScenario {
  id: string;
  title: string;
  plainLanguage: string;
  supplier: string;
  buyer: string;
  purchaseOrder: string;
  milestone: string;
  amount: number;
  asset: string;
  /** The demo beneficiary. Synthetic, and the same address the live run pays. */
  recipient: string;
  policyId: string;
  policyVersion: string;
  policyTitle: string;
  policyText: string;
  evidenceUrl: string;
  evidenceLabel: string;
  /** Relative path of the evidence snapshot shipped with the app. */
  evidenceLocalPath: string;
  /** Relative path of the snapshot the policy is required to refuse. */
  contradictingEvidenceLocalPath: string;
  deadlineHours: number;
}

/**
 * The milestone amount, in wei.
 *
 * This is the figure the contracts carry. `open_escrow` must attach exactly
 * this many wei, so the value lives in one place rather than a display number
 * that can quietly disagree with what was committed to.
 */
export const MILESTONE_AMOUNT_WEI = 10_000_000_000_000_000n;

/** The same figure in GEN, for display. Derived, so it cannot drift. */
export const MILESTONE_AMOUNT_GEN = Number(MILESTONE_AMOUNT_WEI) / 1e18;

/** Nobody should ever type a wei figure into a form. This does the conversion. */
export function genToWei(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 1e18);
}

export const DEMO_POLICY_ID = "delivery-milestone-v3";

export const SCENARIO: DemoScenario = {
  id: "supplier-milestone-742",
  title: "Supplier milestone payment",
  plainLanguage:
    "Pay Supplier Atlas 0.01 GEN once delivery of purchase order #742 is genuinely confirmed.",
  supplier: "Supplier Atlas",
  buyer: "Meridian Instruments",
  purchaseOrder: "#742",
  milestone: "DELIVERY CONFIRMED",
  /** Display figure in GEN. The committed value is MILESTONE_AMOUNT_WEI. */
  amount: MILESTONE_AMOUNT_GEN,
  asset: "GEN",
  recipient: "0x1111111111111111111111111111111111111111",
  policyId: DEMO_POLICY_ID,
  policyVersion: "3.0.0",
  policyTitle: "Milestone payment -- delivery confirmed",
  policyText: `POLICY: MILESTONE PAYMENT -- DELIVERY CONFIRMED
Policy id:      delivery-milestone-v3
Version:        3.0.0

Scope
-----
This policy governs milestone payments to a supplier for a physical delivery.
It is evaluated against a delivery confirmation record published by the buyer
or the carrier.

Requirements
------------
R1. The evidence must name the purchase order that the payment refers to.
R2. The evidence must state an explicit delivery milestone outcome.
R3. The evidence must show that every line item on the order was received.
R4. The evidence must state that no dispute, shortage or damage claim is open.
R5. The milestone date must not be in the future relative to the record.

Prohibitions
------------
P1. A partial delivery does not satisfy this policy.
P2. An open dispute or return request does not satisfy this policy.
P3. A delivery marked damaged does not satisfy this policy.
P4. Evidence that does not name the purchase order does not satisfy this policy.

Interpretation
--------------
If the record states that the goods were received in full, with matching
quantities, no damage, no dispute and no return, the milestone is satisfied.
If any required fact is absent, the milestone is not satisfied: absence of
evidence is never treated as evidence of delivery.

This policy text is content-addressed. Its hash is what the decision commits to,
so it cannot be revised after a decision has been made against it.`,
  evidenceUrl: `${APP_URL.replace(/\/$/, "")}/demo/delivery-742.txt`,
  evidenceLabel: "Delivery confirmation record, consignment NW-742-DEL",
  evidenceLocalPath: "/demo/delivery-742.txt",
  contradictingEvidenceLocalPath: "/demo/delivery-742-partial.txt",
  deadlineHours: 72,
};

/**
 * A second, deliberately unsatisfying evidence snapshot.
 *
 * The proof campaign needs an evidence set that must be *refused*, otherwise
 * "it approved" proves nothing about whether the adjudicator is judging.
 */
export const CONTRADICTING_EVIDENCE = `DELIVERY CONFIRMATION RECORD
============================

Carrier:            Northwind Freight
Consignment:        NW-742-DEL
Purchase order:     #742
Supplier:           Supplier Atlas
Buyer:              Meridian Instruments
Milestone:          PARTIAL DELIVERY
Delivered on:       2026-09-14
Signed for by:      R. Okonkwo, Receiving
Condition:          pallet 4 crushed on arrival
Line items:         3 of 4 received
Quantity check:     short by one pallet
Damage report:      pallet 4 crushed on arrival
Temperature log:    within specified range for the whole transit
Return request:     open for pallet 4
Dispute raised:     YES -- buyer dispute 2026-09-14-02

Notes
-----
One pallet was damaged in transit and the buyer has raised a dispute.`;

/**
 * The satisfying snapshot, held here so the offline rehearsal hashes exactly
 * what the live path fetches. The shipped copy at
 * `public/demo/delivery-742.txt` is the one the contract actually reads; the
 * two are compared by `npm run docs:check` so they cannot drift apart.
 */
export const SATISFYING_EVIDENCE = `DELIVERY CONFIRMATION RECORD
============================

Carrier:            Northwind Freight
Consignment:        NW-742-DEL
Purchase order:     #742
Supplier:           Supplier Atlas
Buyer:              Meridian Instruments
Milestone:          DELIVERY CONFIRMED
Delivered on:       2026-09-14
Signed for by:      R. Okonkwo, Receiving
Condition:          intact, no exceptions noted
Line items:         4 of 4 received in full
Quantity check:     matched against purchase order exactly
Damage report:      none
Temperature log:    within specified range for the whole transit
Return request:     none
Dispute raised:     none

Notes
-----
All four pallets were received on the dock at 09:42 local time and checked
against the purchase order line by line. The seal numbers on every pallet
matched those recorded at dispatch. No shortages and no overages were found.

This record is the evidence snapshot referenced by purchase order #742.
It is static: the content does not change after the milestone is recorded.`;

export function scenarioEvidencePath(): string {
  return RUNTIME_MODE === "live" ? SCENARIO.evidenceUrl : SCENARIO.evidenceLocalPath;
}

export function deadlineUnixFromNow(hours = SCENARIO.deadlineHours, from = Date.now()): number {
  return Math.floor(from / 1000) + hours * 3600;
}
