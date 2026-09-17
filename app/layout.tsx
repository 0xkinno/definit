import type { Metadata, Viewport } from "next";

import "./globals.css";
import { WalletProvider } from "@/lib/wallet/provider";

export const metadata: Metadata = {
  title: "DEFINIT -- finality-gated autonomous execution",
  description:
    "DEFINIT stops autonomous agents from paying, releasing or executing against a GenLayer judgment that can still be appealed.",
  applicationName: "DEFINIT",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "DEFINIT",
    description:
      "The agent can be right and still be too early to act. DEFINIT makes irreversible effects wait for finality.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FBF8F2",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink-900 focus:px-4 focus:py-3 focus:text-paper-0"
        >
          Skip to content
        </a>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
