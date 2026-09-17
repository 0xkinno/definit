/**
 * Runtime configuration.
 *
 * Nothing here decides anything about finality. It only tells the application
 * where to look. The chain remains the source of truth.
 */

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID ?? 61997);

export const CHAIN_NAME =
  process.env.NEXT_PUBLIC_GENLAYER_CHAIN_NAME ?? "GenLayer Studio Next";

export const RPC_URL =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio-dev.genlayer.com/api";

export const EXPLORER_URL =
  process.env.NEXT_PUBLIC_GENLAYER_EXPLORER_URL ?? "https://explorer-studio-dev.genlayer.com";

export const DECISION_GATE_ADDRESS = (
  process.env.NEXT_PUBLIC_DECISION_GATE_ADDRESS ?? ""
).trim();

export const FINALITY_VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_FINALITY_VAULT_ADDRESS ?? ""
).trim();

export const SCENARIO_REGISTRY_ADDRESS = (
  process.env.NEXT_PUBLIC_SCENARIO_REGISTRY_ADDRESS ?? ""
).trim();

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * LIVE means the application is wired to deployed contracts and will read and
 * write real chain state.
 *
 * REHEARSAL means it is not. In rehearsal the console walks the same state
 * machine locally and labels itself unmistakably. It never presents a
 * simulated transition as chain evidence.
 */
export type RuntimeMode = "live" | "rehearsal";

export const RUNTIME_MODE: RuntimeMode =
  isAddress(DECISION_GATE_ADDRESS) && isAddress(FINALITY_VAULT_ADDRESS)
    ? "live"
    : "rehearsal";

export const RUNTIME_MODE_LABEL =
  RUNTIME_MODE === "live" ? "Live contracts" : "Offline rehearsal";

export const RUNTIME_MODE_DETAIL =
  RUNTIME_MODE === "live"
    ? `Reading and writing ${CHAIN_NAME} (chain ${CHAIN_ID}).`
    : "No contract addresses are configured, so no chain state is being read. Every transition shown is a local replay of the same state machine, and nothing here counts as on-chain evidence.";

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_URL.replace(/\/$/, "")}/address/${address}`;
}

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL.replace(/\/$/, "")}/tx/${hash}`;
}
