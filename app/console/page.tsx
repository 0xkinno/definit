import Link from "next/link";

import { ModeBadge, Shell } from "@/components/Shell";
import { ConsoleBoard } from "@/components/console/ConsoleBoard";
import { Notice, SectionHeading } from "@/components/ui/primitives";
import { RUNTIME_MODE, RUNTIME_MODE_DETAIL } from "@/lib/config";
import { SCENARIO } from "@/lib/demo/scenario";
import { signerStatus } from "@/lib/server/signer";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Protection console -- DEFINIT",
  description:
    "Drive one agent action through the whole lifecycle and watch the effect wait for finality.",
};

export default function ConsolePage() {
  const signer = signerStatus();

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeading
            eyebrow="Protection console"
            title="Watch one judgement become safe to act on"
            lead="The console walks a single agent action from registration to release. Nothing is simulated: every transition is a transaction, and the boundary between provisional and final is read from the chain each time."
          />
          <ModeBadge />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ConsoleBoard />

          <aside className="space-y-5">
            <Notice tone="neutral" title="What you are looking at">
              <p>{RUNTIME_MODE_DETAIL}</p>
            </Notice>

            <Notice tone={RUNTIME_MODE === "live" ? "final" : "warn"} title="Scenario">
              <p>
                A delivery agent releases a {SCENARIO.amount} {SCENARIO.asset} milestone payment
                once the delivery record satisfies policy{" "}
                <span className="hash">{SCENARIO.policyId}</span>.
              </p>
            </Notice>

            {!signer.enabled ? (
              <Notice tone="warn" title="Operator signing is disabled">
                <p>{signer.reason}</p>
              </Notice>
            ) : null}

            <Notice tone="neutral" title="Only the chain decides">
              <p>
                The console can ask for a release. It cannot authorise one. The vault re-reads the
                decision contract, re-derives the appeal window from the gate's own record, and
                refuses anything that has not cleared it.
              </p>
              <p className="mt-2">
                <Link className="link" href="/lab">
                  Attack the invariant in the proof lab
                </Link>
              </p>
            </Notice>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
