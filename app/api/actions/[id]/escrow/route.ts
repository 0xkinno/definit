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
 * POST /api/actions/:id/escrow
 *
 * Funds the escrow for an action. The beneficiary and the amount are read
 * from the decision contract, not from this request: the request only says
 * how much value to attach, and the contract rejects a mismatch.
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

  const blocked = unavailable();
  if (blocked) return blocked;

  try {
    /**
     * The amount is read from the action the gate recorded unless the caller
     * states one explicitly. The vault compares the attached value against its
     * own record, so a caller-supplied figure cannot redirect the payment --
     * but there is no reason to require one either.
     */
    let amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      const { contracts, readClient } = await import("@/lib/genlayer/contracts");
      const action = await contracts.getAction(readClient(), id);
      if (!action.exists) {
        return NextResponse.json(
          { error: "ACTION_UNKNOWN", detail: "no action record exists for that id" },
          { status: 404 },
        );
      }
      amount = Number(action.amount ?? 0);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "INVALID_AMOUNT", detail: "the recorded commitment carries no amount to fund" },
        { status: 400 },
      );
    }

    const { openEscrow } = await import("@/lib/server/runner");
    const result = await openEscrow({ actionId: id, amount });
    return NextResponse.json({ actionId: id, ...result });
  } catch (error) {
    return failed("ESCROW_FAILED", error);
  }
}
