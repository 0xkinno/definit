import Link from "next/link";

import { LifecycleDemo } from "@/components/demo/LifecycleDemo";
import { ModeBadge, Shell } from "@/components/Shell";
import { Notice, SectionHeading } from "@/components/ui/primitives";
import { RUNTIME_MODE, RUNTIME_MODE_DETAIL } from "@/lib/config";
import { SCENARIO } from "@/lib/demo/scenario";
import { loadLiveLifecycle, NOT_RECORDED_COPY } from "@/lib/evidence";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Lifecycle demo -- DEFINIT",
  description:
    "Walk one agent action from registration to release, signed by your own wallet, with every transaction verifiable on the explorer.",
};

export default async function DemoPage() {
  const { record, available } = await loadLiveLifecycle();

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeading
            eyebrow="Lifecycle demo"
            title="Connect a wallet. Walk the boundary. Verify every step."
            lead="This is the whole product in one page: register a commitment, have it judged, fund it, try to promote it too early, then watch the release finally go through. Every step raises a wallet popup, and every hash it returns resolves on the explorer."
          />
          <ModeBadge />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <Notice tone="neutral" title="Scenario">
            <p>{SCENARIO.plainLanguage}</p>
          </Notice>
          <Notice tone="neutral" title="Runtime">
            <p>{RUNTIME_MODE_DETAIL}</p>
          </Notice>
          <Notice tone="neutral" title="What a wallet is for">
            <p>
              Signing only. Reading the chain never needs one, so the rest of this site works
              without a wallet at all.
            </p>
          </Notice>
        </div>

        {RUNTIME_MODE !== "live" ? (
          <div className="mt-6">
            <Notice tone="warn" title="No contracts configured">
              <p>
                Without contract addresses there is nothing to sign for. Set{" "}
                <span className="hash">NEXT_PUBLIC_DECISION_GATE_ADDRESS</span> and its companions.
              </p>
            </Notice>
          </div>
        ) : null}

        <div className="mt-8">
          <LifecycleDemo recorded={available ? record : null} />
        </div>

        {!available ? (
          <div className="mt-6">
            <Notice tone="warn" title="No recorded run to fall back on">
              <p>{NOT_RECORDED_COPY}</p>
            </Notice>
          </div>
        ) : null}

        <p className="mt-8 text-[13px] text-ink-600">
          Need the shorter path?{" "}
          <Link className="link" href="/console">
            The console runs the same lifecycle with the operator key.
          </Link>
        </p>
      </div>
    </Shell>
  );
}
