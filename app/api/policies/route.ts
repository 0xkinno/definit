import { NextResponse } from "next/server";

import { RUNTIME_MODE } from "@/lib/config";
import { SCENARIO } from "@/lib/demo/scenario";
import { contracts, readClient } from "@/lib/genlayer/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/policies
 *
 * The policy register the decision contract judges against. Policies are
 * published once and referenced by hash, so the hash in a commitment is the
 * same hash a reader can look up here.
 */
export async function GET() {
  if (RUNTIME_MODE !== "live") {
    return NextResponse.json({
      mode: "rehearsal",
      detail: "No registry address is configured, so the register cannot be read.",
      policies: [
        {
          policy_id: SCENARIO.policyId,
          version: SCENARIO.policyVersion,
          title: SCENARIO.policyTitle,
          policy_hash: null,
          source: "the bundled demo policy text",
        },
      ],
    });
  }

  try {
    const client = readClient();
    const policies = await contracts.listPolicies(client);
    return NextResponse.json({ mode: "live", policies });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "POLICY_READ_FAILED", detail: message }, { status: 502 });
  }
}
