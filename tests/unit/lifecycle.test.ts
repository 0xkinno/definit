/**
 * The mapping from network state to product state.
 *
 * The safety of the whole application rests on one rule living in exactly one
 * place: a decided-but-not-final transaction is never permission to act.
 */

import { describe, expect, it } from "vitest";

import { toDefinitLifecycle } from "@/lib/lifecycle/map";
import { LIFECYCLE, LIFECYCLE_ORDER } from "@/lib/lifecycle/state";

describe("network state becomes product state", () => {
  it("never treats an accepted transaction as final", () => {
    const reading = toDefinitLifecycle({ txStatus: "ACCEPTED" });
    expect(reading.state).not.toBe("finalized");
    expect(reading.state).not.toBe("settled");
  });

  it("maps a finalized transaction to a final product state", () => {
    const reading = toDefinitLifecycle({
      txStatus: "FINALIZED",
      contractState: "FINALIZED",
    });
    expect(reading.state).toBe("finalized");
  });

  it("keeps an accepted decision provisional", () => {
    const reading = toDefinitLifecycle({ contractState: "ACCEPTED" });
    expect(reading.state).not.toBe("finalized");
    expect(reading.state).not.toBe("settled");
  });

  it("treats a validator timeout as unresolved, never as failure", () => {
    const reading = toDefinitLifecycle({ txStatus: "VALIDATORS_TIMEOUT" });
    expect(reading.unresolved).toBe(true);
  });

  it("never reads an empty record as a settlement", () => {
    const reading = toDefinitLifecycle({});
    expect(reading.state).toBe("draft");
    expect(reading.state).not.toBe("settled");
    expect(reading.unresolved).toBe(false);
  });

  it("treats an uninitialised transaction as unresolved", () => {
    const reading = toDefinitLifecycle({ txStatus: "UNINITIALIZED" });
    expect(reading.state).toBe("proposing");
    expect(reading.unresolved).toBe(true);
  });

  it("reports a settlement as settled", () => {
    const reading = toDefinitLifecycle({ contractState: "SETTLED", settled: true });
    expect(reading.state).toBe("settled");
  });

  it("reports a rejected judgement as rejected, not as a failure", () => {
    const reading = toDefinitLifecycle({ contractState: "REJECTED" });
    expect(reading.state).toBe("rejected");
    expect(reading.unresolved).toBe(false);
  });
});

describe("the product vocabulary", () => {
  it("has a descriptor for every lifecycle state", () => {
    for (const state of LIFECYCLE_ORDER) {
      expect(LIFECYCLE[state]).toBeDefined();
      expect(LIFECYCLE[state].label.length).toBeGreaterThan(0);
    }
  });

  it("places settlement after finalization", () => {
    expect(LIFECYCLE_ORDER.indexOf("settled")).toBeGreaterThan(
      LIFECYCLE_ORDER.indexOf("finalized"),
    );
  });
});
