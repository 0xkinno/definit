import { describe, expect, it } from "vitest";

import { contest, finalityOf, kitContext, mayExecute, openGuardedPayment, receipt, refund, settled, watchFinality } from "../src/index.ts";
import type { GuardContext, Lifecycle, WriteSpec } from "../src/index.ts";

const GATE = "0x" + "a1".repeat(20);
const VAULT = "0x" + "b2".repeat(20);

function fake(sequence: Lifecycle[], escrows: Array<Record<string, unknown>>, rec: Record<string, unknown> | null = null) {
  const writes: WriteSpec[] = [];
  let lc = 0;
  let es = 0;
  const ctx: GuardContext = {
    addresses: { gate: GATE, vault: VAULT },
    sender: "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
    async submit(spec) { writes.push(spec); return "0x" + String(writes.length).padStart(64, "0"); },
    async read(_a, method) {
      if (method === "list_actions_for") return [{ action_id: "0xaction" }];
      if (method === "get_action") return { policy_hash: "0xpolicy" };
      if (method === "get_escrow") return escrows[Math.min(es++, escrows.length - 1)];
      if (method === "get_receipt") return rec;
      throw new Error("unexpected read " + method);
    },
    async lifecycle() { return sequence[Math.min(lc++, sequence.length - 1)]; },
    async appeal() { return { charge: 5n, hash: "0xappeal" }; },
  };
  return { ctx, writes };
}

describe("finalityOf", () => {
  it("treats Accepted as a draft", () => {
    expect(finalityOf({ projectedStatus: "Accepted" })).toBe("wait");
    expect(mayExecute({ projectedStatus: "Accepted" })).toBe(false);
  });
  it("treats only Finalized as a fact", () => {
    expect(finalityOf({ projectedStatus: "Finalized" })).toBe("final");
    expect(mayExecute({ projectedStatus: "Finalized" })).toBe(true);
  });
  it("reports an appeal in progress as contested", () => {
    expect(finalityOf({ projectedStatus: "Accepted", decisionActive: true, resolutionAction: "Appeal" })).toBe("contested");
  });
  it("treats a cancelled or undetermined transaction as dead, never as final", () => {
    expect(finalityOf({ projectedStatus: "Canceled" })).toBe("dead");
    expect(mayExecute({ projectedStatus: "Undetermined" })).toBe(false);
  });
});

describe("watchFinality", () => {
  it("yields every snapshot and stops at Finalized", async () => {
    const seq: Lifecycle[] = [{ projectedStatus: "Pending" }, { projectedStatus: "Accepted" }, { projectedStatus: "Finalized" }, { projectedStatus: "Finalized" }];
    let i = 0;
    const seen: string[] = [];
    for await (const s of watchFinality(async () => seq[i++], "0xtx", { intervalMs: 1 })) seen.push(s.verdict);
    expect(seen).toEqual(["wait", "wait", "final"]);
  });
  it("honours an abort signal", async () => {
    const ac = new AbortController();
    ac.abort();
    const out: unknown[] = [];
    for await (const s of watchFinality(async () => ({ projectedStatus: "Accepted" }), "0xtx", { signal: ac.signal, intervalMs: 1 })) out.push(s);
    expect(out).toEqual([]);
  });
});

describe("openGuardedPayment", () => {
  it("proposes, funds with the exact amount, then asks for adjudication, in that order", async () => {
    const { ctx, writes } = fake([], [{ state: "OPEN" }]);
    const p = await openGuardedPayment(ctx, { recipient: "0x" + "11".repeat(20), amountWei: 10n ** 16n, policyId: "p", evidenceUrl: "https://x/y", deadlineUnix: 4_000_000_000, nonce: 7 });
    expect(writes.map((w) => w.method)).toEqual(["create_action", "open_escrow", "request_adjudication"]);
    expect(writes[1].value).toBe(10n ** 16n);
    expect(writes[1].args[4]).toBe("0xpolicy");
    expect(p.actionId).toBe("0xaction");
  });
});

describe("receipt", () => {
  it("is not paid on an OPEN escrow, whatever the verdict was", async () => {
    const { ctx } = fake([], [{ state: "OPEN" }]);
    expect((await receipt(ctx, "0xaction")).paid).toBe(false);
  });
  it("is paid only when the vault is SETTLED and holds a receipt", async () => {
    const { ctx } = fake([], [{ state: "SETTLED" }], { exists: true, decision_id: "0xd" });
    expect((await receipt(ctx, "0xaction")).paid).toBe(true);
    const none = fake([], [{ state: "SETTLED" }], null);
    expect((await receipt(none.ctx, "0xaction")).paid).toBe(false);
  });
});

