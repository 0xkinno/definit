import { readFileSync } from "node:fs";
import path from "node:path";

import { Shell } from "@/components/Shell";
import { Notice, Panel, SectionHeading } from "@/components/ui/primitives";
import { runCorpus, type CorpusInput, type CorpusReport } from "@/lib/guard/corpus";
import {
  caseCountsFrom,
  countsAgree,
  describeCounts,
  describeScore,
  observedCounts,
} from "@/lib/guard/counts";

export const dynamic = "force-dynamic";

export const metadata = { title: "Proof lab -- DEFINIT" };

/**
 * Run the corpus in the server process and show every case.
 *
 * The lab deliberately does not call the network. It executes the same rule set
 * the contract is written from, twice per case: once without the finality
 * requirement and once with it. That is what makes the refusals attributable --
 * a case that the intervention blocks and the baseline releases has a cause, and
 * the cause is the single property that differs between the two.
 */
function loadCases(): { inputs: CorpusInput[]; about: string } {
  const file = path.join(process.cwd(), "tests", "fixtures", "cases.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as { about: string; cases: CorpusInput[] };
  return { inputs: raw.cases, about: raw.about };
}

export default function LabPage() {
  let report: CorpusReport | null = null;
  let about = "";
  let failure: string | null = null;
  let declared = null as ReturnType<typeof caseCountsFrom> | null;
  let observed = null as ReturnType<typeof caseCountsFrom> | null;

  try {
    const { inputs, about: summary } = loadCases();
    about = summary;
    report = runCorpus(inputs);
    declared = caseCountsFrom(inputs);
    observed = observedCounts(report.entries, (entry) => entry.intervention.released);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <SectionHeading
          level={1}
          eyebrow="Proof lab"
          title="Attack the invariant, and watch it hold"
          lead="Every case is replayed against two implementations of the same settlement decision: one that consults the decision without requiring finality, and one that requires it and compares the commitment exactly. The refusals are only meaningful because the releases are here too."
        />

        {about ? <p className="mt-4 max-w-prose text-[13px] leading-relaxed text-ink-600">{about}</p> : null}

        {report && declared && observed ? (
          <p className="mt-3 text-[13px] font-medium text-ink-800" data-case-counts={declared.total}>
            {describeCounts(declared)} &middot;{" "}
            {describeScore(report.metrics.passing, report.metrics.totalCases)}
            {countsAgree(declared, observed) ? null : (
              <span className="ml-2 text-signal-rust">
                the run observed {describeCounts(observed)}
              </span>
            )}
          </p>
        ) : null}

        {failure ? (
          <div className="mt-6">
            <Notice tone="danger" title="The corpus could not be loaded">
              <p>{failure}</p>
            </Notice>
          </div>
        ) : null}

        {report ? (
          <>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Provisional settlements blocked", value: report.metrics.provisionalSettlementsBlocked },
                { label: "Commitment mismatches blocked", value: report.metrics.commitmentMismatchesBlocked },
                { label: "Replay attempts blocked", value: report.metrics.replayAttemptsBlocked },
                { label: "Finalized settlements verified", value: report.metrics.finalizedSettlementsVerified },
              ].map((metric) => (
                <Panel key={metric.label} className="!p-5">
                  <p className="font-display text-[30px] font-semibold leading-none">{metric.value}</p>
                  <p className="mt-2 text-[12px] uppercase tracking-[0.12em] text-ink-500">{metric.label}</p>
                </Panel>
              ))}
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              {report.arms.map((arm) => (
                <Panel key={arm.id}>
                  <p className="eyebrow">{arm.id === "baseline" ? "Baseline" : "Intervention"}</p>
                  <p className="mt-2 text-[14px] font-semibold text-ink-900">{arm.label}</p>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{arm.description}</p>
                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <dt className="label">Settled from provisional</dt>
                      <dd className="mt-1 text-[15px] font-semibold">{arm.settlementsFromProvisional}</dd>
                    </div>
                    <div>
                      <dt className="label">Duplicates</dt>
                      <dd className="mt-1 text-[15px] font-semibold">{arm.duplicateSettlements}</dd>
                    </div>
                    <div>
                      <dt className="label">Mismatches accepted</dt>
                      <dd className="mt-1 text-[15px] font-semibold">{arm.commitmentMismatchesAccepted}</dd>
                    </div>
                    <div>
                      <dt className="label">Bound to finalized</dt>
                      <dd className="mt-1 text-[15px] font-semibold">{arm.settledBoundToFinalized}</dd>
                    </div>
                  </dl>
                </Panel>
              ))}
            </div>

            <Notice tone={report.control.outcome === "PASS" ? "final" : "danger"} title={`Control: ${report.control.outcome}`}>
              <p>{report.control.description}</p>
              <p className="mt-1 hash text-[12px]">{report.control.detail}</p>
            </Notice>

            <div className="mt-8 space-y-3">
              {report.entries.map((entry) => (
                <Panel key={entry.id} className="!p-4 sm:!p-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <h3 className="text-[14.5px] font-semibold text-ink-900">{entry.title}</h3>
                    <span
                      className={
                        entry.outcome === "PASS"
                          ? "chip border-viridian-300 text-viridian-700"
                          : "chip border-signal-rust text-signal-rust"
                      }
                    >
                      {entry.outcome}
                    </span>
                  </div>
                  <p className="mt-1 hash text-[11px] text-ink-500">
                    {entry.id} &middot; {entry.invariant}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <p className="text-[12.5px] text-ink-600">
                      <span className="label mr-2">Expected</span>
                      {entry.expected}
                    </p>
                    <p className="text-[12.5px] text-ink-600">
                      <span className="label mr-2">Observed</span>
                      {entry.actual}
                    </p>
                  </div>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{entry.detail}</p>
                </Panel>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Shell>
  );
}
