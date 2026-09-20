/**
 * Runtime capabilities.
 *
 * One place decides what this deployment can actually do. No screen guesses,
 * and no two screens can disagree about it.
 *
 * This module reads server-only configuration, so it may only be imported from
 * a server component or a route handler. Client components receive the result
 * as props. Nothing secret is ever part of the shape it returns: the public
 * form carries booleans and public network metadata, and nothing else.
 *
 * The problem this exists to solve: a deployment that holds no signing key must
 * never tell a visitor that an operator will sign for them. A screen that says
 * "operator fallback active" over a route that answers "server signing is
 * disabled" is the exact contradiction this module removes.
 */

import { CHAIN_ID, CHAIN_NAME, EXPLORER_URL, RPC_URL, RUNTIME_MODE } from "@/lib/config";
import { loadLiveLifecycle } from "@/lib/evidence";
import { signerStatus } from "@/lib/server/signer";

/** Public network metadata. Safe to render, safe to serialise. */
export interface NetworkDescriptor {
  name: string;
  chainId: number;
  rpc: string;
  explorer: string;
}

export interface RuntimeCapabilities {
  /** Contract addresses are configured and chain state is read for real. */
  liveContracts: boolean;
  /** A visitor can sign every state-changing step from their own browser. */
  browserWalletSigning: boolean;
  /** This host holds a signing key and can sign on a visitor's behalf. */
  operatorSigning: boolean;
  /**
   * Why operator signing is off. Server-side detail, and it names the flag that
   * turns it on, so it is not part of the public payload. It never contains a
   * key: the signer module reports presence, never value.
   */
  operatorSigningReason: string | null;
  /** A recorded run exists in this checkout and can be replayed. */
  recordedReplay: boolean;
  runtimeMode: "live" | "rehearsal";
  network: NetworkDescriptor;
}

/**
 * The subset that leaves the server.
 *
 * Same booleans, a neutral explanation in place of the operator flag name, and
 * public network metadata. No environment value is echoed back.
 */
export interface PublicCapabilities {
  liveContracts: boolean;
  browserWalletSigning: boolean;
  operatorSigning: boolean;
  operatorSigningDetail: string | null;
  recordedReplay: boolean;
  runtimeMode: "live" | "rehearsal";
  network: NetworkDescriptor;
}

export function networkDescriptor(): NetworkDescriptor {
  return {
    name: CHAIN_NAME,
    chainId: CHAIN_ID,
    rpc: RPC_URL,
    explorer: EXPLORER_URL,
  };
}

/**
 * Resolve what this process can do right now.
 *
 * `recordedReplay` is not an assumption: the evidence record is looked for on
 * disk, because a replay button that opens an empty panel is the same class of
 * lie as a write button that cannot write.
 */
export async function runtimeCapabilities(): Promise<RuntimeCapabilities> {
  const signer = signerStatus();
  const lifecycle = await loadLiveLifecycle();
  const live = RUNTIME_MODE === "live";
  const operatorSigning = live && signer.enabled;

  return {
    liveContracts: live,
    browserWalletSigning: true,
    operatorSigning,
    operatorSigningReason: operatorSigning ? null : (signer.reason ?? null),
    recordedReplay: lifecycle.available && lifecycle.record !== null,
    runtimeMode: RUNTIME_MODE,
    network: networkDescriptor(),
  };
}

export const OPERATOR_DISABLED_DETAIL =
  "This deployment does not hold a signing key.";

export function toPublicCapabilities(capabilities: RuntimeCapabilities): PublicCapabilities {
  return {
    liveContracts: capabilities.liveContracts,
    browserWalletSigning: capabilities.browserWalletSigning,
    operatorSigning: capabilities.operatorSigning,
    operatorSigningDetail: capabilities.operatorSigning ? null : OPERATOR_DISABLED_DETAIL,
    recordedReplay: capabilities.recordedReplay,
    runtimeMode: capabilities.runtimeMode,
    network: capabilities.network,
  };
}

export async function publicCapabilities(): Promise<PublicCapabilities> {
  return toPublicCapabilities(await runtimeCapabilities());
}