describe("settled", () => {
  it("waits for finality and then for the vault, and returns the vault's own receipt", async () => {
    const { ctx } = fake([{ projectedStatus: "Accepted" }, { projectedStatus: "Finalized" }], [{ state: "OPEN" }, { state: "SETTLED" }], { exists: true });
    const r = await settled(ctx, { actionId: "0xaction", adjudicationTx: "0xtx" }, { intervalMs: 1 });
    expect(r.finalized).toBe(true);
    expect(r.paid).toBe(true);
  });
  it("never reports paid for a verdict that did not finalize", async () => {
    const { ctx } = fake([{ projectedStatus: "Canceled" }], [{ state: "OPEN" }]);
    const r = await settled(ctx, { actionId: "0xaction", adjudicationTx: "0xtx" }, { intervalMs: 1 });
    expect(r.finalized).toBe(false);
    expect(r.paid).toBe(false);
  });
});

describe("contest and refund", () => {
  it("contests only an Accepted verdict", async () => {
    const accepted = fake([{ projectedStatus: "Accepted" }], []);
    expect((await contest(accepted.ctx, "0xtx")).charge).toBe(5n);
    const final = fake([{ projectedStatus: "Finalized" }], []);
    await expect(contest(final.ctx, "0xtx")).rejects.toThrow(/only an Accepted verdict/);
  });
  it("uses withdraw_refund for a refusal and reclaim_after_deadline for an open escrow", async () => {
    const a = fake([], [{ state: "REFUNDABLE" }]);
    await refund(a.ctx, "0xaction");
    expect(a.writes[0].method).toBe("withdraw_refund");
    const b = fake([], [{ state: "OPEN" }]);
    await refund(b.ctx, "0xaction");
    expect(b.writes[0].method).toBe("reclaim_after_deadline");
    const c = fake([], [{ state: "SETTLED" }]);
    await expect(refund(c.ctx, "0xaction")).rejects.toThrow(/nothing to refund/);
  });
});

describe("kitContext", () => {
  const base = { estimate: async () => ({ verification: { status: "verified" } }), submit: async () => ({ genlayerTxId: "0xabc" }) };
  it("signs through the kit when the quote verifies", async () => {
    const ctx = kitContext({ client: {}, kit: base, rpcUrl: "http://x", addresses: { gate: GATE, vault: VAULT }, sender: "0x1" });
    expect(await ctx.submit({ address: GATE, method: "m", args: [] })).toBe("0xabc");
  });
  it("funds each emitted message instead of using the kit's submit, which cannot", async () => {
    const calls: any[] = [];
    const client = { writeContract: async (a: any) => { calls.push(a); return "0xdirect"; } };
    const kit = { estimate: async () => ({ verification: { status: "verified" }, feeValue: 100n, distribution: { totalMessageFees: 0n } }), submit: async () => { throw new Error("the kit's submit must not carry a message-emitting write"); } };
    const shape = { messageType: "1", parentIndex: "7", feeParams: "0xfee", perMessageBudget: "50" };
    const ctx = kitContext({ client, kit, rpcUrl: "http://x", addresses: { gate: GATE, vault: VAULT }, sender: "0x1", messageShape: shape });
    const hash = await ctx.submit({ address: GATE, method: "request_adjudication", args: ["0xa"], messages: [{ recipient: VAULT, method: "authorize_release" }, { recipient: VAULT, method: "close_refused" }] });
    expect(hash).toBe("0xdirect");
    const fees = calls[0].fees;
    expect(fees.messageAllocations).toHaveLength(2);
    expect(fees.distribution.totalMessageFees).toBe(100n);
    expect(fees.feeValue).toBe(200n);
    expect(fees.messageAllocations[0].callKey).toBe("0x" + Buffer.from("authorize_release").toString("hex").padEnd(64, "0"));
  });
  it("refuses a message-emitting write when no message shape is supplied", async () => {
    const ctx = kitContext({ client: {}, kit: base, rpcUrl: "http://x", addresses: { gate: GATE, vault: VAULT }, sender: "0x1" });
    await expect(ctx.submit({ address: GATE, method: "m", args: [], messages: [{ recipient: VAULT, method: "x" }] })).rejects.toThrow(/unfunded/);
  });
  it("fails closed on a fee policy mismatch", async () => {
    const kit = { ...base, estimate: async () => ({ verification: { status: "mismatch" } }), submit: async () => { throw new Error("must not be reached"); } };
    const ctx = kitContext({ client: {}, kit, rpcUrl: "http://x", addresses: { gate: GATE, vault: VAULT }, sender: "0x1" });
    await expect(ctx.submit({ address: GATE, method: "m", args: [] })).rejects.toThrow(/refusing to sign/);
  });
});
