/**
 * The wallet-backed GenLayer client.
 *
 * `createClient` treats a bare address as "an account this wallet holds the key
 * for", and routes every signing method through the injected provider. So the
 * client built here is the same client the rest of the application already
 * uses, with the signing step moved from a server key to the user's wallet.
 *
 * Nothing about the transaction changes. The same calldata, the same fee tree,
 * the same contract calls -- the signature is simply the user's.
 */

import { createClient } from "genlayer-js";

import { CHAIN } from "@/lib/genlayer/client";
import type { Eip1193Provider } from "@/lib/wallet/eip1193";

export type WalletGenLayerClient = ReturnType<typeof createClient>;

export function createWalletClient(
  address: string,
  provider: Eip1193Provider,
): WalletGenLayerClient {
  return createClient({
    chain: CHAIN,
    account: address as `0x${string}`,
    provider: provider as never,
  });
}

/** Native balance, in wei. Used only to tell the user whether they can pay. */
export async function readBalance(
  provider: Eip1193Provider,
  address: string,
): Promise<bigint | null> {
  try {
    const value = await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    return typeof value === "string" ? BigInt(value) : null;
  } catch {
    return null;
  }
}
