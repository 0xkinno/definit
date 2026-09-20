"use client";

/**
 * Wallet session state.
 *
 * One place holds the connection, and every component reads it from here. The
 * rules this follows, in order of importance:
 *
 *   1. Connecting is always the user's action. The only thing that ever runs
 *      unprompted is `eth_accounts`, which reports a session the user already
 *      granted and raises no popup.
 *   2. A wallet is only usable when it is on the chain this application signs
 *      for. Everything else is reported as a state, not hidden.
 *   3. Disconnecting forgets the session locally. A browser wallet has no
 *      revoke call, and pretending otherwise would be a lie.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CHAIN_ID, CHAIN_NAME } from "@/lib/config";
import { alignChain, describeChain, type ChainOutcome } from "@/lib/wallet/chain";
import { createWalletClient, readBalance, type WalletGenLayerClient } from "@/lib/wallet/client";
import {
  NO_WALLET_DETECTED,
  injectedProvider,
  providerName,
  readAccounts,
  requestAccounts,
  readChainId,
  subscribe,
  walletErrorCode,
  walletErrorMessage,
  WALLET_ERROR,
  type Eip1193Provider,
} from "@/lib/wallet/eip1193";

export type WalletPhase =
  | "detecting"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong-network";

export interface WalletHandle {
  /** Non-null only when a wallet is connected and on the expected chain. */
  client: WalletGenLayerClient | null;
  provider: Eip1193Provider | null;
  address: string | null;
}

export interface WalletState {
  phase: WalletPhase;
  address: string | null;
  chainId: string | null;
  balanceWei: bigint | null;
  walletName: string;
  error: string | null;
  notice: string | null;
  /** True when a wallet is connected, on this chain, and ready to sign. */
  ready: boolean;
  onExpectedChain: boolean;
}

export interface WalletActions {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<ChainOutcome>;
  refresh: () => Promise<void>;
}

const STORAGE_KEY = "definit.wallet.v1";

function remembered(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "connected";
  } catch {
    return false;
  }
}

function remember(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, "connected");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* a browser that refuses storage still gets a working session */
  }
}

const EXPECTED_CHAIN_ID = `0x${CHAIN_ID.toString(16)}`;

