"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

import { DecisionSeal, type SealState } from "@/components/landing/DecisionSeal";
import { classNames } from "@/lib/format";

const COPY: Record<SealState, { heading: string; body: string; bullets: string[] }> = {
  accepted: {
    heading: "Accepted",
    body: "Consensus currently agrees. The outcome can still be appealed, and an appeal can change it. Anything you do now has already happened by the time the answer changes.",
    bullets: [
      "the judgment is visible to anyone reading current state",
      "the judgment is invisible to anyone reading final state",
      "no value may leave the vault",
    ],
  },
  finalized: {
    heading: "Finalized",
    body: "The appeal window has closed. The decision is now a capability: it can authorise exactly one effect, for exactly one commitment.",
    bullets: [
      "the judgment is visible to a final-scope read",
      "the settlement instruction it emits was deferred until this moment",
      "the vault re-checks the commitment before releasing",
    ],
  },
};

export function BoundaryToggle() {
  const [state, setState] = useState<SealState>("accepted");
  const reduce = useReducedMotion();
  const copy = COPY[state];

  return (
    <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div>
        <div
          role="group"
          aria-label="Boundary state"
          className="inline-flex rounded-md border border-paper-300 bg-paper-0 p-1"
        >
          {(["accepted", "finalized"] as SealState[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setState(id)}
              aria-pressed={state === id}
              className={classNames(
                "min-h-[44px] rounded px-4 text-[13px] font-semibold capitalize transition-colors",
                state === id
                  ? id === "finalized"
                    ? "bg-viridian-600 text-paper-0"
                    : "bg-signal-amber text-paper-0"
                  : "text-ink-600 hover:bg-paper-100",
              )}
            >
              {id}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={state}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.22 }}
            className="mt-5"
          >
            <h3 className="text-xl font-semibold">{copy.heading}</h3>
            <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-600 text-pretty">
              {copy.body}
            </p>
            <ul className="mt-4 space-y-2">
              {copy.bullets.map((bullet) => (
                <li key={bullet} className="flex gap-3 text-[13px] leading-relaxed text-ink-700">
                  <span
                    aria-hidden="true"
                    className={classNames(
                      "mt-[6px] block h-[6px] w-[6px] shrink-0 rounded-full",
                      state === "finalized" ? "bg-viridian-600" : "bg-signal-amber",
                    )}
                  />
                  {bullet}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex justify-center lg:justify-end">
        <DecisionSeal state={state} size={380} />
      </div>
    </div>
  );
}
