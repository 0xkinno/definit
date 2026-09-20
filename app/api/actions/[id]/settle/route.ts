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
 * POST /api/actions/:id/settle
 *
 * Releases escrow against a final decision. Every commitment field is read
 * from the escrow record the vault itself wrote, so the caller cannot
 * substitute one; the body only names the action and its decision.
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
    const { contracts, readClient } = await import("@/lib/genlayer/contracts");
    const { settle } = await import("@/lib/server/runner");
    const client = readClient();
    const escrow = await contracts.getEscrow(client, id);
    if (!escrow.exists) {
      return NextResponse.json(
        { error: "ESCROW_NOT_FOUND", detail: "no escrow record exists for this action" },
        { status: 404 },
      );
    }
    const result = await settle({
      actionId: id,
      decisionId,
      intentHash: String(escrow.intent_hash),
      policyHash: String(escrow.policy_hash),
      evidenceDigest: String(escrow.evidence_digest),
      nonce: Number(escrow.nonce),
      recipient: String(escrow.recipient),
      amount: Number(escrow.amount),
    });
    return NextResponse.json({ actionId: id, decisionId, ...result });
  } catch (error) {
    return failed("SETTLE_FAILED", error);
  }
}
