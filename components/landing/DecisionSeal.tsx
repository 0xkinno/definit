"use client";

import { motion, useReducedMotion } from "framer-motion";

import { classNames } from "@/lib/format";

export type SealState = "accepted" | "finalized";

/**
 * The decision seal.
 *
 * A physical precision instrument, built from CSS geometry rather than a
 * bitmap so that it stays crisp at every viewport and carries no licensing
 * burden. It has exactly two meaningful positions:
 *
 *   accepted   the gate is open. The bar is offset. The instrument is holding.
 *   finalized  the gate is seated. The bar is aligned. The instrument is sealed.
 *
 * The animation is the argument: nothing moves until the boundary is crossed.
 *
 * The root clips its own overflow on purpose. The instrument is a square element
 * rotated in Z, and a rotated square reports a bounding box roughly 21% wider
 * than itself even though everything it paints -- a disc, a bar, a seated gate --
 * stays inside that box. Without the clip the decoration alone produced a
 * horizontal scrollbar on a phone.
 */
export function DecisionSeal({
  state,
  className,
  size = 420,
}: {
  state: SealState;
  className?: string;
  size?: number;
}) {
  const reduce = useReducedMotion();
  const sealed = state === "finalized";

  const spring = reduce
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 90, damping: 18, mass: 0.9 };

  return (
    <div
      className={classNames("relative select-none overflow-hidden", className)}
      style={{ width: size, height: size, maxWidth: "100%" }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0"
        style={{ perspective: "1400px", transformStyle: "preserve-3d" }}
      >
        <motion.div
          className="absolute inset-0"
          style={{ transformStyle: "preserve-3d" }}
          animate={{ rotateX: 58, rotateZ: sealed ? -6 : -14 }}
          transition={spring}
        >
          {/* base plinth shadow */}
          <div
            className="absolute left-[8%] top-[8%] h-[84%] w-[84%] rounded-full"
            style={{
              background:
                "radial-gradient(circle at 40% 30%, rgba(19,21,24,0.18), rgba(19,21,24,0) 62%)",
              filter: "blur(14px)",
              transform: "translateZ(-60px)",
            }}
          />

          {/* outer brushed ring */}
          <div
            className="absolute inset-[2%] rounded-full"
            style={{
              background:
                "conic-gradient(from 210deg, #cfc6b6 0deg, #efe9dd 42deg, #b9ae9c 96deg, #f6f2ea 156deg, #c2b8a7 214deg, #ece5d8 272deg, #ab9f8c 322deg, #cfc6b6 360deg)",
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -2px 6px rgba(19,21,24,0.22), 0 26px 50px -26px rgba(19,21,24,0.55)",
            }}
          />
          <div
            className="absolute inset-[6%] rounded-full"
            style={{
              background:
                "radial-gradient(circle at 34% 24%, #fffdf8 0%, #f2ece0 38%, #ded5c4 74%, #c8bdaa 100%)",
              boxShadow: "inset 0 2px 6px rgba(255,255,255,0.7), inset 0 -8px 18px rgba(19,21,24,0.12)",
            }}
          />

          {/* machined concentric grooves */}
          {[12, 18, 24, 30, 36].map((inset, index) => (
            <div
              key={inset}
              className="absolute rounded-full"
              style={{
                inset: `${inset}%`,
                border: `1px solid rgba(19,21,24,${index % 2 === 0 ? 0.07 : 0.11})`,
              }}
            />
          ))}

          {/* index ticks */}
          <div className="absolute inset-[10%]">
            {Array.from({ length: 48 }).map((_, index) => (
              <span
                key={index}
                className="absolute left-1/2 top-0 block origin-bottom"
                style={{
                  height: index % 4 === 0 ? "6.5%" : "3.2%",
                  width: index % 4 === 0 ? 2 : 1,
                  background: "rgba(19,21,24,0.22)",
                  transform: `translateX(-50%) rotate(${index * 7.5}deg)`,
                  transformOrigin: "50% 480%",
                }}
              />
            ))}
          </div>

          {/* the brass core */}
          <div
            className="absolute inset-[32%] rounded-full"
            style={{
              background: sealed
                ? "radial-gradient(circle at 36% 28%, #E6F3EE 0%, #7FBBA6 34%, #1B6A53 78%, #14513F 100%)"
                : "radial-gradient(circle at 36% 28%, #F6E9CF 0%, #E0C48C 32%, #B07E28 76%, #7A5518 100%)",
              boxShadow:
                "inset 0 1px 2px rgba(255,255,255,0.65), inset 0 -10px 22px rgba(19,21,24,0.30), 0 10px 24px -12px rgba(19,21,24,0.5)",
              transition: "background 420ms ease",
            }}
          />

          {/* the gate: two arms that seat when the decision becomes final */}
          <div className="absolute inset-[16%]" style={{ transformStyle: "preserve-3d" }}>
            <motion.span
              className="absolute left-1/2 top-0 block h-[50%] w-[7px] -translate-x-1/2 rounded-full"
              style={{
                background: "linear-gradient(180deg, #3A3F46, #191C20)",
                boxShadow: "0 2px 6px rgba(19,21,24,0.35)",
                transformOrigin: "50% 100%",
              }}
              animate={{ rotate: sealed ? 0 : -15 }}
              transition={spring}
            />
            <motion.span
              className="absolute bottom-0 left-1/2 block h-[50%] w-[7px] -translate-x-1/2 rounded-full"
              style={{
                background: "linear-gradient(0deg, #3A3F46, #191C20)",
                boxShadow: "0 -2px 6px rgba(19,21,24,0.35)",
                transformOrigin: "50% 0%",
              }}
              animate={{ rotate: sealed ? 0 : 15 }}
              transition={spring}
            />
          </div>

          {/* the keeper bar: the visible boundary */}
          <motion.div
            className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              height: 10,
              background: sealed
                ? "linear-gradient(90deg, #14513F, #22836A, #14513F)"
                : "linear-gradient(90deg, #7A5518, #C79A4A, #7A5518)",
              boxShadow: "0 3px 10px -4px rgba(19,21,24,0.6)",
            }}
            animate={{ width: sealed ? "56%" : "30%", opacity: 1 }}
            transition={spring}
          />
        </motion.div>
      </div>

      {/* status glow under the instrument */}
      <motion.div
        className="pointer-events-none absolute bottom-[6%] left-1/2 h-[14%] w-[62%] -translate-x-1/2 rounded-[50%]"
        style={{
          background: sealed
            ? "radial-gradient(ellipse at center, rgba(34,131,106,0.34), rgba(34,131,106,0) 70%)"
            : "radial-gradient(ellipse at center, rgba(176,126,40,0.30), rgba(176,126,40,0) 70%)",
          filter: "blur(12px)",
        }}
        animate={{ opacity: sealed ? 1 : 0.85 }}
        transition={spring}
      />
    </div>
  );
}
