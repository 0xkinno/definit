import Link from "next/link";

import { Shell } from "@/components/Shell";
import { ModeBadge } from "@/components/Shell";
import { NewActionForm } from "@/components/console/NewActionForm";
import { Notice, SectionHeading } from "@/components/ui/primitives";
import { RUNTIME_MODE, RUNTIME_MODE_DETAIL } from "@/lib/config";
import {
  MILESTONE_AMOUNT_WEI,
  SATISFYING_EVIDENCE,
  SCENARIO,
  deadlineUnixFromNow,
} from "@/lib/demo/scenario";
import { commitmentPayload, evidenceDigestOf, policyHashOf } from "@/lib/commitments/commitment";
import { runtimeCapabilities } from "@/lib/runtime/capabilities";

export const dynamic = "force-dynamic";

export const metadata = { title: "Register an action -- DEFINIT" };

export default async function NewActionPage() {
  const capabilities = await runtimeCapabilities();
  const preview = commitmentPayload({
    agent: "0x0000000000000000000000000000000000000000",
    recipient: SCENARIO.recipient,
    amount: Number(MILESTONE_AMOUNT_WEI),
    asset: SCENARIO.asset,
    policyHash: policyHashOf(SCENARIO.policyText),
    evidenceDigest: evidenceDigestOf(SATISFYING_EVIDENCE),
    nonce: 1,
    deadlineUnix: deadlineUnixFromNow(),
  });

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <SectionHeading
            level={1}
            eyebrow="New action"
            title="Commit an intent before anyone judges it"
            lead="The beneficiary, the amount, the policy and the deadline are fixed at registration. The evidence digest is not: it cannot exist until the evidence has been read and scored."
          />
          <ModeBadge />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <NewActionForm operatorSigning={capabilities.operatorSigning} />

          <aside className="space-y-5">
            <Notice tone="neutral" title="Runtime">
              <p>{RUNTIME_MODE_DETAIL}</p>
            </Notice>
            <Notice tone="neutral" title="The canonical payload">
              <p className="text-[12px]">
                Every field below is hashed into one string. The vault will require the settlement
                to restate it exactly.
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed">
                {preview}
              </pre>
            </Notice>
            <Notice tone="neutral" title="Prefer the guided path?">
              <p>
                <Link className="link" href="/console">
                  The console walks the same steps with the demo values already filled in.
                </Link>
              </p>
            </Notice>
          </aside>
        </div>
      </div>
    </Shell>
  );
}
