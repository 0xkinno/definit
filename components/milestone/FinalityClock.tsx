import { gen, type RunRecord } from "@/lib/milestone/data";

/**
 * A payment's timeline, drawn from the chain's own timestamps.
 *
 * Proposed, Accepted, the appeal window, Finalized, the delivery the protocol
 * created, the receipt. Positions are proportional to chain time, so the gap
 * between Accepted and Finalized is the real window, and the delivery sits at its
 * real distance from it. Every node links to the explorer where a transaction
 * exists.
 */
export function FinalityClock({ run }: { run: RunRecord }) {
  const t0 = run.submittedAtS;
  const events = [
    { key: "proposed", label: "Proposed", at: t0, note: "adjudication submitted", href: run.links.adjudication },
    { key: "accepted", label: "Accepted", at: run.acceptedAtS, note: "a draft; appealable", href: run.links.adjudication },
    { key: "final", label: "Finalized", at: run.finalAppealDeadlineS, note: "appeal window passed", href: run.links.adjudication },
    { key: "delivered", label: run.deliveryMethod === "authorize_release" ? "Release delivered" : "Refusal delivered", at: run.deliveryCreatedS, note: run.deliveryMethod, href: run.links.delivery },
  ];
  const end = Math.max(...events.map((e) => e.at));
  const span = Math.max(1, end - t0);
  const pct = (s: number) => `${(((s - t0) / span) * 100).toFixed(2)}%`;

  return (
    <figure aria-label={`Finality clock for run ${run.id}`} className="w-full">
      <div className="relative mx-2 mt-10 mb-16 h-10 sm:mx-6" role="img" aria-label="Timeline from proposal to delivery">
        <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 bg-paper-300" />
        <div
          className="absolute top-1/2 h-[10px] -translate-y-1/2 rounded-sm bg-signal-ambersoft border border-signal-amber/40"
          style={{ left: pct(run.acceptedAtS), width: `calc(${pct(run.finalAppealDeadlineS)} - ${pct(run.acceptedAtS)})` }}
          title="the appeal window"
        />
        {events.map((e, i) => (
          <a
            key={e.key}
            href={e.href}
            target="_blank"
            rel="noreferrer"
            className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ left: pct(e.at) }}
            aria-label={`${e.label} at ${gen(e.at)}`}
          >
            <span className={`block h-4 w-4 rounded-full border-2 border-ink-900 ${e.key === "delivered" ? "bg-ink-900" : "bg-paper-50"}`} />
            <span
              className={`absolute left-1/2 hidden -translate-x-1/2 whitespace-nowrap text-[11px] font-medium text-ink-800 sm:block ${i % 2 === 0 ? "top-6" : "-top-7"}`}
            >
              {e.label}
            </span>
          </a>
        ))}
      </div>
      <ol className="grid gap-2 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
        {events.map((e) => (
          <li key={e.key} className="rounded-md border border-paper-300 bg-paper-50 px-3 py-2">
            <span className="label block">{e.label}</span>
            <span className="hash block">{gen(e.at)}</span>
            <span className="block text-[12px] text-ink-500">
              {e.key === "proposed" ? "t + 0 s" : `t + ${e.at - t0} s`} &middot; {e.note}
            </span>
          </li>
        ))}
      </ol>
      <figcaption className="mt-3 text-[12px] text-ink-500">
        Window between Accepted and Finalized: {run.finalAppealDeadlineS - run.acceptedAtS} s. Delivery created {run.deliveryCreatedS - run.finalAppealDeadlineS} s after Finalized.
        {run.appeal ? " An appeal was submitted inside the window and the run was recorded to its end." : ""}
      </figcaption>
    </figure>
  );
}
