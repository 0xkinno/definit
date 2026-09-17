import { readFileSync } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/proof
 *
 * The settlement corpus report, exactly as `npm run proof` wrote it. The API
 * serves the artifact rather than recomputing it, so a reader can compare the
 * bytes on the wire against the file in the repository.
 */

const REPORT_PATH = path.join(process.cwd(), "docs", "evidence", "proof-report.json");

export async function GET() {
  try {
    const report = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as Record<string, unknown>;
    return NextResponse.json(report);
  } catch {
    return NextResponse.json(
      {
        error: "REPORT_MISSING",
        detail: "docs/evidence/proof-report.json has not been generated yet. Run `npm run proof`.",
      },
      { status: 503 },
    );
  }
}
