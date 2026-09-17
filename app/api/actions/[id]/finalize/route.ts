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
 * POST /api/actions/:id/finalize
 *
 * Requests promotion of the action's decision. This is the call that is
 * expected to be refused while the appeal window is open, and a refusal is a
 * successful outcome for the invariant -- so the response reports the refusal
 * code rather than dressing it up as an error.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
    return NextResponse.json(
      { error: "INVALID_ACTION_ID", detail: "action id must be a 32-byte hex value" },
      { status: 400 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const decisionId = String(body.decisionId ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(decisionId)) {
    return NextResponse.json(
      {
        error: "INVALID_DECISION_ID",
        detail: "decisionId is required and must be a 32-byte hex value",
      },
      { status: 400 },
    );
  }

  const blocked = unavailable();
  if (blocked) return blocked;

  try {
    const { finalizeDecision } = await import("@/lib/server/runner");
    const result = await finalizeDecision({ decisionId });
    return NextResponse.json({
      actionId: id,
      decisionId,
      ...result,
      interpretation:
        "A refusal here is the boundary working. The promotion only lands once the decision's appeal window has actually closed.",
    });
  } catch (error) {
    return failed("FINALIZE_FAILED", error);
  }
}
