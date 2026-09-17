import { NextResponse } from "next/server";

import { RUNTIME_MODE } from "@/lib/config";
import { signerStatus } from "@/lib/server/signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  const signer = signerStatus();
  if (RUNTIME_MODE === "live" && signer.enabled) return null;
  return NextResponse.json(
    {
      error: "EXECUTION_UNAVAILABLE",
      detail:
        RUNTIME_MODE !== "live"
          ? "Contract addresses are not configured, so no transaction can be built."
          : signer.reason,
      hint: "This endpoint constructs real transactions and never decides anything. In rehearsal the console drives the same state machine locally instead.",
    },
    { status: 503 },
  );
}

function failed(code: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: code, detail: message }, { status: 502 });
}

/**
 * POST /api/actions/:id/adjudicate
 *
 * Asks the decision contract to adjudicate the action. The API does not judge
 * anything: the contract fetches the evidence snapshot and the validators
 * reach their own conclusion. The result is *accepted*, not final, and the
 * response says so rather than implying the money can move.
 */
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
    return NextResponse.json(
      { error: "INVALID_ACTION_ID", detail: "action id must be a 32-byte hex value" },
      { status: 400 },
    );
  }

  const blocked = unavailable();
  if (blocked) return blocked;

  try {
    const { requestAdjudication } = await import("@/lib/server/runner");
    const result = await requestAdjudication({ actionId: id });
    return NextResponse.json({
      actionId: id,
      ...result,
      interpretation:
        "ACCEPTED is provisional. Until the appeal window closes, this decision is not authority to move anything.",
    });
  } catch (error) {
    return failed("ADJUDICATION_FAILED", error);
  }
}
