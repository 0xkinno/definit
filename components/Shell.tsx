import Link from "next/link";

import { CHAIN_ID, CHAIN_NAME, RUNTIME_MODE, RUNTIME_MODE_LABEL } from "@/lib/config";
import { ConnectWallet } from "@/components/wallet/ConnectWallet";
import { classNames } from "@/lib/format";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/console", label: "Console" },
  { href: "/demo", label: "Lifecycle demo" },
  { href: "/actions", label: "Actions" },
  { href: "/lab", label: "Proof lab" },
  { href: "/proof", label: "Evidence" },
  { href: "/docs", label: "Docs" },
];

export function ModeBadge({ compact = false }: { compact?: boolean }) {
  const live = RUNTIME_MODE === "live";
  return (
    <span
      className={classNames(
        "chip",
        live ? "border-viridian-300 text-viridian-700" : "border-signal-amber text-signal-amber",
      )}
      title={
        live
          ? `Reading and writing ${CHAIN_NAME} (chain ${CHAIN_ID}).`
          : "No contract addresses configured. All transitions are a labelled local rehearsal."
      }
    >
      <span
        aria-hidden="true"
        className={classNames(
          "h-[7px] w-[7px] rounded-full",
          live ? "bg-viridian-500" : "bg-signal-amber",
        )}
      />
      {compact ? (live ? "Live" : "Rehearsal") : RUNTIME_MODE_LABEL}
    </span>
  );
}

export function SiteHeader() {
  return (
    <header className="no-print sticky top-0 z-40 border-b border-paper-300 bg-paper-50/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="font-display text-[19px] font-semibold tracking-tight">DEFINIT</span>
          <span className="hidden text-[11px] font-medium uppercase tracking-[0.18em] text-ink-500 sm:inline">
            finality engine
          </span>
        </Link>
        <nav aria-label="Primary" className="order-3 w-full sm:order-none sm:w-auto">
          <ul className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="inline-flex min-h-[36px] items-center rounded px-3 text-[13px] font-medium text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ModeBadge />
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="no-print mt-24 border-t border-paper-300 bg-paper-100/60">
      <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-3">
        <div>
          <p className="font-display text-[17px] font-semibold">DEFINIT</p>
          <p className="mt-2 max-w-[38ch] text-[13px] leading-relaxed text-ink-600">
            A finality firewall for autonomous agent actions. Accepted creates a provisional
            decision record; finalized creates the authority required for irreversible execution.
          </p>
        </div>
        <div>
          <p className="eyebrow">Network</p>
          <p className="mt-2 text-[13px] text-ink-600">
            {CHAIN_NAME}
            <br />
            Chain ID {CHAIN_ID}
          </p>
        </div>
        <div>
          <p className="eyebrow">Reproduce it</p>
          <ul className="mt-2 space-y-1 text-[13px] text-ink-600">
            <li>
              <Link className="link" href="/console">
                Run the protection console
              </Link>
            </li>
            <li>
              <Link className="link" href="/lab">
                Attack the invariant
              </Link>
            </li>
            <li>
              <Link className="link" href="/docs/PROOF">
                Read the proof document
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-paper-300 px-4 py-4 text-[12px] text-ink-500 sm:px-6">
        <div className="mx-auto max-w-[1240px]">
          Test assets only. Amounts are testnet GEN and every party named here is synthetic.
        </div>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
