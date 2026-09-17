import Link from "next/link";

import { Shell } from "@/components/Shell";
import { Notice, Panel, SectionHeading, StatusPill } from "@/components/ui/primitives";
import type { DefinitLifecycle } from "@/lib/lifecycle/state";
import { RUNTIME_MODE } from "@/lib/config";
import { contracts, readClient } from "@/lib/genlayer/contracts";
import { operatorAddress } from "@/lib/server/signer";
import { formatGen, middleTruncate } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Actions -- DEFINIT" };

const LIFECYCLE_BY_CONTRACT_STATE: Record<string, DefinitLifecycle> = {
  SUBMITTED: "proposing",
  ADJUDICATING: "proposing",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  FINALIZED: "finalized",
  HELD: "held",
  SETTLED: "settled",
};

interface Row {
  action_id: string;
  amount: number;
  asset: string;
  state: string;
  policy_id: string;
  created_at: string;
}

async function loadRows(): Promise<{ rows: Row[]; error: string | null }> {
  if (RUNTIME_MODE !== "live") return { rows: [], error: null };
  const operator = operatorAddress();
  if (!operator) return { rows: [], error: null };
  try {
    const client = readClient();
    const listed = await client.readContract({
      address: (process.env.NEXT_PUBLIC_DECISION_GATE_ADDRESS ?? "") as `0x${string}`,
      functionName: "list_actions_for",
      args: [operator.toLowerCase()] as never,
    });
    return { rows: Array.isArray(listed) ? (listed as unknown as Row[]) : [], error: null };
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function ActionsPage() {
  const { rows, error } = await loadRows();
  const operator = operatorAddress();

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <SectionHeading
          eyebrow="Actions"
          title="Every action this operator has registered"
          lead="The index is the decision contract's own record, read live. Nothing here is cached, and nothing here is authoritative: the contracts are."
        />

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Link className="btn btn-primary" href="/actions/new">
            Register another action
          </Link>
          <Link className="link" href="/console">
            Or drive one through the console
          </Link>
        </div>

        {RUNTIME_MODE !== "live" ? (
          <div className="mt-6">
            <Notice tone="warn" title="This build is in rehearsal">
              <p>
                No contract addresses are configured, so there is no index to read. The console
                replays the same state machine locally and labels itself.
              </p>
            </Notice>
          </div>
        ) : null}

        {error ? (
          <div className="mt-6">
            <Notice tone="warn" title="The index could not be read">
              <p>{error}</p>
            </Notice>
          </div>
        ) : null}

        {operator && rows.length ? (
          <div className="mt-6 space-y-3">
            {rows
              .slice()
              .reverse()
              .map((row) => (
                <Panel key={row.action_id} className="!p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <Link className="hash text-[13px]" href={`/actions/${row.action_id}`}>
                      {middleTruncate(row.action_id, 20, 10)}
                    </Link>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-[13px] text-ink-600">
                        {formatGen(row.amount / 1e18, row.asset)}
                      </span>
                      <StatusPill
                        size="sm"
                        state={LIFECYCLE_BY_CONTRACT_STATE[row.state] ?? "draft"}
                      />
                    </div>
                  </div>
                  <p className="mt-2 text-[12px] text-ink-500">
                    policy <span className="hash">{row.policy_id}</span> &middot; registered{" "}
                    {row.created_at}
                  </p>
                </Panel>
              ))}
          </div>
        ) : null}

        {RUNTIME_MODE === "live" && !error && rows.length === 0 ? (
          <div className="mt-6">
            <Notice tone="neutral" title="No actions registered yet">
              <p>
                This operator has not registered an action on this deployment. Registering one is
                the first step of the console walkthrough.
              </p>
            </Notice>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
