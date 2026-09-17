import { NextResponse } from "next/server";

import { RUNTIME_MODE } from "@/lib/config";
import { toDefinitLifecycle } from "@/lib/lifecycle/map";
import { asHash, createReadClient } from "@/lib/genlayer/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/actions/:id/lifecycle?tx=0x..&tx=0x..
 *
 * Returns one lifecycle reading per transaction hash. The caller supplies the
 * hashes because the API keeps no server-side index: a hash is the only
 * durable identifier that matters, and it belongs to whoever paid for it.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const hashes = url.searchParams.getAll("tx").filter((hash) => /^0x[0-9a-fA-F]{64}$/.test(hash));

  if (hashes.length === 0) {
    return NextResponse.json(
      {
        actionId: id,
        transactions: [],
        detail: "No transaction hashes were supplied. Pass ?tx=<hash> once per transaction.",
      },
      { status: 200 },
    );
  }

  if (RUNTIME_MODE !== "live") {
    return NextResponse.json(
      {
        error: "NOT_CONFIGURED",
        detail: "No contract addresses are configured, so no lifecycle can be read.",
      },
      { status: 503 },
    );
  }

  const client = createReadClient();

  const transactions = await Promise.all(
    hashes.map(async (hash) => {
      try {
        const raw = await client.getTransaction({ hash: asHash(hash) });
        const status = String(
          (raw as unknown as { status_name?: string }).status_name ??
            (raw as unknown as { status?: string }).status ??
            "",
        );
        let resolutionAction: string | null = null;
        let decisionActive: boolean | null = null;
        try {
          const protocol = await client.advanced.getTransactionLifecycle({
            hash: asHash(hash),
          });
          resolutionAction = protocol.resolutionAction ?? null;
          decisionActive = protocol.decisionActive ?? null;
        } catch {
          resolutionAction = null;
        }
        const reading = toDefinitLifecycle({ txStatus: status, resolutionAction });
        return {
          hash,
          status,
          resolutionAction,
          decisionActive,
          reading,
          final: reading.state === "finalized",
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          hash,
          status: null,
          resolutionAction: null,
          decisionActive: null,
          reading: {
            state: "proposing" as const,
            reason:
              "The transaction could not be read. That is not evidence that it failed, and it will never be resubmitted.",
            decidedBy: "read failure",
            unresolved: true,
          },
          final: false,
          error: message,
        };
      }
    }),
  );

  return NextResponse.json({ actionId: id, transactions });
}
