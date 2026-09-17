/**
 * The commitment payload.
 *
 * The contract derives its commitment from a canonical byte string and the
 * vault compares what it stored against what the decision contract recorded.
 * If the TypeScript mirror drifts from the contract's payload, the interface
 * starts lying about what it is signing -- so the exact string is asserted
 * here, field by field.
 */

import { describe, expect, it } from "vitest";

import {
  COMMITMENT_DOMAIN,
  commitmentPayload,
  evidenceDigestOf,
  intentHashOf,
  policyHashOf,
} from "@/lib/commitments/commitment";

const FIELDS = {
  agent: "0x00000000000000000000000000000000000000c1",
  recipient: "0x00000000000000000000000000000000000000d1",
  amount: 10,
  asset: "GEN",
  policyHash: "0x" + "11".repeat(32),
  evidenceDigest: "0x" + "33".repeat(32),
  nonce: 7,
  deadlineUnix: 4_000_000_000,
};

describe("the canonical commitment payload", () => {
  it("is the exact string the contracts hash", () => {
    expect(commitmentPayload(FIELDS)).toBe(
      [
        "DEFINIT-COMMITMENT-v1",
        "agent=0x00000000000000000000000000000000000000c1",
        "recipient=0x00000000000000000000000000000000000000d1",
        "amount=10",
        "asset=GEN",
        "policy_hash=0x" + "11".repeat(32),
        "evidence_digest=0x" + "33".repeat(32),
        "nonce=7",
        "deadline=4000000000",
      ].join("|"),
    );
  });

  it("uses the documented domain tag", () => {
    expect(COMMITMENT_DOMAIN).toBe("DEFINIT-COMMITMENT-v1");
    expect(commitmentPayload(FIELDS).startsWith(COMMITMENT_DOMAIN + "|")).toBe(true);
  });

  it("changes when any single field changes", () => {
    const baseline = commitmentPayload(FIELDS);
    const mutations = [
      { ...FIELDS, amount: 11 },
      { ...FIELDS, nonce: 8 },
      { ...FIELDS, asset: "OTHER" },
      { ...FIELDS, recipient: "0x00000000000000000000000000000000000000d2" },
      { ...FIELDS, policyHash: "0x" + "22".repeat(32) },
      { ...FIELDS, evidenceDigest: "0x" + "44".repeat(32) },
      { ...FIELDS, deadlineUnix: 4_000_000_001 },
    ];
    for (const mutation of mutations) {
      expect(commitmentPayload(mutation)).not.toBe(baseline);
    }
  });
});

describe("the derived hashes", () => {
  it("returns 32-byte hex digests", () => {
    for (const value of [intentHashOf(FIELDS), policyHashOf("text"), evidenceDigestOf("body")]) {
      expect(value).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("is stable for identical input and different for different input", () => {
    expect(policyHashOf("a")).toBe(policyHashOf("a"));
    expect(policyHashOf("a")).not.toBe(policyHashOf("b"));
    expect(evidenceDigestOf("body")).not.toBe(evidenceDigestOf("different body"));
    // Whitespace is collapsed before hashing, by design: a cosmetic difference
    // in the snapshot must not change the digest of what was judged.
    expect(evidenceDigestOf("body   ")).toBe(evidenceDigestOf("body"));
    expect(evidenceDigestOf("  body\n")).toBe(evidenceDigestOf("body"));
  });
});
