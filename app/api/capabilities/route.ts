import { NextResponse } from "next/server";

import { publicCapabilities } from "@/lib/runtime/capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/capabilities
 *
 * The public answer to "what can this deployment actually do?". Booleans and
 * public network metadata only: no key, no key shape, no environment echo.
 *
 * The pages pass the same values down as props, so this endpoint exists for a
 * reviewer who wants to check the claim without reading the source, and for the
 * production audit to assert against.
 */
export async function GET() {
  return NextResponse.json(await publicCapabilities(), {
    headers: { "cache-control": "no-store" },
  });
}
