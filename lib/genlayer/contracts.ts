/**
 * Typed access to the three intelligent contracts.
 *
 * These helpers build requests and parse responses. They do not decide
 * anything, and they do not cache anything that could be mistaken for truth.
 * Every read is answered by the chain.
 *
 * Note the deliberate use of the `transactionHashVariant` on the capability
 * read: the caller must be explicit about which storage state it is asking
 * against. There is no default that silently means "final".
 */

import type { CalldataEncodable } from "genlayer-js/types";

import {
  DECISION_GATE_ADDRESS,
  FINALITY_VAULT_ADDRESS,
  RUNTIME_MODE,
  SCENARIO_REGISTRY_ADDRESS,
} from "@/lib/config";
import { createReadClient } from "@/lib/genlayer/client";

type AnyClient = ReturnType<typeof createReadClient>;

export interface ActionView {
  exists: boolean;
  action_id: string;
  agent?: string;
  recipient?: string;
  amount?: number;
  asset?: string;
  policy_id?: string;
  policy_hash?: string;
  policy_version?: string;
  evidence_url?: string;
  evidence_digest?: string;
  intent_hash?: string;
  nonce?: number;
  deadline_unix?: number;
  created_at?: string;
  state?: string;
  decision_id?: string;
  attempts?: number;
  last_reason?: string;
  finalized_at?: string;
  reason_code?: string;
}

export interface CapabilityView {
  exists: boolean;
  decision_id: string;
  action_id?: string;
  verdict?: string;
  reason_code?: string;
  confidence?: number;
  evidence_digest?: string;
  policy_hash?: string;
  intent_hash?: string;
  nonce?: number;
  amount?: number;
  recipient?: string;
  asset?: string;
  deadline_unix?: number;
  agent?: string;
  adjudicated_at?: string;
  finalized_at?: string;
  state?: string;
  read_scope?: string;
}

export interface DecisionView {
  exists: boolean;
  decision_id: string;
  action_id?: string;
  verdict?: string;
  reason_code?: string;
  confidence?: number;
  evidence_digest?: string;
  policy_hash?: string;
  intent_hash?: string;
  nonce?: number;
  adjudicated_at?: string;
  finalized_at?: string;
  attempt?: number;
}

export interface EscrowView {
  exists: boolean;
  action_id: string;
  funder?: string;
  recipient?: string;
  amount?: number;
  asset?: string;
  intent_hash?: string;
  policy_hash?: string;
  evidence_digest?: string;
  nonce?: number;
  deadline_unix?: number;
  opened_at?: string;
  state?: string;
  released_at?: string;
  decision_id?: string;
  reason_code?: string;
}

export interface ReceiptView {
  exists: boolean;
  action_id: string;
  decision_id?: string;
  intent_hash?: string;
  policy_hash?: string;
  evidence_digest?: string;
  nonce?: number;
  amount?: number;
  asset?: string;
  funder?: string;
  recipient?: string;
  opened_at?: string;
  settled_at?: string;
  decision_read_scope?: string;
  finality_proof?: string;
  status?: string;
  message_stage?: string;
  reason_code?: string;
}

export interface PolicyView {
  exists: boolean;
  policy_id: string;
  version: string;
  title: string;
  text: string;
  policy_hash: string;
  reason_code: string;
}

export class NotConfiguredError extends Error {
  constructor(what: string) {
    super(
      `${what} is not configured. Set the corresponding NEXT_PUBLIC_* address in .env.local.`,
    );
    this.name = "NotConfiguredError";
  }
}

function gateAddress(): string {
  if (!DECISION_GATE_ADDRESS) throw new NotConfiguredError("DecisionGate");
  return DECISION_GATE_ADDRESS;
}

function vaultAddress(): string {
  if (!FINALITY_VAULT_ADDRESS) throw new NotConfiguredError("FinalityVault");
  return FINALITY_VAULT_ADDRESS;
}

function registryAddress(): string {
  if (!SCENARIO_REGISTRY_ADDRESS) throw new NotConfiguredError("ScenarioRegistry");
  return SCENARIO_REGISTRY_ADDRESS;
}

async function read<T>(
  client: AnyClient,
  address: string,
  functionName: string,
  args: CalldataEncodable[],
  variant?: "latest-final" | "latest-nonfinal",
): Promise<T> {
  const result = await client.readContract({
    address: address as `0x${string}`,
    functionName,
    args,
    ...(variant ? { transactionHashVariant: variant as never } : {}),
  });
  return result as T;
}

export function readClient(): AnyClient {
  return createReadClient();
}

export const contracts = {
  mode: RUNTIME_MODE,

  // -------------------------------------------------------------- decision

  async getAction(client: AnyClient, actionId: string): Promise<ActionView> {
    return read<ActionView>(client, gateAddress(), "get_action", [actionId]);
  },

  async getDecision(client: AnyClient, decisionId: string): Promise<DecisionView> {
    return read<DecisionView>(client, gateAddress(), "get_decision", [decisionId]);
  },

  /**
   * Read the finality capability against *provisional* storage state.
   *
   * This is the read that a naive integration performs. It can return a
   * decision that is still appealable, which is exactly why the vault never
   * uses it.
   */
  async getCapabilityProvisional(
    client: AnyClient,
    decisionId: string,
  ): Promise<CapabilityView> {
    return read<CapabilityView>(
      client,
      gateAddress(),
      "get_capability",
      [decisionId],
      "latest-nonfinal",
    );
  },

  /**
   * Read the finality capability against *final* storage state.
   *
   * This is the read the vault performs. A decision that has only reached the
   * provisional stage is invisible here.
   */
  async getCapabilityFinal(
    client: AnyClient,
    decisionId: string,
  ): Promise<CapabilityView> {
    return read<CapabilityView>(
      client,
      gateAddress(),
      "get_capability",
      [decisionId],
      "latest-final",
    );
  },

  async describeGate(client: AnyClient) {
    return read<Record<string, unknown>>(client, gateAddress(), "describe", []);
  },

  // ----------------------------------------------------------------- vault

  async getEscrow(client: AnyClient, actionId: string): Promise<EscrowView> {
    return read<EscrowView>(client, vaultAddress(), "get_escrow", [actionId]);
  },

  async getReceipt(client: AnyClient, actionId: string): Promise<ReceiptView> {
    return read<ReceiptView>(client, vaultAddress(), "get_receipt", [actionId]);
  },

  async describeVault(client: AnyClient) {
    return read<Record<string, unknown>>(client, vaultAddress(), "describe", []);
  },

  // -------------------------------------------------------------- registry

  async getPolicy(client: AnyClient, policyId: string): Promise<PolicyView> {
    return read<PolicyView>(client, registryAddress(), "get_policy", [policyId]);
  },

  async listPolicies(client: AnyClient) {
    return read<Array<Record<string, unknown>>>(
      client,
      registryAddress(),
      "list_policies",
      [],
    );
  },
};

export type Contracts = typeof contracts;
