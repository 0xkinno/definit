/**
 * EIP-1193 wallet access.
 *
 * This module knows how to find a browser wallet and how to talk to it. It
 * knows nothing about DEFINIT, and it holds no state: every function takes the
 * provider it should use. That keeps it testable and keeps wallet handling out
 * of the visual components.
 *
 * The provider is the only thing that ever sees a key. DEFINIT never asks for
 * one, never stores one in the browser, and never sends one to the server.
 */

export interface Eip1193RequestArguments {
  method: string;
  params?: readonly unknown[] | object;
}

export interface Eip1193Provider {
  request(args: Eip1193RequestArguments): Promise<unknown>;
  on?(event: string, listener: (...args: never[]) => void): void;
  removeListener?(event: string, listener: (...args: never[]) => void): void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  isRabby?: boolean;
  providers?: Eip1193Provider[];
}

/** Wallet-standard error codes, named so callers do not compare magic numbers. */
export const WALLET_ERROR = {
  userRejected: 4001,
  chainNotAdded: 4902,
  /** The wallet already has a request open. Nothing may be asked until it is answered. */
  alreadyPending: -32002,
  /** The wallet does not implement the method at all. */
  unsupportedMethod: -32601,
  disconnected: 4900,
  chainDisconnected: 4901,
} as const;

function numeric(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/**
 * Read a wallet error code.
 *
 * Wallets disagree about where the code lives. MetaMask and several others
 * report the useful code on the top-level error, some wrap it in `data`, and
 * some nest it again under `data.originalError`. All three shapes are read so
 * that a refusal is never mistaken for an unknown chain, and an unknown chain
 * is never mistaken for a refusal.
 */
export function walletErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const record = error as { code?: unknown; data?: unknown };
  const direct = numeric(record.code);
  if (direct !== null) return direct;

  const data = record.data;
  if (data && typeof data === "object") {
    const nested = numeric((data as { code?: unknown }).code);
    if (nested !== null) return nested;
    const original = (data as { originalError?: unknown }).originalError;
    if (original && typeof original === "object") {
      const deep = numeric((original as { code?: unknown }).code);
      if (deep !== null) return deep;
    }
  }
  return null;
}

export function walletErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}

/**
 * Resolve the wallet to use.
 *
 * When several wallets have installed themselves into the same page they
 * advertise a `providers` array, which is how a user with more than one
 * extension still gets the one they expect rather than whichever loaded last.
 */
export function injectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  const injected = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;
  if (!injected) return null;

  const announced = injected.providers;
  if (Array.isArray(announced) && announced.length > 0) {
    return (
      announced.find((candidate) => candidate.isMetaMask) ??
      announced.find((candidate) => candidate.isRabby) ??
      announced[0]
    );
  }
  return injected;
}

export function providerName(provider: Eip1193Provider | null): string {
  if (!provider) return "browser wallet";
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isRabby) return "Rabby";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isBraveWallet) return "Brave Wallet";
  return "browser wallet";
}

export const NO_WALLET_DETECTED =
  "No browser wallet answered. Install a wallet that supports custom EVM networks, then reload this page.";

/** Read an account list without prompting. Used to resume a session silently. */
export async function readAccounts(provider: Eip1193Provider): Promise<string[]> {
  try {
    const accounts = await provider.request({ method: "eth_accounts" });
    return Array.isArray(accounts) ? accounts.map(String) : [];
  } catch {
    return [];
  }
}

/** Ask the wallet to connect. This is the call that raises the popup. */
export async function requestAccounts(provider: Eip1193Provider): Promise<string[]> {
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  return Array.isArray(accounts) ? accounts.map(String) : [];
}

export async function readChainId(provider: Eip1193Provider): Promise<string | null> {
  try {
    const value = await provider.request({ method: "eth_chainId" });
    return typeof value === "string" ? value.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function subscribe(
  provider: Eip1193Provider,
  event: "accountsChanged" | "chainChanged" | "disconnect",
  listener: (...args: never[]) => void,
): () => void {
  provider.on?.(event, listener);
  return () => provider.removeListener?.(event, listener);
}
