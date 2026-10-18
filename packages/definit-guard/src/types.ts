export type FeePosture = "low" | "standard" | "high";

/** One snapshot of gen_getTransactionLifecycle, reduced to what the rule reads. */
export interface Lifecycle {
  storedStatus?: string;
  projectedStatus?: string;
  resolutionAction?: string | null;
  decisionId?: string | null;
  decisionActive?: boolean | null;
  evaluatedAt?: number | null;
}

export interface Addresses {
  gate: string;
  vault: string;
}

/** A write the guard wants signed. `value` is the native amount sent with it. */
export interface WriteSpec {
  address: string;
  method: string;
  args: unknown[];
  value?: bigint;
  posture?: FeePosture;
  /** Internal messages this write emits, so each one is funded. */
  messages?: Array<{ recipient: string; method: string }>;
}

/** Everything the guard needs from the outside, so it can be tested without a network. */
export interface GuardContext {
  addresses: Addresses;
  /** Sign and send one write; returns its transaction hash. Fees are the submitter's job. */
  submit(spec: WriteSpec): Promise<string>;
  read(address: string, method: string, args: unknown[]): Promise<any>;
  lifecycle(txId: string): Promise<Lifecycle>;
  /** Optional: wait until a transaction is decided. */
  waitDecided?(hash: string): Promise<void>;
  appeal?(txId: string): Promise<{ charge: bigint; hash: string }>;
  sender: string;
}

export interface GuardedPaymentInput {
  recipient: string;
  amountWei: bigint;
  asset?: string;
  policyId: string;
  evidenceUrl: string;
  deadlineUnix: number;
  nonce?: number;
  posture?: FeePosture;
}

export interface GuardedPayment {
  actionId: string;
  createTx: string;
  escrowTx: string;
  adjudicationTx: string;
}

export interface PaymentReceipt {
  state: string;
  /** True only when the vault itself recorded the release. An Accepted verdict never makes this true. */
  paid: boolean;
  refundable: boolean;
  receipt: Record<string, unknown> | null;
  escrow: Record<string, unknown> | null;
}
