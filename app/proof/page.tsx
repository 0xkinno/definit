import Link from "next/link";

import { Shell } from "@/components/Shell";
import { Notice, Panel, SectionHeading } from "@/components/ui/primitives";
import { NOT_MEASURED_COPY, loadProofReport } from "@/lib/evidence";
import {
  describeCounts,
  describeScore,
  observedCounts,
  reportRowReleased,
  type CaseCounts,
} from "@/lib/guard/counts";

export const dynamic = "force-dynamic";

export const metadata = { title: "Evidence -- DEFINIT" };

/**
 * The evidence page renders a generated report.
 *
 * It does not compute anything and it does not carry a fallback figure. If the
 * report is absent the page says so, because the one thing a page like this must
 * never do is produce a number nobody measured.
 */
/**
 * Counts come from the generated report. If a report predates the `caseCounts`
 * field, they are recounted from its own case rows rather than typed in, so the
 * page still cannot disagree with what it is showing.
 */
function countsOf(report: { caseCounts?: CaseCounts; cases: Array<{ actual: string; expected: string }> }): CaseCounts {
  return (
    report.caseCounts ??
    observedCounts(report.cases, reportRowReleased)
  );
}

export default async function ProofPage() {
  const { report, available } = await loadProofReport();

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <SectionHeading
          level={1}
          eyebrow="Evidence"
          title="Headline numbers, generated rather than typed"
          lead="Every figure below was produced by `npm run proof` and written to a machine-readable report. If that report is missing from this checkout, this page shows nothing at all rather than a comforting number."
        />

        {available && report ? (
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

            <p className="mt-4 text-[13px] font-medium text-ink-800">
              {describeCounts(countsOf(report))} &middot;{" "}
              {describeScore(report.metrics.passing, report.metrics.totalCases)}
            </p>
            <p className="mt-1 text-[12px] text-ink-500">
              Counted from the case definitions in <span className="hash">tests/fixtures/cases.json</span>{" "}
              by <span className="hash">{report.source}</span>. Generated {report.generatedAt}.
            </p>

            <Panel className="mt-8">
              <SectionHeading
                eyebrow="Control"
                title={`The release cases must be released: ${report.control.outcome}`}
                lead={report.control.description}
              />
              <p className="mt-3 hash text-[12px] text-ink-600">{report.control.detail}</p>
            </Panel>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link className="btn-quiet" href="/lab">
                Run the corpus yourself
              </Link>
              <Link className="btn-quiet" href="/docs/EVIDENCE">
                Read the evidence document
              </Link>
            </div>
          </>
        ) : (
          <div className="mt-8">
            <Notice tone="warn" title="No proof report in this checkout">
              <p>{NOT_MEASURED_COPY}</p>
            </Notice>
          </div>
        )}
      </div>
    </Shell>
  );
}
