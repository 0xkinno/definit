import Link from "next/link";
import { notFound } from "next/navigation";

import { Shell } from "@/components/Shell";
import { FieldRow, Notice, Panel, SectionHeading } from "@/components/ui/primitives";
import {
  CHAIN_ID,
  CHAIN_NAME,
  FINALITY_VAULT_ADDRESS,
  RUNTIME_MODE,
  explorerTxUrl,
} from "@/lib/config";
import { contracts, readClient } from "@/lib/genlayer/contracts";
import { receiptLines, toReceiptDocument } from "@/lib/receipts/schema";

export const dynamic = "force-dynamic";

export const metadata = { title: "Receipt -- DEFINIT" };

/**
 * A printable settlement receipt.
 *
 * Every field is read from the vault. The page never reconstructs a receipt from
 * a transaction hash or from local state, because a receipt that can be
 * assembled by the reader is not evidence of anything.
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let document = null as ReturnType<typeof toReceiptDocument>;
  let failure: string | null = null;

  if (RUNTIME_MODE === "live" && /^0x[0-9a-fA-F]{64}$/.test(id)) {
    try {
      const view = await contracts.getReceipt(readClient(), id);
      document = toReceiptDocument(view, {
        network: CHAIN_NAME,
        chainId: CHAIN_ID,
        contractAddress: FINALITY_VAULT_ADDRESS,
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <Shell>
      <div className="mx-auto max-w-[820px] px-4 py-10 sm:px-6">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link className="link text-[13px]" href={`/actions/${id}`}>
            Back to the lifecycle
          </Link>
          <span className="text-[12px] text-ink-500">
            Print this page to produce the audit copy.
          </span>
        </div>

        {RUNTIME_MODE !== "live" ? (
          <div className="mt-6">
            <Notice tone="warn" title="This build is in rehearsal">
              <p>
                No contract addresses are configured, so there is no vault to read a receipt from.
                The receipt is not synthesised locally: a receipt that the front end invented would
                be worse than no receipt.
              </p>
            </Notice>
          </div>
        ) : null}

        {failure ? (
          <div className="mt-6">
            <Notice tone="warn" title="The vault could not be read">
              <p>{failure}</p>
            </Notice>
          </div>
        ) : null}

        {document ? (
          <Panel className="mt-6">
            <SectionHeading
              level={1}
              eyebrow="Settlement receipt"
              title={`${document.amount} ${document.asset} released to the named beneficiary`}
              lead="Read from the vault's stored settlement record. The scope field names the property that was checked before any value moved."
            />
            <dl className="mt-6">
              {receiptLines(document).map(([label, value]) => (
                <FieldRow
                  key={label}
                  label={label}
                  mono={/hash|digest|Action|Decision|Vault|Funder|Beneficiary/i.test(label)}
                  value={value || "(none)"}
                />
              ))}
            </dl>
            <p className="mt-6 text-[12px] text-ink-500">
              Amounts are shown in the unit the vault stored. Test assets only.
            </p>
          </Panel>
        ) : null}

        {RUNTIME_MODE === "live" && !document && !failure ? (
          <div className="mt-6">
            <Notice tone="neutral" title="Nothing has settled for this action yet">
              <p>
                The vault holds no receipt for{" "}
                <span className="hash">{id}</span>. That is the correct answer while the decision is
                still provisional: a receipt only exists once value has actually moved.
              </p>
              <p className="mt-2">
                <Link className="link" href={`/actions/${id}`}>
                  Watch the lifecycle instead
                </Link>
              </p>
            </Notice>
          </div>
        ) : null}

        <div className="no-print mt-6">
          <Link className="btn-quiet" href={`/actions/${id}`}>
            Watch the lifecycle
          </Link>
        </div>
      </div>
    </Shell>
  );
}
