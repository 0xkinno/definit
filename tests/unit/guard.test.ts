/**
 * The corpus, asserted case by case.
 *
 * The proof report is generated from the same corpus; these tests exist so a
 * single case can fail loudly in isolation, with the invariant it protects
 * written next to it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import { buildCase, runCorpus } from "@/lib/guard/corpus";
import { guardedSettle } from "@/lib/guard/finality";
import { unsafeRelease } from "@/lib/guard/baseline";

const corpusPath = path.join(process.cwd(), "tests", "fixtures", "cases.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
  cases: Array<{
    id: string;
    title: string;
    invariant: string;
    expected: "SETTLE" | "REFUSE";
    expectedCode: string | null;
  }>;
};

describe("the settlement corpus", () => {
  it("has a release case for every refusal case that matters", () => {
    const refusals = corpus.cases.filter((entry) => entry.expected === "REFUSE");
    const releases = corpus.cases.filter((entry) => entry.expected === "SETTLE");
    expect(refusals.length).toBeGreaterThan(0);
    expect(releases.length).toBeGreaterThan(0);
  });

  for (const entry of corpus.cases) {
    it(`${entry.id}: ${entry.invariant}`, () => {
      const scenario = buildCase(entry.id);
      const result = guardedSettle(scenario.world, scenario.caller, scenario.claim);

      if (entry.expected === "SETTLE") {
        expect(result.released).toBe(true);
        expect(result.boundToFinal).toBe(true);
        expect(result.matchedCommitment).toBe(true);
      } else {
        expect(result.released).toBe(false);
        expect(result.code).toBe(entry.expectedCode);
      }
    });
  }
});

describe("the provisional-scope baseline", () => {
  it("releases against a decision that is still appealable", () => {
    const scenario = buildCase("accepted-not-final");
    const result = unsafeRelease(scenario.world, scenario.caller, scenario.claim);
    expect(result.released).toBe(true);
    expect(result.appealableAtRequest).toBe(true);
  });

  it("accepts a substituted beneficiary", () => {
    const scenario = buildCase("wrong-recipient");
    const result = unsafeRelease(scenario.world, scenario.caller, scenario.claim);
    expect(result.released).toBe(true);
  });
});

describe("the intervention", () => {
  it("refuses a substituted beneficiary even when the decision is final", () => {
    const scenario = buildCase("wrong-recipient");
    const result = guardedSettle(scenario.world, scenario.caller, scenario.claim);
    expect(result.released).toBe(false);
    expect(result.code).toBe("COMMITMENT_MISMATCH");
  });

  it("refuses a caller that is not the decision contract or the funder", () => {
    const scenario = buildCase("valid-finalization");
    const result = guardedSettle(
      scenario.world,
      "0x00000000000000000000000000000000000000ff",
      scenario.claim,
    );
    expect(result.released).toBe(false);
    expect(result.code).toBe("UNAUTHORIZED_CALLER");
  });

  it("spends a commitment at most once", () => {
    // The first delivery releases and consumes the nonce; the second delivery
    // of the identical instruction is refused. This is the state transition
    // the contract performs, replayed twice against the same world.
    const scenario = buildCase("valid-finalization");
    const first = guardedSettle(scenario.world, scenario.caller, scenario.claim);
    const second = guardedSettle(scenario.world, scenario.caller, scenario.claim);
    expect(first.released).toBe(true);
    expect(second.released).toBe(false);
    expect(second.code).toBe("ALREADY_SETTLED");
  });

  it("refuses a redelivered instruction whose nonce is already spent", () => {
    const scenario = buildCase("duplicate-message");
    const result = guardedSettle(scenario.world, scenario.caller, scenario.claim);
    expect(result.released).toBe(false);
    expect(result.code).toBe("REPLAY_BLOCKED");
  });
});

describe("the generated report agrees with the corpus", () => {
  it("passes every case and the negative control", () => {
    const report = runCorpus(corpus.cases);
    expect(report.metrics.passing).toBe(corpus.cases.length);
    expect(report.control.outcome).toBe("PASS");
  });

  it("records no provisional settlement in the intervention arm", () => {
    const report = runCorpus(corpus.cases);
    const intervention = report.arms.find((arm) => arm.id === "intervention");
    expect(intervention?.settlementsFromProvisional).toBe(0);
  });

  it("records provisional settlements in the baseline arm", () => {
    const report = runCorpus(corpus.cases);
    const baseline = report.arms.find((arm) => arm.id === "baseline");
    expect(baseline?.settlementsFromProvisional ?? 0).toBeGreaterThan(0);
  });
});
