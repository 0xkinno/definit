/**
 * The v1 console's chain access: addresses, fee quotes through the Transaction
 * Kit, and the lifecycle read. Nothing here decides anything about finality; it
 * quotes, signs what the user approves, and reads back what the chain says.
 */
import { createTransactionKit, type FeePreset, type PolicyQuote } from "@genlayer/transaction-kit";

import { withMessageAllocations } from "../../packages/definit-guard/src/kit.ts";
import profile from "@/lib/fees/fee-profile.json";
import { CHAIN } from "@/lib/genlayer/client";
import { milestone } from "@/lib/milestone/data";
import type { Eip1193Provider } from "@/lib/wallet/eip1193";

export const V1 = {
  gate: milestone.deployment.addresses.decisionGate,
  vault: milestone.deployment.addresses.finalityVault,
  registry: milestone.deployment.addresses.scenarioRegistry,
  policy: milestone.deployment.policy,
  rpc: CHAIN.rpcUrls.default.http[0] as string,
};

/** Appeal posture: how many appeal rounds a payment's fees are funded for. */
export const POSTURES: Record<FeePreset, { label: string; rounds: number; line: string }> = {
  low: { label: "Low", rounds: 1, line: "Funds 1 appeal round. Fine for a payment you can afford to see delayed." },
  standard: { label: "Standard", rounds: 3, line: "Funds 3 appeal rounds. The default for a payment that matters." },
  high: { label: "High", rounds: 5, line: "Funds 5 appeal rounds. Higher posture funds more appeal rounds for a payment that matters more." },
};

export function makeKit(provider: Eip1193Provider, account: string) {
  return createTransactionKit({
    chain: CHAIN as never,
    provider: provider as never,
    account: account as `0x${string}`,
    suggestions: profile as never,
  });
}

export type Write = { address: string; method: string; args: unknown[]; value?: bigint; messages?: Array<{ recipient: string; method: string }> };

export type Quoted = { quote: PolicyQuote; blocked: string | null };

/** Quote one write. A fee policy mismatch blocks signing; `allowUnverified` is never set. */
export async function quoteWrite(kit: ReturnType<typeof makeKit>, preset: FeePreset, w: Write): Promise<Quoted> {
  const quote = await kit.estimate(
    { preset, ...(w.value ? { userValue: w.value } : {}) },
    { kind: "write", address: w.address as `0x${string}`, method: w.method, args: w.args },
  );
  const blocked = quote.verification.status === "mismatch" ? "The fee quote does not match the chain's current fee policy, so signing is blocked." : null;
  return { quote, blocked };
}

/**
 * The kit quotes and verifies. Its own submit cannot fund an emitted message, so a
 * write that emits messages is sent with explicit per-message allocations.
 */
export async function submitQuoted(kit: ReturnType<typeof makeKit>, q: Quoted, w: Write, client?: { writeContract: (a: never) => Promise<unknown> }): Promise<string> {
  if (q.blocked) throw new Error(q.blocked);
  if (w.messages?.length) {
    if (!client) throw new Error("Connect a wallet first.");
    const fees = withMessageAllocations(q.quote, w.messages, profile.messageShape);
    return String(await client.writeContract({ address: w.address, functionName: w.method, args: w.args, fees, ...(w.value ? { value: w.value } : {}) } as never));
  }
  const sent = await kit.submit(q.quote, { kind: "write", address: w.address as `0x${string}`, method: w.method, args: w.args });
  return String(sent.genlayerTxId);
}

export interface Lifecycle {
  storedStatus?: string;
  projectedStatus?: string;
  resolutionAction?: string | null;
  decisionActive?: boolean | null;
  evaluatedAt?: number | null;
}

/** The raw RPC takes `{ txId }` (spike observation O1); the SDK wrapper sends `{ hash }`. */
export async function readLifecycle(txId: string): Promise<Lifecycle> {
  const res = await fetch(V1.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_getTransactionLifecycle", params: [{ txId }] }),
  });
  const body = (await res.json()) as { result?: Lifecycle; error?: unknown };
  if (body.error || !body.result) throw new Error("lifecycle unavailable");
  return body.result;
}

export const gen = (wei: bigint | string | number) => (Number(BigInt(wei)) / 1e18).toFixed(6);
