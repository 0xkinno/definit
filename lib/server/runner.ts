/**
 * Server-side step execution.
 *
 * Each exported function performs exactly one contract call and returns the
 * transaction hash immediately after the transaction has reached a *decided*
 * state. Finalisation is never awaited here: the whole point of the product is
 * that the interesting window is the one between decided and final, so the
 * caller is handed the hash and left to observe that window.
 */

import {
  DECISION_GATE_ADDRESS,
  FINALITY_VAULT_ADDRESS,
  SCENARIO_REGISTRY_ADDRESS,
} from "@/lib/config";
import { contracts, readClient } from "@/lib/genlayer/contracts";
import { asHash } from "@/lib/genlayer/client";
import { buildFees } from "@/lib/server/fees";
import { getSigner } from "@/lib/server/signer";

export interface StepResult {
  txHash: string;
  status: string | null;
  resolutionAction: string | null;
  decisionActive: boolean | null;
  note: string;
}

function requireConfigured(): void {
  if (!DECISION_GATE_ADDRESS || !FINALITY_VAULT_ADDRESS || !SCENARIO_REGISTRY_ADDRESS) {
    throw new Error(
      "Contract addresses are not configured. Set NEXT_PUBLIC_DECISION_GATE_ADDRESS, NEXT_PUBLIC_FINALITY_VAULT_ADDRESS and NEXT_PUBLIC_SCENARIO_REGISTRY_ADDRESS.",
    );
  }
}

async function submit(
  address: string,
  functionName: string,
  args: unknown[],
  value?: bigint,
  messages: string[] = [],
): Promise<string> {
  const { client } = getSigner();
  // A call that emits internal messages needs one fee allocation per message.
  // The recipient list is supplied by the caller, which is the only party that
  // knows; see lib/server/fees.ts for why the network cannot answer this.
  const fees = await buildFees(
    client as never,
    { address, functionName, args, value },
    messages,
  );
  const hash = await client.writeContract({
    address: address as `0x${string}`,
    functionName,
    args: args as never,
    ...(fees === undefined ? {} : { fees: fees as never }),
    ...(value === undefined ? {} : { value }),
  });
  return String(hash);
}

interface DecisionOutcome {
  status: string | null;
  resolutionAction: string | null;
  decisionActive: boolean | null;
}

/**
 * Wait for the transaction to be *decided* -- not final.
 *
 * Returning here, rather than at finalisation, is deliberate: the console has
 * to be able to show the provisional window while it is happening.
 */
async function waitDecided(hash: string, retries = 60): Promise<DecisionOutcome> {
  const { client } = getSigner();
  try {
    await client.waitForDecision({
      hash: asHash(hash),
      interval: 4000,
      retries,
    });
  } catch {
    // A timeout here means unresolved, not failed. We still read whatever the
    // node currently knows so the console can display the truth.
  }

  try {
    const lifecycle = await client.advanced.getTransactionLifecycle({
      hash: asHash(hash),
    });
    return {
      status: lifecycle.storedStatus ?? null,
      resolutionAction: lifecycle.resolutionAction ?? null,
      decisionActive: lifecycle.decisionActive ?? null,
    };
  } catch {
    return { status: null, resolutionAction: null, decisionActive: null };
  }
}

export async function publishPolicyIfMissing(input: {
  policyId: string;
  version: string;
  title: string;
  text: string;
}): Promise<{ published: boolean; txHash?: string; policyHash: string }> {
  requireConfigured();
  const client = readClient();
  const existing = await contracts.getPolicy(client, input.policyId);
  if (existing.exists) {
    return { published: false, policyHash: existing.policy_hash };
  }
  const hash = await submit(
    SCENARIO_REGISTRY_ADDRESS,
    "publish_policy",
    [input.policyId, input.version, input.title, input.text],
  );
  const outcome = await waitDecided(hash);
  const after = await contracts.getPolicy(client, input.policyId);
  return {
    published: true,
    txHash: hash,
    policyHash: after.exists ? after.policy_hash : "",
  };
}

export async function createAction(input: {
  recipient: string;
  amount: number;
  asset: string;
  policyId: string;
  evidenceUrl: string;
  deadlineUnix: number;
  nonce: number;
}): Promise<StepResult & { actionId: string }> {
  requireConfigured();
  const hash = await submit(DECISION_GATE_ADDRESS, "create_action", [
    input.recipient,
    input.amount,
    input.asset,
    input.policyId,
    input.evidenceUrl,
    input.deadlineUnix,
    input.nonce,
  ]);
  const outcome = await waitDecided(hash);

  const client = readClient();
  const { address } = getSigner();
  const list = await client.readContract({
    address: DECISION_GATE_ADDRESS as `0x${string}`,
    functionName: "list_actions_for",
    args: [address.toLowerCase()] as never,
  });
  const rows = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  const match = [...rows]
    .reverse()
    .find((row) => String(row.policy_id) === input.policyId);
  const actionId = match ? String(match.action_id) : "";

  return {
    txHash: hash,
    actionId,
    status: outcome.status,
    resolutionAction: outcome.resolutionAction,
    decisionActive: outcome.decisionActive,
    note: "Action registered. The commitment is not complete until evidence is adjudicated.",
  };
}

export async function openEscrow(input: {
  actionId: string;
  amount: number;
}): Promise<StepResult> {
  requireConfigured();
  const hash = await submit(
    FINALITY_VAULT_ADDRESS,
    "open_escrow",
    [input.actionId],
    BigInt(input.amount),
  );
  const outcome = await waitDecided(hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Escrow funded. The beneficiary and amount were read from the decision contract, not from this request.",
  };
}

export async function requestAdjudication(input: { actionId: string }): Promise<StepResult> {
  requireConfigured();
  const hash = await submit(DECISION_GATE_ADDRESS, "request_adjudication", [input.actionId]);
  const outcome = await waitDecided(hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Adjudication complete. If it approved, the action is ACCEPTED -- not final -- and nothing has moved.",
  };
}

export async function finalizeDecision(input: { decisionId: string }): Promise<StepResult> {
  requireConfigured();
  // The promotion emits one internal message, on the finalized stage.
  const hash = await submit(
    DECISION_GATE_ADDRESS,
    "finalize_decision",
    [input.decisionId],
    undefined,
    [FINALITY_VAULT_ADDRESS],
  );
  const outcome = await waitDecided(hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Finalisation requested. It is refused while the appeal window is open, and nothing moves either way.",
  };
}

/**
 * Release escrow against a final decision.
 *
 * Every field is re-derived from the escrow record that the vault itself
 * wrote, so the caller cannot substitute a commitment. The vault then checks
 * the capability against the decision contract before any value moves.
 */
export async function settle(input: {
  actionId: string;
  decisionId: string;
  intentHash: string;
  policyHash: string;
  evidenceDigest: string;
  nonce: number;
  recipient: string;
  amount: number;
}): Promise<StepResult> {
  requireConfigured();
  // The release emits twice: the payout to the beneficiary, and a
  // reconciliation call back to the decision contract.
  const hash = await submit(
    FINALITY_VAULT_ADDRESS,
    "settle",
    [
      input.actionId,
      input.decisionId,
      input.intentHash,
      input.policyHash,
      input.evidenceDigest,
      BigInt(input.nonce),
      input.recipient,
      BigInt(input.amount),
    ],
    undefined,
    [input.recipient, DECISION_GATE_ADDRESS],
  );
  const outcome = await waitDecided(hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Release attempted. It only succeeds if the decision is final and the commitment matches exactly.",
  };
}
