import { NextResponse } from "next/server";

import { RUNTIME_MODE } from "@/lib/config";
import { contracts, readClient } from "@/lib/genlayer/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/actions/:id -- the action, its escrow, and both capability scopes. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (RUNTIME_MODE !== "live") {
    return NextResponse.json(
      {
        error: "NOT_CONFIGURED",
        detail:
          "No contract addresses are configured, so there is nothing to read. This endpoint never fabricates state.",
      },
      { status: 503 },
    );
  }

  try {
    const client = readClient();
    const action = await contracts.getAction(client, id);
    if (!action.exists) {
      return NextResponse.json({ error: "ACTION_UNKNOWN", actionId: id }, { status: 404 });
    }

    const decisionId = action.decision_id ?? "";
    const [escrow, receipt] = await Promise.all([
      contracts.getEscrow(client, id),
      contracts.getReceipt(client, id),
    ]);

    const [provisional, final] = decisionId
      ? await Promise.all([
          contracts.getCapabilityProvisional(client, decisionId),
          contracts.getCapabilityFinal(client, decisionId),
        ])
      : [null, null];

    return NextResponse.json({
      actionId: id,
      action,
      escrow,
      receipt,
      /**
       * The two reads below answer the same question against different storage
       * scopes. The difference between them is the product.
       */
      capability: {
        provisionalScope: provisional,
        finalScope: final,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "READ_FAILED", detail: message }, { status: 502 });
  }
}
