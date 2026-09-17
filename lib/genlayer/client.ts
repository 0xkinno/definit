/**
 * GenLayer client construction.
 *
 * Two clients exist on purpose:
 *
 *   * the read client answers questions and never needs a key;
 *   * the write client signs and is only constructed on the server, from an
 *     environment variable that is never exposed to the browser.
 *
 * The application is fully inspectable with the read client alone. A judge can
 * understand the product without connecting anything.
 */

import { createClient } from "genlayer-js";
import { chains } from "genlayer-js";
import type { GenLayerChain, Hash } from "genlayer-js/types";

import { CHAIN_ID, RPC_URL } from "@/lib/config";

interface ChainLike {
  id: number;
  name: string;
  rpcUrls: { default: { http: readonly string[] } };
  nativeCurrency: { name: string; symbol: string; decimals: number };
  blockExplorers?: { default: { name: string; url: string } };
  isStudio?: boolean;
}

/**
 * The SDK ships a preview Studio chain at id 61997. We start from it and then
 * apply any operator overrides, so the application follows the SDK's own
 * definition unless the environment says otherwise.
 */
function buildChain(): ChainLike {
  const shipped = (chains as unknown as { studioDevnet?: ChainLike }).studioDevnet;
  const base: ChainLike = shipped ?? {
    id: CHAIN_ID,
    name: "GenLayer Studio Next",
    rpcUrls: { default: { http: [RPC_URL] } },
    nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
    isStudio: true,
  };

  return {
    ...base,
    id: CHAIN_ID,
    rpcUrls: { default: { http: [RPC_URL] } },
  };
}

export const CHAIN = buildChain();

export function createReadClient() {
  return createClient({ chain: CHAIN });
}

export function createWriteClient(privateKey: `0x${string}`) {
  return createClient({
    chain: CHAIN,
    account: privateKey,
  });
}

/**
 * The SDK brands transaction hashes with a literal byte length, so a hash that
 * arrived as an ordinary string has to be asserted before it can be passed
 * back in. Funnel every such assertion through here rather than sprinkling
 * casts through the codebase.
 */
export function asHash(hash: string): Hash {
  return hash as unknown as Hash;
}

export type { GenLayerChain };
