"use client";

import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

import { DecisionSeal, type SealState } from "@/components/landing/DecisionSeal";
import { classNames } from "@/lib/format";

const ROWS = [
  {
    id: "accepted" as SealState,
    left: "ACCEPTED",
    middle: "still appealable",
    right: "no settlement",
  },
  {
    id: "finalized" as SealState,
    left: "FINALIZED",
    middle: "appeal window closed",
    right: "settlement unlocked",
  },
];

/**
 * The hero instrument.
 *
 * It performs the product argument once every few seconds: the boundary is
 * crossed, and only then does the right-hand column change. With reduced motion
 * requested it holds the provisional state and nothing animates.
 */
export function HeroVisual() {
  const reduce = useReducedMotion();
  const [state, setState] = useState<SealState>("accepted");

  useEffect(() => {
    if (reduce) return;
    const timer = window.setInterval(() => {
      setState((current) => (current === "accepted" ? "finalized" : "accepted"));
    }, 4800);
    return () => window.clearInterval(timer);
  }, [reduce]);

  return (
    <div className="flex flex-col items-center gap-6">
      <DecisionSeal state={state} size={360} />

      <div className="w-full max-w-[420px] overflow-hidden rounded-lg border border-paper-300 bg-paper-0">
        {ROWS.map((row, index) => {
          const active = row.id === state;
          return (
            <div
              key={row.id}
              className={classNames(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 transition-colors duration-300",
                index === 0 ? "border-b border-paper-200" : "",
                active ? "bg-paper-100" : "bg-transparent",
              )}
            >
              <div className="min-w-0">
                <p
                  className={classNames(
                    "text-[11px] font-semibold uppercase tracking-[0.16em]",
                    active
                      ? row.id === "finalized"
                        ? "text-viridian-700"
                        : "text-signal-amber"
                      : "text-ink-400",
                  )}
                >
                  {row.left}
                </p>
                <p className="mt-1 text-[12px] text-ink-500">{row.middle}</p>
              </div>
              <p
                className={classNames(
                  "text-right text-[11px] font-semibold uppercase tracking-[0.12em]",
                  active ? "text-ink-800" : "text-ink-300",
                )}
              >
                {row.right}
              </p>
            </div>
          );
        })}
        <div className="border-t border-paper-200 px-4 py-2">
          <p className="text-[11px] text-ink-500">
            The only difference between these two rows is whether the boundary has been crossed.
          </p>
        </div>
      </div>

      <motion.p
        className="text-center text-[11px] uppercase tracking-[0.16em] text-ink-400"
        animate={{ opacity: reduce ? 1 : [0.45, 1, 0.45] }}
        transition={{ duration: 6, repeat: reduce ? 0 : Infinity }}
      >
        One boundary. Two different products.
      </motion.p>
    </div>
  );
}
