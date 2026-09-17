import { NextResponse } from "next/server";

import { RUNTIME_MODE } from "@/lib/config";
import { MILESTONE_AMOUNT_WEI, SCENARIO } from "@/lib/demo/scenario";
import { deadlineUnixFromNow } from "@/lib/demo/scenario";
import { commitmentPayload, intentHashOf } from "@/lib/commitments/commitment";
import { contracts, readClient } from "@/lib/genlayer/contracts";
import { createAction, publishPolicyIfMissing } from "@/lib/server/runner";
import { signerStatus } from "@/lib/server/signer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/actions
 *
 * Registers an action. The API does not decide anything: it asks the decision
 * contract to create the record, and the contract derives the canonical
 * commitment itself.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const recipient = String(body.recipient ?? "").trim();
  // The contract carries wei. The caller may supply the committed amount in
  // wei; otherwise the recorded demo milestone is used.
  const amount = Number(body.amount ?? MILESTONE_AMOUNT_WEI);
  const asset = String(body.asset ?? SCENARIO.asset);
  const policyId = String(body.policyId ?? SCENARIO.policyId);
  const evidenceUrl = String(body.evidenceUrl ?? SCENARIO.evidenceUrl);
  const deadlineUnix = Number(body.deadlineUnix ?? deadlineUnixFromNow());
  const nonce = Number(body.nonce ?? Date.now() % 2_000_000_000);

  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return NextResponse.json(
      { error: "INVALID_RECIPIENT", detail: "recipient must be a 20-byte hex address" },
      { status: 400 },
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "INVALID_AMOUNT", detail: "amount must be a positive integer" },
      { status: 400 },
    );
  }
  if (!evidenceUrl.startsWith("https://")) {
    return NextResponse.json(
      { error: "INVALID_EVIDENCE_URL", detail: "evidence must be an https URL" },
      { status: 400 },
    );
  }

  const signer = signerStatus();
  if (RUNTIME_MODE !== "live" || !signer.enabled) {
    return NextResponse.json(
      {
        error: "EXECUTION_UNAVAILABLE",
        detail:
          RUNTIME_MODE !== "live"
            ? "Contract addresses are not configured, so no transaction can be built."
            : signer.reason,
        hint: "This endpoint constructs real transactions. In rehearsal the console drives the same state machine locally instead.",
      },
      { status: 503 },
    );
  }

  try {
    const policy = await publishPolicyIfMissing({
      policyId,
      version: SCENARIO.policyVersion,
      title: SCENARIO.policyTitle,
      text: SCENARIO.policyText,
    });

    const result = await createAction({
      recipient,
      amount,
      asset,
      policyId,
      evidenceUrl,
      deadlineUnix,
      nonce,
    });

    const client = readClient();
    const action = result.actionId
      ? await contracts.getAction(client, result.actionId)
      : null;

    return NextResponse.json({
      actionId: result.actionId,
      txHash: result.txHash,
      policyPublished: policy.published,
      policyHash: policy.policyHash,
      action,
      note: result.note,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "CREATE_FAILED", detail: message }, { status: 502 });
  }
}

export async function GET() {
  return NextResponse.json({
    usage: "POST with { recipient, amount, asset, policyId, evidenceUrl, deadlineUnix, nonce }",
    preview: {
      commitmentPayload: commitmentPayload({
        agent: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000000",
        amount: Number(MILESTONE_AMOUNT_WEI),
        asset: SCENARIO.asset,
        policyHash: "0x0",
        evidenceDigest: "0x0",
        nonce: 1,
        deadlineUnix: 0,
      }),
      intentHashSample: intentHashOf({
        agent: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000000",
        amount: Number(MILESTONE_AMOUNT_WEI),
        asset: SCENARIO.asset,
        policyHash: "0x0",
        evidenceDigest: "0x0",
        nonce: 1,
        deadlineUnix: 0,
      }),
    },
  });
}
