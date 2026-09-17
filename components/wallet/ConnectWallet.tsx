"use client";

/**
 * The wallet control in the site header.
 *
 * It reports exactly what is true: whether a wallet answered, which account is
 * connected, which network it is on, and whether that network is the one this
 * application signs for. Nothing is hidden behind a spinner.
 */

import { useEffect, useRef, useState } from "react";

import { classNames, middleTruncate } from "@/lib/format";
import { CHAIN_NAME } from "@/lib/config";
import { useWallet } from "@/lib/wallet/provider";

function formatGen(wei: bigint | null): string {
  if (wei === null) return "--";
  const value = Number(wei) / 1e18;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })} GEN`;
}

export function ConnectWallet({ compact = false }: { compact?: boolean }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = (event: MouseEvent) => {
      if (container.current && !container.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const connected = wallet.phase === "connected";
  const needsNetwork = wallet.phase === "wrong-network";

  const label =
    wallet.phase === "detecting"
      ? "Checking wallet"
      : wallet.phase === "unavailable"
        ? "No wallet found"
        : connected
          ? middleTruncate(wallet.address ?? "", 6, 4)
          : needsNetwork
            ? "Wrong network"
            : wallet.phase === "connecting"
              ? "Connecting"
              : "Connect wallet";

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => (connected || needsNetwork ? setOpen((value) => !value) : void wallet.connect())}
        aria-expanded={connected || needsNetwork ? open : undefined}
        className={classNames(
          "btn btn-quiet px-3 text-[12px]",
          connected && "border-viridian-300 text-viridian-700",
          needsNetwork && "border-signal-amber text-signal-amber",
        )}
      >
        <span
          aria-hidden="true"
          className={classNames(
            "h-[7px] w-[7px] rounded-full",
            connected
              ? "bg-viridian-500"
              : needsNetwork
                ? "bg-signal-amber"
                : wallet.phase === "unavailable"
                  ? "bg-signal-rust"
                  : "bg-ink-300",
          )}
        />
        {compact ? label : <span className="hidden sm:inline">{label}</span>}
        {compact ? null : <span className="sm:hidden">Wallet</span>}
      </button>

      {open && (connected || needsNetwork) ? (
        <div className="absolute right-0 z-50 mt-2 w-[320px] rounded-lg border border-paper-300 bg-paper-0 p-4 shadow-raised">
          <p className="eyebrow">Wallet</p>
          <dl className="mt-3 space-y-2 text-[13px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">Provider</dt>
              <dd className="font-medium text-ink-800">{wallet.walletName}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">Account</dt>
              <dd className="font-mono text-[12px] text-ink-800">
                {middleTruncate(wallet.address ?? "", 8, 6)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">Balance</dt>
              <dd className="font-mono text-[12px] text-ink-800">{formatGen(wallet.balanceWei)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-500">Network</dt>
              <dd
                className={classNames(
                  "font-medium",
                  connected ? "text-viridian-700" : "text-signal-amber",
                )}
              >
                {connected ? CHAIN_NAME : "not the signing network"}
              </dd>
            </div>
          </dl>

          {wallet.notice ? (
            <p className="mt-3 rounded border border-signal-amber/40 bg-signal-ambersoft p-2 text-[12px] leading-relaxed text-ink-700">
              {wallet.notice}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {needsNetwork ? (
              <button type="button" className="btn btn-accent px-3 text-[12px]" onClick={() => void wallet.switchNetwork()}>
                Switch to {CHAIN_NAME}
              </button>
            ) : null}
            <button type="button" className="btn btn-ghost px-3 text-[12px]" onClick={() => void wallet.refresh()}>
              Refresh
            </button>
            <button type="button" className="btn btn-ghost px-3 text-[12px]" onClick={wallet.disconnect}>
              Disconnect
            </button>
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
            Disconnecting clears the session in this browser only. A browser wallet has no revoke
            call, so DEFINIT never claims to have one.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function WalletBanner() {
  const wallet = useWallet();
  if (wallet.phase === "unavailable") {
    return (
      <p className="rounded-md border border-signal-amber/40 bg-signal-ambersoft px-4 py-3 text-[13px] leading-relaxed text-ink-700">
        {wallet.error}
      </p>
    );
  }
  if (wallet.phase === "wrong-network") {
    return (
      <p className="rounded-md border border-signal-amber/40 bg-signal-ambersoft px-4 py-3 text-[13px] leading-relaxed text-ink-700">
        {wallet.notice ?? "The wallet is on the wrong network."}{" "}
        <button type="button" className="link" onClick={() => void wallet.switchNetwork()}>
          Switch network
        </button>
      </p>
    );
  }
  return null;
}
