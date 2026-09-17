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
  | { ok: true; chainId: string; switched: boolean }
  | { ok: false; chainId: string | null; reason: string };

export function describeChain(hex: string | null): string {
  if (!hex) return "unknown network";
  const id = Number.parseInt(hex, 16);
  return Number.isFinite(id) ? `chain ${id}` : "unknown network";
}

/**
 * Bring the wallet onto the DEFINIT chain.
 *
 * Order matters: read first, switch only if needed, and add only when the
 * wallet says it has never heard of the chain. Adding an already-known chain
 * is what makes some wallets raise a spurious error.
 */
export async function alignChain(provider: Eip1193Provider): Promise<ChainOutcome> {
  const current = await readChainId(provider);
  if (current === CHAIN_ID_HEX) return { ok: true, chainId: current, switched: false };

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
    const afterSwitch = await readChainId(provider);
    if (afterSwitch === CHAIN_ID_HEX) return { ok: true, chainId: afterSwitch, switched: true };
    return {
      ok: false,
      chainId: afterSwitch,
      reason: `The wallet reports ${describeChain(afterSwitch)} after the switch was accepted.`,
    };
  } catch (error) {
    const code = walletErrorCode(error);
    if (code === WALLET_ERROR.userRejected) {
      return {
        ok: false,
        chainId: current,
        reason: `The switch to ${CHAIN_NAME} was declined in the wallet.`,
      };
    }
    if (code !== WALLET_ERROR.chainNotAdded) {
      return {
        ok: false,
        chainId: current,
        reason: `${CHAIN_NAME} could not be selected: ${walletErrorMessage(error)}`,
      };
    }
  }

  try {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [WALLET_CHAIN_PARAMS],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch (error) {
    return {
      ok: false,
      chainId: await readChainId(provider),
      reason: `${CHAIN_NAME} could not be added: ${walletErrorMessage(error)}`,
    };
  }

  const afterAdd = await readChainId(provider);
  if (afterAdd === CHAIN_ID_HEX) return { ok: true, chainId: afterAdd, switched: true };
  return {
    ok: false,
    chainId: afterAdd,
    reason: `The wallet still reports ${describeChain(afterAdd)}.`,
  };
}
