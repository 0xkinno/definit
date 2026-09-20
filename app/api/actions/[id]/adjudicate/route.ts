import { NextResponse } from "next/server";

import { RUNTIME_MODE } from "@/lib/config";
import { writeGuard } from "@/lib/server/write-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  return writeGuard();
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
