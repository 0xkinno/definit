import Link from "next/link";

import { ModeBadge, Shell } from "@/components/Shell";
import { ConsoleBoard } from "@/components/console/ConsoleBoard";
import { Notice, SectionHeading } from "@/components/ui/primitives";
import { RUNTIME_MODE, RUNTIME_MODE_DETAIL } from "@/lib/config";
import { SCENARIO } from "@/lib/demo/scenario";
import { runtimeCapabilities } from "@/lib/runtime/capabilities";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Protection console -- DEFINIT",
  description:
    "Drive one agent action through the whole lifecycle and watch the effect wait for finality.",
};

export default async function ConsolePage() {
  const capabilities = await runtimeCapabilities();

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeading
            level={1}
            eyebrow="Protection console"
            title="Watch one judgement become safe to act on"
            lead="The console walks a single agent action from registration to release. Nothing is simulated: every transition is a transaction, and the boundary between provisional and final is read from the chain each time."
          />
          <ModeBadge />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <ConsoleBoard operatorSigning={capabilities.operatorSigning} />

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

            {!capabilities.operatorSigning ? (
              <Notice tone="warn" title="Wallet required for live actions">
                <p>
                  This deployment does not hold a signing key, so there is no operator fallback. The
                  write controls stay disabled until a Studio Next wallet is connected, which raises
                  the popup for every transaction.
                </p>
              </Notice>
            ) : (
              <Notice tone="neutral" title="Operator signing is active">
                <p>
                  This deployment holds a testnet signing key, so a visitor without a wallet can
                  still run the lifecycle. Connecting a wallet switches every step to a browser
                  signature instead.
                </p>
              </Notice>
            )}

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
