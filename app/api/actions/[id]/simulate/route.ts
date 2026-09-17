import { readFileSync } from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { unsafeRelease } from "@/lib/guard/baseline";
import { buildCase } from "@/lib/guard/corpus";
import { guardedSettle } from "@/lib/guard/finality";
import type { Outcome } from "@/lib/guard/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET|POST /api/actions/:id/simulate
 *
 * A rehearsal of the boundary that needs no network and spends no GEN. It
 * replays a named corpus case through both settlement arms and returns what
 * each one did, which is how the demo page can be exercised before, during
 * and after a live run.
 *
 * This endpoint never writes and never claims a live result: every field it
 * returns is labelled `rehearsal`.
 */

interface CaseRow {
  id: string;
  title: string;
  invariant: string;
  expected: "SETTLE" | "REFUSE";
  expectedCode: string | null;
}

const CASES_PATH = path.join(process.cwd(), "tests", "fixtures", "cases.json");

function loadCases(): CaseRow[] {
  try {
    const parsed = JSON.parse(readFileSync(CASES_PATH, "utf8")) as { cases?: CaseRow[] };
    return Array.isArray(parsed.cases) ? parsed.cases : [];
  } catch {
    return [];
  }
}

function project(caseId: string) {
  const scenario = buildCase(caseId);
  const baseline: Outcome = unsafeRelease(scenario.world, scenario.caller, scenario.claim);
  const intervention: Outcome = guardedSettle(scenario.world, scenario.caller, scenario.claim);
  return {
    caseId,
    caller: scenario.caller,
    baseline: {
      released: baseline.released,
      code: baseline.code,
      readScope: baseline.readScope ?? null,
    },
    intervention: {
      released: intervention.released,
      code: intervention.code,
      readScope: intervention.readScope ?? null,
      boundToFinal: intervention.boundToFinal ?? false,
      matchedCommitment: intervention.matchedCommitment ?? false,
    },
    attributed:
      baseline.released !== intervention.released
        ? "The two arms disagree, and the only property that differs between them is the read scope the release is checked against."
        : "The two arms agree on this case, so it carries no attribution on its own.",
  };
}

export async function GET() {
  const cases = loadCases();
  return NextResponse.json({
    mode: "rehearsal",
    note: "This endpoint replays the shipped settlement logic in-process. It does not touch the chain and spends nothing.",
    cases: cases.map((row) => ({
      id: row.id,
      title: row.title,
      invariant: row.invariant,
      expected: row.expected === "SETTLE" ? "released" : `refused with ${row.expectedCode}`,
    })),
    usage: "POST { \"caseId\": \"accepted-not-final\" }",
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const cases = loadCases();
  const caseId = String(body.caseId ?? cases[0]?.id ?? "").trim();
  if (!cases.some((row) => row.id === caseId)) {
    return NextResponse.json(
      {
        error: "UNKNOWN_CASE",
        detail: `caseId must be one of: ${cases.map((row) => row.id).join(", ")}`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    actionId: id,
    mode: "rehearsal",
    ...project(caseId),
  });
}
