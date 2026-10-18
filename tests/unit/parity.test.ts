/**
 * Parity: the TypeScript commitment module against vectors computed by the
 * Python restatement of the contracts' encoding (scripts/gen-parity-vectors.py).
 * Every vector must match byte for byte, so the interface cannot sign something
 * other than what the contracts hash.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { actionIdOf, DECISION_DOMAIN_V1, decisionIdOf, evidenceDigestOf, intentHashOf } from "@/lib/commitments/commitment";

const corpus = JSON.parse(readFileSync("tests/v1/fixtures/parity-vectors.json", "utf8")) as { vectors: Array<Record<string, any>> };

describe(`parity with the contracts' encoding (${corpus.vectors.length} vectors)`, () => {
  it("is not empty", () => expect(corpus.vectors.length).toBeGreaterThanOrEqual(200));

  it("derives the same evidence digest", () => {
    for (const v of corpus.vectors) expect(evidenceDigestOf(v.evidence)).toBe(v.evidenceDigest);
  });

  it("derives the same intent hash", () => {
    for (const v of corpus.vectors) {
      expect(intentHashOf({ agent: v.agent, recipient: v.recipient, amount: v.amount, asset: v.asset, policyHash: v.policyHash, evidenceDigest: v.evidenceDigest, nonce: v.nonce, deadlineUnix: v.deadlineUnix })).toBe(v.intentHash);
    }
  });

  it("derives the same action id", () => {
    for (const v of corpus.vectors) {
      expect(actionIdOf({ agent: v.agent, recipient: v.recipient, amount: v.amount, asset: v.asset, policyHash: v.policyHash, nonce: v.nonce, createdAt: v.createdAt })).toBe(v.actionId);
    }
  });

  it("derives the same decision id under the milestone domain", () => {
    for (const v of corpus.vectors) {
      expect(decisionIdOf({ actionId: v.actionId, attempt: v.attempt, intentHash: v.intentHash, adjudicatedAt: v.adjudicatedAt }, DECISION_DOMAIN_V1)).toBe(v.decisionId);
    }
  });
});
