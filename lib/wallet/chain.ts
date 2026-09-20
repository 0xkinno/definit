/**
 * Network alignment.
 *
 * DEFINIT runs against one chain. A wallet pointed somewhere else would sign a
 * transaction for the wrong network, so the connection is only considered
 * usable once the wallet reports the expected chain id.
 *
 * The chain is offered to the wallet with the standard add/switch pair, which
 * means a judge who has never heard of this network can still use it: the
 * wallet is asked to add it rather than being told to go and configure it.
 */

import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, RPC_URL } from "@/lib/config";
import {
  WALLET_ERROR,
  readChainId,
  walletErrorCode,
  walletErrorMessage,
  type Eip1193Provider,
} from "@/lib/wallet/eip1193";

export const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`;

export const WALLET_CHAIN_PARAMS = {
  chainId: CHAIN_ID_HEX,
  chainName: CHAIN_NAME,
  rpcUrls: [RPC_URL],
  nativeCurrency: { name: "GenLayer", symbol: "GEN", decimals: 18 },
  blockExplorerUrls: [EXPLORER_URL],
};

export type ChainOutcome =
  | { ok: true; chainId: string; switched: boolean; added: boolean }
  | { ok: false; chainId: string | null; reason: string; declined: boolean };

export function describeChain(hex: string | null): string {
  if (!hex) return "unknown network";
  const id = Number.parseInt(hex, 16);
  return Number.isFinite(id) ? `chain ${id}` : "unknown network";
}

/** The outcome of one attempt to move the wallet. */
type Attempt =
  | { kind: "aligned"; chainId: string; switched: boolean }
  | { kind: "declined"; chainId: string | null }
  | { kind: "pending"; chainId: string | null }
  | { kind: "failed"; chainId: string | null; reason: string };

/**
 * Ask the wallet to select the chain.
 *
 * A failure here is not automatically a dead end. A wallet that has never seen
 * the network answers with 4902, a wallet that cannot switch at all answers with
 * -32601, and both mean the same thing to this application: offer the network
 * configuration next. Only an explicit rejection in the wallet stops the chain.
 */
async function attemptSwitch(provider: Eip1193Provider): Promise<Attempt> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    const code = walletErrorCode(error);
    if (code === WALLET_ERROR.userRejected) {
      return { kind: "declined", chainId: await readChainId(provider) };
    }
    if (code === WALLET_ERROR.alreadyPending) {
      return { kind: "pending", chainId: await readChainId(provider) };
    }
    return {
      kind: "failed",
      chainId: await readChainId(provider),
      reason: walletErrorMessage(error),
    };
  }

  const after = await readChainId(provider);
  if (after === CHAIN_ID_HEX) return { kind: "aligned", chainId: after, switched: true };
  return {
    kind: "failed",
    chainId: after,
    reason: `the wallet reported ${describeChain(after)} after the switch was accepted`,
  };
}

/**
 * Offer the network to the wallet.
 *
 * This is the prompt that carries the chain id, the RPC URL, the native
 * currency and the explorer, so a wallet that has never heard of this network
 * is configured from the page rather than being told to go and type values in
 * by hand.
 *
 * Some wallets raise an error when the chain is already present. That is not a
 * failure here: the chain id is re-read either way, and the read decides.
 */
async function attemptAdd(provider: Eip1193Provider): Promise<Attempt> {
  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [WALLET_CHAIN_PARAMS],
    });
  } catch (error) {
    const code = walletErrorCode(error);
    if (code === WALLET_ERROR.userRejected) {
      return { kind: "declined", chainId: await readChainId(provider) };
    }
    if (code === WALLET_ERROR.alreadyPending) {
      return { kind: "pending", chainId: await readChainId(provider) };
    }
    /* anything else: the re-read below is what decides */
  }

  let after = await readChainId(provider);
  if (after === CHAIN_ID_HEX) return { kind: "aligned", chainId: after, switched: true };

  // Most wallets select the chain as part of adding it; some only add it. One
  // more switch request covers the second group without a second popup on the
  // first.
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch {
    /* the re-read below is the authority */
  }

  after = await readChainId(provider);
  if (after === CHAIN_ID_HEX) return { kind: "aligned", chainId: after, switched: true };
  return {
    kind: "failed",
    chainId: after,
    reason: `the wallet still reports ${describeChain(after)}`,
  };
}

/**
 * Bring the wallet onto the DEFINIT chain.
 *
 * Read first, switch second, and offer the full network configuration third, so
 * that a wallet which does not have the network is asked to add it in one step
 * rather than being left on the wrong chain with an instruction to go and find
 * the RPC URL.
 *
 * An explicit rejection in the wallet is respected and stops the sequence: the
 * application does not answer a declined prompt with another prompt.
 */
export async function alignChain(provider: Eip1193Provider): Promise<ChainOutcome> {
  const current = await readChainId(provider);
  if (current === CHAIN_ID_HEX) return { ok: true, chainId: current, switched: false, added: false };

  const switched = await attemptSwitch(provider);
  if (switched.kind === "aligned") {
    return { ok: true, chainId: switched.chainId, switched: true, added: false };
  }
  if (switched.kind === "declined") {
    return {
      ok: false,
      chainId: switched.chainId,
      declined: true,
      reason: `The switch to ${CHAIN_NAME} was declined in the wallet.`,
    };
  }
  if (switched.kind === "pending") {
    return {
      ok: false,
      chainId: switched.chainId,
      declined: false,
      reason: "The wallet already has a network request open. Answer it there.",
    };
  }

  const added = await attemptAdd(provider);
  if (added.kind === "aligned") {
    return { ok: true, chainId: added.chainId, switched: true, added: true };
  }
  if (added.kind === "declined") {
    return {
      ok: false,
      chainId: added.chainId,
      declined: true,
      reason: `Adding ${CHAIN_NAME} to the wallet was declined.`,
    };
  }
  if (added.kind === "pending") {
    return {
      ok: false,
      chainId: added.chainId,
      declined: false,
      reason: "The wallet already has a network request open. Answer it there.",
    };
  }
  return {
    ok: false,
    chainId: added.chainId,
    declined: false,
    reason: `${CHAIN_NAME} could not be selected or added automatically: ${added.reason}.`,
  };
}
