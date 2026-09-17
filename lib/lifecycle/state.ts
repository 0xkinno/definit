/**
 * Product lifecycle vocabulary.
 *
 * The whole application speaks these nine words. Raw network status strings are
 * mapped into them in exactly one place (`lib/lifecycle/map.ts`), so no visual
 * component ever interprets a status by itself.
 */

export type DefinitLifecycle =
  | "draft"
  | "submitted"
  | "proposing"
  | "accepted"
  | "appealed"
  | "finalized"
  | "settled"
  | "rejected"
  | "held";

export const LIFECYCLE_ORDER: DefinitLifecycle[] = [
  "draft",
  "submitted",
  "proposing",
  "accepted",
  "finalized",
  "settled",
];

export interface LifecycleDescriptor {
  id: DefinitLifecycle;
  label: string;
  /** One sentence a treasury manager can act on. */
  meaning: string;
  /** Whether funds may move in this state. */
  effectPermitted: boolean;
  /** Whether this state is still open to being overturned. */
  appealable: boolean;
  tone: "neutral" | "progress" | "provisional" | "final" | "failure" | "frozen";
}

export const LIFECYCLE: Record<DefinitLifecycle, LifecycleDescriptor> = {
  draft: {
    id: "draft",
    label: "Draft",
    meaning: "The action has been composed but nothing has been submitted.",
    effectPermitted: false,
    appealable: true,
    tone: "neutral",
  },
  submitted: {
    id: "submitted",
    label: "Submitted",
    meaning: "The action exists on chain and is waiting to be judged.",
    effectPermitted: false,
    appealable: true,
    tone: "neutral",
  },
  proposing: {
    id: "proposing",
    label: "Adjudicating",
    meaning: "Validators are deciding whether the evidence satisfies the policy.",
    effectPermitted: false,
    appealable: true,
    tone: "progress",
  },
  accepted: {
    id: "accepted",
    label: "Accepted -- not final",
    meaning:
      "A judgment exists, but it is still appealable. No money may move.",
    effectPermitted: false,
    appealable: true,
    tone: "provisional",
  },
  appealed: {
    id: "appealed",
    label: "Under appeal",
    meaning: "The accepted judgment has been challenged and may change.",
    effectPermitted: false,
    appealable: true,
    tone: "provisional",
  },
  finalized: {
    id: "finalized",
    label: "Finalized -- execution unlocked",
    meaning:
      "The appeal window has closed. The commitment may now authorise a release.",
    effectPermitted: true,
    appealable: false,
    tone: "final",
  },
  settled: {
    id: "settled",
    label: "Settled",
    meaning: "Value moved to the beneficiary against a finalized commitment.",
    effectPermitted: false,
    appealable: false,
    tone: "final",
  },
  rejected: {
    id: "rejected",
    label: "Rejected",
    meaning: "The evidence did not satisfy the policy. Nothing was released.",
    effectPermitted: false,
    appealable: false,
    tone: "failure",
  },
  held: {
    id: "held",
    label: "Held",
    meaning:
      "A required lifecycle or binding condition was not satisfied, so the action is frozen rather than released.",
    effectPermitted: false,
    appealable: false,
    tone: "frozen",
  },
};

export function lifecycleOf(id: DefinitLifecycle): LifecycleDescriptor {
  return LIFECYCLE[id];
}
