import type { GuardContext, Lifecycle, WriteSpec } from "./types.ts";

/**
 * Build a GuardContext on a GenLayer client and the Transaction Kit.
 *
 * Every write is quoted through the kit with the committed fee profile. A quote
 * whose verification is `mismatch` is refused: the guard never signs against a
 * stale fee policy, and never sets `allowUnverified`.
 */
export interface MessageShape {
  messageType: string | number;
  parentIndex: string | number | bigint;
  feeParams: string;
  perMessageBudget: string | number | bigint;
}

const callKey = (method: string) => "0x" + Array.from(new TextEncoder().encode(method)).map((b) => b.toString(16).padStart(2, "0")).join("").padEnd(64, "0");

/**
 * Fees for a write that emits messages. The kit's own submit sends only
 * {distribution, feeValue}, which cannot fund an emitted message, so the quote is
 * kept (it carries the verification) and one allocation per message is added.
 */
export function withMessageAllocations(quote: any, messages: Array<{ recipient: string; method: string }>, shape: MessageShape) {
  const budget = BigInt(shape.perMessageBudget);
  const total = budget * BigInt(messages.length);
  const d = quote.distribution;
  return {
    distribution: { ...d, totalMessageFees: total },
    feeValue: BigInt(quote.feeValue) - BigInt(d.totalMessageFees ?? 0) + total,
    messageAllocations: messages.map((m) => ({
      messageType: Number(shape.messageType),
      onAcceptance: false,
      parentIndex: BigInt(shape.parentIndex),
      recipient: m.recipient,
      callKey: callKey(m.method),
      budget,
      feeParams: shape.feeParams,
    })),
  };
}

export function kitContext(params: {
  client: any;
  kit: any;
  rpcUrl: string;
  addresses: { gate: string; vault: string };
  sender: string;
  /** Required to send a write that emits messages (see withMessageAllocations). */
  messageShape?: MessageShape;
}): GuardContext {
  const { client, kit, rpcUrl, addresses, sender, messageShape } = params;
  return {
    addresses,
    sender,
    async submit(spec: WriteSpec) {
      const tx = { kind: "write", address: spec.address, method: spec.method, args: spec.args };
      const quote = await kit.estimate({ preset: spec.posture ?? "standard", ...(spec.value ? { userValue: spec.value } : {}) }, tx);
      if (quote.verification?.status === "mismatch") throw new Error("the fee quote does not match the chain's fee policy; refusing to sign");
      if (spec.messages?.length) {
        if (!messageShape) throw new Error("this write emits messages and no message shape was supplied, so they would be unfunded");
        const fees = withMessageAllocations(quote, spec.messages, messageShape);
        return String(await client.writeContract({ address: spec.address, functionName: spec.method, args: spec.args, fees, ...(spec.value ? { value: spec.value } : {}) }));
      }
      const sent = await kit.submit(quote, tx);
      return String(sent.genlayerTxId);
    },
    read: (address, method, args) => client.readContract({ address, functionName: method, args }),
    async lifecycle(txId: string): Promise<Lifecycle> {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "gen_getTransactionLifecycle", params: [{ txId }] }),
      });
      const body = await res.json();
      if (body.error) throw new Error(`lifecycle: ${JSON.stringify(body.error)}`);
      return body.result as Lifecycle;
    },
    async waitDecided(hash: string) {
      await client.waitForTransactionReceipt({ hash, waitUntil: "decided", interval: 5000, retries: 120 });
    },
    async appeal(txId: string) {
      const charge: bigint = await client.getAppealCharge({ txId });
      const hash = await client.appealTransaction({ txId, value: charge });
      return { charge, hash: String(hash) };
    },
  };
}
