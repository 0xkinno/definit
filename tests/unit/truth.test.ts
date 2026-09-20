/**
 * Truth regressions.
 *
 * These do not test the protocol. They test the three ways this repository has
 * already managed to mislead a reader, so that a future edit has to break a
 * test rather than quietly ship a contradiction:
 *
 *   1. a screen that offers an action the deployment cannot perform;
 *   2. a document that states a case count which the corpus contradicts;
 *   3. a public document that describes a mechanism the code does not have.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { caseCountsFrom, countsAgree, describeCounts, observedCounts } from "@/lib/guard/counts";
import { liveActionsEnabled, signingState } from "@/lib/runtime/signing";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readJson(relative: string): unknown {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, relative), "utf8").replace(/^\uFEFF/, ""));
}

function readText(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), "utf8").replace(/^\uFEFF/, "");
}

// ----------------------------------------------------------------- capabilities

describe("signing state", () => {
  it("offers the wallet pathway when a wallet is ready, whatever the operator can do", () => {
    const withOperator = signingState({ walletReady: true, operatorSigning: true });
    const withoutOperator = signingState({ walletReady: true, operatorSigning: false });

    for (const state of [withOperator, withoutOperator]) {
      expect(state.key).toBe("wallet");
      expect(state.title).toBe("Ready to sign");
      expect(state.liveActionsEnabled).toBe(true);
      expect(state.detail).toContain("connected wallet");
    }
  });

  it("offers the operator pathway only when the deployment really holds a signer", () => {
    const state = signingState({ walletReady: false, operatorSigning: true });
    expect(state.key).toBe("operator");
    expect(state.title).toBe("Operator signing active");
    expect(state.liveActionsEnabled).toBe(true);
    expect(state.detail).toContain("operator will sign");
  });

  it("refuses to offer any pathway when there is neither a wallet nor a signer", () => {
    const state = signingState({ walletReady: false, operatorSigning: false });
    expect(state.key).toBe("wallet-required");
    expect(state.title).toBe("Wallet required for live actions");
    expect(state.liveActionsEnabled).toBe(false);
    expect(state.disabledLabel).toBe("Connect wallet to run");
    expect(state.detail).toContain("does not hold a signing key");
    expect(state.detail).toContain("replay the recorded on-chain run");
  });

  it("never describes the operator as a fallback for a visitor who declined a popup", () => {
    // A declined popup is a wallet-ready session whose write failed. The signing
    // policy is computed from the wallet handle, not from the last error, so a
    // refusal cannot silently re-route the step to somebody else's key.
    const afterRefusal = signingState({ walletReady: true, operatorSigning: true });
    expect(afterRefusal.key).toBe("wallet");
    expect(afterRefusal.pathwayLabel).not.toContain("operator");

    expect(liveActionsEnabled({ walletReady: true, operatorSigning: false })).toBe(true);
    expect(liveActionsEnabled({ walletReady: false, operatorSigning: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------- counts

describe("case counts", () => {
  const corpus = readJson("tests/fixtures/cases.json") as {
    cases: Array<{ expected: string }>;
  };
  const report = readJson("docs/evidence/proof-report.json") as {
    caseCounts: { total: number; releaseExpected: number; refusalExpected: number };
    metrics: { totalCases: number; passing: number };
    cases: Array<{ actual: string; expected: string; outcome: string }>;
  };

  it("derives the generated counts from the corpus", () => {
    expect(countsAgree(report.caseCounts, caseCountsFrom(corpus.cases))).toBe(true);
  });

  it("agrees with what the run observed", () => {
    const observed = observedCounts(
      report.cases.map((row) => ({ actual: row.actual })),
      (row) => row.actual === "released",
    );
    expect(countsAgree(report.caseCounts, observed)).toBe(true);
  });

  it("counts every case in the report", () => {
    expect(report.metrics.totalCases).toBe(corpus.cases.length);
    expect(report.cases.length).toBe(corpus.cases.length);
    expect(report.metrics.passing).toBe(corpus.cases.length);
  });

  it("names both classes in one sentence, so a screen cannot quote half of it", () => {
    const text = describeCounts(report.caseCounts);
    expect(text).toContain(`${report.caseCounts.total} cases`);
    expect(text).toContain(`${report.caseCounts.refusalExpected} refusal cases`);
    expect(text).toContain(`${report.caseCounts.releaseExpected} release cases`);
  });
});

// ------------------------------------------------------------------ documents

describe("public documents", () => {
  const DOCS = ["README.md", "docs/PROOF.md", "docs/EVIDENCE.md", "docs/LIMITATIONS.md"];

  it("does not hard-code a case count in prose", () => {
    const pattern =
      /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\s+(?:release\s+|refusal\s+)?cases?\b/i;
    for (const relative of DOCS) {
      const match = pattern.exec(readText(relative));
      expect(match?.[0] ?? null, `${relative} states a case count`).toBe(null);
    }
  });

  const SHIPPED_COPY = [
    "app/page.tsx",
    "components/landing/BoundaryToggle.tsx",
    "lib/demo/rehearsal.ts",
  ];

  it("does not describe the release boundary as a final-scope read", () => {
    const stale = [
      "re-reads this contract's FINAL storage state",
      "read that capability from final storage state",
      "This is the only authority the vault accepts",
      "cannot observe a decision that has only reached the provisional stage",
      "can only see a decision that has already settled into consensus",
      "invisible to anyone reading final state",
      "visible to a final-scope read",
      "Only a final-scope read can see",
    ];
    for (const relative of [...DOCS, ...SHIPPED_COPY]) {
      const text = readText(relative);
      for (const phrase of stale) {
        expect(text.includes(phrase), `${relative} still says: ${phrase}`).toBe(false);
      }
    }
  });

  it("does not offer an operator fallback that the deployment does not have", () => {
    for (const relative of [...DOCS, "components/demo/LifecycleDemo.tsx", "components/console/ConsoleBoard.tsx"]) {
      expect(readText(relative).includes("Operator fallback active"), relative).toBe(false);
    }
  });

  it("names one production URL", () => {
    const hosts = new Set<string>();
    for (const relative of [...DOCS, "TASK.md"]) {
      const text = readText(relative);
      for (const match of text.matchAll(/https:\/\/[A-Za-z0-9.-]*vercel\.app[^\s)\]"'`*]*/g)) {
        hosts.add(new URL(match[0]).host);
      }
    }
    expect([...hosts]).toHaveLength(1);
  });
});
