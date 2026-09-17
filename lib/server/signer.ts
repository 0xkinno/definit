/**
 * Server-side transaction construction.
 *
 * This module signs and submits transactions. It does not decide anything, it
 * does not cache anything, and it cannot change what the contracts enforce. If
 * it were deleted and replaced by a script, an agent or a hostile client, the
 * invariant would be exactly as strong.
 *
 * The key it uses funds a demonstration escrow. It is read from the server
 * environment and is never exposed to the browser.
 */

import { createClient } from "genlayer-js";

import { CHAIN } from "@/lib/genlayer/client";

export interface ServerSignerStatus {
  enabled: boolean;
  address?: string;
  reason?: string;
}

let cached: { client: ReturnType<typeof createClient>; address: string } | null = null;

export const SERVER_SIGNING_FLAG = process.env.DEFINIT_ALLOW_SERVER_SIGNING ?? "false";

function normaliseKey(raw: string | undefined): `0x${string}` | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return null;
  return trimmed as `0x${string}`;
}

export function signerStatus(): ServerSignerStatus {
  if (SERVER_SIGNING_FLAG !== "true") {
    return {
      enabled: false,
      reason:
        "Server-side signing is disabled. Set DEFINIT_ALLOW_SERVER_SIGNING=true to enable the operator-signed demo run.",
    };
  }
  const key = normaliseKey(process.env.GENLAYER_PRIVATE_KEY);
  if (!key) {
    return {
      enabled: false,
      reason:
        "DEFINIT_ALLOW_SERVER_SIGNING is true but GENLAYER_PRIVATE_KEY is missing or malformed.",
    };
  }
  if (cached) return { enabled: true, address: cached.address };
  return { enabled: true };
}

export function getSigner() {
  const key = normaliseKey(process.env.GENLAYER_PRIVATE_KEY);
  if (!key) throw new Error("GENLAYER_PRIVATE_KEY is not configured.");
  if (!cached) {
    const client = createClient({ chain: CHAIN, account: key });
    const address = String((client as unknown as { account?: { address?: string } }).account?.address ?? "");
    cached = { client, address };
  }
  return cached;
}

export function operatorAddress(): string | null {
  const key = normaliseKey(process.env.GENLAYER_PRIVATE_KEY);
  if (!key) return null;
  const client = createClient({ chain: CHAIN, account: key });
  return String((client as unknown as { account?: { address?: string } }).account?.address ?? "") || null;
}
