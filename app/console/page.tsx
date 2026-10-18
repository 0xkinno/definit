import Link from "next/link";

import { ModeBadge, Shell } from "@/components/Shell";
import { V1Console } from "@/components/console/V1Console";
import { Notice, SectionHeading } from "@/components/ui/primitives";
import { V1 } from "@/lib/v1/console";

export const metadata = {
  title: "Console, milestone v1 -- DEFINIT",
  description: "Drive one payment through protocol-delivered finality: propose, fund, adjudicate, contest, and watch the vault act only after Finalized.",
};

export default function ConsolePage() {
  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeading
            level={1}
            eyebrow="Console, milestone v1"
            title="Send one payment through protocol-delivered finality"
            lead="You sign every step with your wallet. Fees are quoted through the Transaction Kit from a measured profile. The vault releases value only against a delivery the protocol creates after the verdict is final."
          />
          <ModeBadge />
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <V1Console />
          <aside className="space-y-5">
            <Notice tone="final" title="Live contracts">
              <p>Studio-dev, milestone v1.</p>
              <ul className="mt-2 space-y-1 text-[13px]">
                <li>Gate <span className="hash">{V1.gate.slice(0, 10)}…{V1.gate.slice(-6)}</span></li>
                <li>Vault <span className="hash">{V1.vault.slice(0, 10)}…{V1.vault.slice(-6)}</span></li>
              </ul>
            </Notice>
            <Notice tone="neutral" title="No wallet?">
              <p>Reading works without one. The recorded runs, with their finality clocks, are on <Link className="link" href="/milestone">the milestone page</Link>.</p>
            </Notice>
            <Notice tone="neutral" title="v0 baseline">
              <p>The accepted v0 console, which settles through a promotion step, is kept at <Link className="link" href="/console/v0">/console/v0</Link>.</p>
            </Notice>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