const WalletContext = createContext<(WalletState & WalletActions & { handle: WalletHandle }) | null>(
  null,
);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<WalletPhase>("detecting");
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const providerRef = useRef<Eip1193Provider | null>(null);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  /** The last wrong network the wallet was offered, so it is offered once. */
  const offeredFor = useRef<string | null>(null);

  const applyChain = useCallback(async (outcome: ChainOutcome) => {
    if (outcome.ok) {
      setChainId(outcome.chainId);
      setPhase("connected");
      if (outcome.switched) {
        setNotice(
          outcome.added
            ? `Added ${CHAIN_NAME} to the wallet and switched to it.`
            : `Switched to ${CHAIN_NAME}.`,
        );
      }
      return true;
    }
    setChainId(outcome.chainId);
    setPhase("wrong-network");
    setNotice(outcome.reason);
    return false;
  }, []);

  const loadBalance = useCallback(async (wallet: Eip1193Provider, account: string) => {
    setBalanceWei(await readBalance(wallet, account));
  }, []);

  /**
   * Resume without prompting.
   *
   * `eth_accounts` reports accounts the user has already authorised. If it
   * returns one, the session is real and may be re-established silently.
   */
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const wallet = injectedProvider();
      if (!wallet) {
        if (!cancelled) {
          setPhase("unavailable");
          setError(NO_WALLET_DETECTED);
        }
        return;
      }
      providerRef.current = wallet;
      setProvider(wallet);

      const accounts = await readAccounts(wallet);
      if (cancelled) return;
      if (accounts.length === 0) {
        setPhase("disconnected");
        return;
      }

      setAddress(accounts[0]);
      setPhase("connecting");
      const outcome = await alignChain(wallet);
      if (cancelled) return;
      const usable = await applyChain(outcome);
      if (usable) await loadBalance(wallet, accounts[0]);
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [applyChain, loadBalance]);

  /** Follow the wallet when the user changes account or network outside the app. */
  useEffect(() => {
    const wallet = provider;
    if (!wallet) return undefined;

    const offAccounts = subscribe(wallet, "accountsChanged", ((accounts: unknown) => {
      const list = Array.isArray(accounts) ? accounts.map(String) : [];
      if (list.length === 0) {
        remember(false);
        setAddress(null);
        setBalanceWei(null);
        setNotice("The wallet disconnected this site.");
        setPhase("disconnected");
        return;
      }
      setAddress(list[0]);
      void loadBalance(wallet, list[0]);
    }) as never);

    const offChain = subscribe(wallet, "chainChanged", ((next: unknown) => {
      const value = typeof next === "string" ? next.toLowerCase() : null;
      setChainId(value);

      if (value === EXPECTED_CHAIN_ID) {
        offeredFor.current = null;
        setPhase("connected");
        setNotice(null);
        return;
      }

      setPhase("wrong-network");
      setNotice(`The wallet moved to ${describeChain(value)}. Offering ${CHAIN_NAME}...`);

      // Offer the network once per destination. The wallet is asked to switch,
      // and then to add the chain if it has never seen it, so the user is never
      // left on the wrong network with a value to go and type in themselves.
      if (offeredFor.current === value) return;
      offeredFor.current = value;
      void (async () => {
        const outcome = await alignChain(wallet);
        await applyChain(outcome);
        if (address) await loadBalance(wallet, address);
      })();
    }) as never);

    return () => {
      offAccounts();
      offChain();
    };
  }, [provider, address, applyChain, loadBalance]);

  const connect = useCallback(async () => {
    const wallet = providerRef.current ?? injectedProvider();
    if (!wallet) {
      setPhase("unavailable");
      setError(NO_WALLET_DETECTED);
      return;
    }
    providerRef.current = wallet;
    setProvider(wallet);
    setPhase("connecting");
    setError(null);
    setNotice(null);

    try {
      const accounts = await requestAccounts(wallet);
      if (accounts.length === 0) {
        setPhase("disconnected");
        setError("The wallet returned no account, so nothing was connected.");
        return;
      }
      setAddress(accounts[0]);
      remember(true);
      const outcome = await alignChain(wallet);
      const usable = await applyChain(outcome);
      if (usable) await loadBalance(wallet, accounts[0]);
    } catch (caught) {
      const code = walletErrorCode(caught);
      setPhase("disconnected");
      setError(
        code === WALLET_ERROR.alreadyPending
          ? "The wallet already has a connection request open. Answer it there."
          : code === WALLET_ERROR.userRejected
            ? "The connection was declined in the wallet."
            : walletErrorMessage(caught),
      );
    }
  }, [applyChain, loadBalance]);

  const disconnect = useCallback(() => {
    remember(false);
    setAddress(null);
    setBalanceWei(null);
    setNotice("Session cleared in this browser. The wallet itself was not changed.");
    setPhase(providerRef.current ? "disconnected" : "unavailable");
  }, []);

  const switchNetwork = useCallback(async () => {
    const wallet = providerRef.current;
    if (!wallet) {
      const noWallet: ChainOutcome = {
        ok: false,
        chainId: null,
        declined: false,
        reason: NO_WALLET_DETECTED,
      };
      return noWallet;
    }
    setNotice(null);
    const outcome = await alignChain(wallet);
    const usable = await applyChain(outcome);
    if (usable && address) await loadBalance(wallet, address);
    return outcome;
  }, [address, applyChain, loadBalance]);

  const refresh = useCallback(async () => {
    const wallet = providerRef.current;
    if (!wallet || !address) return;
    const [accounts, current] = await Promise.all([readAccounts(wallet), readChainId(wallet)]);
    setChainId(current);
    setPhase(current === EXPECTED_CHAIN_ID ? "connected" : "wrong-network");
    if (accounts.length > 0) await loadBalance(wallet, accounts[0]);
  }, [address, loadBalance]);

  const handle = useMemo<WalletHandle>(() => {
    const usable = phase === "connected" && address !== null && provider !== null;
    return {
      client: usable ? createWalletClient(address, provider) : null,
      provider,
      address: usable ? address : null,
    };
  }, [phase, address, provider]);

  const value = useMemo(
    () => ({
      phase,
      address,
      chainId,
      balanceWei,
      walletName: providerName(provider),
      error,
      notice,
      ready: handle.client !== null,
      onExpectedChain: chainId === EXPECTED_CHAIN_ID,
      connect,
      disconnect,
      switchNetwork,
      refresh,
      handle,
    }),
    [
      phase,
      address,
      chainId,
      balanceWei,
      provider,
      error,
      notice,
      handle,
      connect,
      disconnect,
      switchNetwork,
      refresh,
    ],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used inside WalletProvider.");
  }
  return context;
}
