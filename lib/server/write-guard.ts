import { NextResponse } from "next/server";

import { RUNTIME_MODE } from "@/lib/config";
import { signerStatus } from "@/lib/server/signer";

/**
 * The single guard for every server-side write endpoint.
 *
 * Two different situations used to produce one vague answer, and a caller could
 * not tell "this checkout has no contracts" from "this deployment holds no
 * signing key". They are different problems with different fixes, so they get
 * different codes.
 *
 * The response never carries a stack trace, and it never echoes a key. It names
 * what is missing and what the caller can do about it.
 */

export const SERVER_SIGNING_DISABLED_HINT =
  "Live writes are disabled for server signing on this deployment. Connect a Studio Next wallet and sign from the browser.";

export const WRITE_GUARD_HELP = SERVER_SIGNING_DISABLED_HINT;

export function writeGuard(): NextResponse | null {
  const signer = signerStatus();
  if (RUNTIME_MODE === "live" && signer.enabled) return null;

  if (RUNTIME_MODE !== "live") {
    return NextResponse.json(
      {
        error: "EXECUTION_UNAVAILABLE",
        detail: "Contract addresses are not configured, so no transaction can be built.",
        hint: "This endpoint constructs real transactions and never decides anything. In rehearsal the console drives the same state machine locally instead.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      error: "SERVER_SIGNING_DISABLED",
      detail:
        "Server-side signing is disabled on this deployment, so this endpoint cannot construct a transaction.",
      hint: SERVER_SIGNING_DISABLED_HINT,
    },
    { status: 503 },
  );
}
