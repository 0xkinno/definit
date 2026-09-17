/**
 * The lifecycle, signed by the user's wallet.
 *
 * This mirrors `lib/server/runner.ts` step for step. It exists as a separate
 * module rather than a shared one because that module reads a signing key from
 * the server environment, and nothing that touches a private key may be
 * reachable from the browser bundle.
 *
 * Every value that matters -- the beneficiary, the amount, the commitment --
 * is still read back from the chain. The only thing the wallet changes is who
 * signs.
 */

import {
  DECISION_GATE_ADDRESS,
  FINALITY_VAULT_ADDRESS,
  SCENARIO_REGISTRY_ADDRESS,
} from "@/lib/config";
import { FEE_TEMPLATE } from "@/lib/fees/template-data";
import { planFees } from "@/lib/fees/plan";
import { asHash } from "@/lib/genlayer/client";
import { contracts, readClient } from "@/lib/genlayer/contracts";
import { SCENARIO } from "@/lib/demo/scenario";
import type { WalletGenLayerClient } from "@/lib/wallet/client";

export interface StepOutcome {
  txHash: string;
  status: string | null;
  resolutionAction: string | null;
  decisionActive: boolean | null;
  note: string;
}

function requireConfigured(): void {
  if (!DECISION_GATE_ADDRESS || !FINALITY_VAULT_ADDRESS || !SCENARIO_REGISTRY_ADDRESS) {
    throw new Error(
      "Contract addresses are not configured, so there is nothing to sign for.",
    );
  }
}

async function submit(
  client: WalletGenLayerClient,
  address: string,
  functionName: string,
  args: unknown[],
  value?: bigint,
  messages: string[] = [],
): Promise<string> {
  const fees = await planFees(
    client as never,
    { address, functionName, args, value },
    messages,
    FEE_TEMPLATE,
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

async function waitDecided(
  client: WalletGenLayerClient,
  hash: string,
  retries = 60,
): Promise<Omit<StepOutcome, "txHash" | "note">> {
  try {
    await client.waitForDecision({ hash: asHash(hash), interval: 4000, retries });
  } catch {
    // A timeout is an unresolved state, never a failure. Read whatever the
    // node currently knows and report that instead of guessing.
  }
  try {
    const lifecycle = await client.advanced.getTransactionLifecycle({ hash: asHash(hash) });
    return {
      status: lifecycle.storedStatus ?? null,
      resolutionAction: lifecycle.resolutionAction ?? null,
      decisionActive: lifecycle.decisionActive ?? null,
    };
  } catch {
    return { status: null, resolutionAction: null, decisionActive: null };
  }
}

export async function ensurePolicy(
  client: WalletGenLayerClient,
): Promise<{ published: boolean; txHash?: string }> {
  requireConfigured();
  const reader = readClient();
  const existing = await contracts.getPolicy(reader, SCENARIO.policyId);
  if (existing.exists) return { published: false };

  const hash = await submit(client, SCENARIO_REGISTRY_ADDRESS, "publish_policy", [
    SCENARIO.policyId,
    SCENARIO.policyVersion,
    SCENARIO.policyTitle,
    SCENARIO.policyText,
  ]);
  return { published: true, txHash: hash };
}
export async function walletCreateAction(
  client: WalletGenLayerClient,
  input: {
    recipient: string;
    amountWei: number;
    asset: string;
    policyId: string;
    evidenceUrl: string;
    deadlineUnix: number;
    nonce: number;
    agentAddress: string;
  },
): Promise<StepOutcome & { actionId: string }> {
  requireConfigured();
  const hash = await submit(client, DECISION_GATE_ADDRESS, "create_action", [
    input.recipient,
    input.amountWei,
    input.asset,
    input.policyId,
    input.evidenceUrl,
    input.deadlineUnix,
    input.nonce,
  ]);
  const outcome = await waitDecided(client, hash);

  const reader = readClient();
  const list = await reader.readContract({
    address: DECISION_GATE_ADDRESS as `0x${string}`,
    functionName: "list_actions_for",
    args: [input.agentAddress.toLowerCase()] as never,
  });
  const rows = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
  const match = [...rows].reverse().find((row) => String(row.policy_id) === input.policyId);
  const actionId = match ? String(match.action_id) : "";

  return {
    txHash: hash,
    actionId,
    ...outcome,
    note: "Registered by your wallet. The commitment is not complete until evidence is adjudicated.",
  };
}

/**
 * Fund the escrow.
 *
 * The amount is read from the action the gate recorded, not from the caller,
 * and the vault rejects a mismatch. That is why this step takes no amount.
 */
export async function walletOpenEscrow(
  client: WalletGenLayerClient,
  input: { actionId: string },
): Promise<StepOutcome> {
  requireConfigured();
  const reader = readClient();
  const action = await contracts.getAction(reader, input.actionId);
  if (!action.exists) throw new Error("No action record exists for that id.");
  const amountWei = BigInt(String(action.amount ?? 0));
  if (amountWei <= 0n) throw new Error("The recorded commitment carries no amount to fund.");

  const hash = await submit(
    client,
    FINALITY_VAULT_ADDRESS,
    "open_escrow",
    [input.actionId],
    amountWei,
  );
  const outcome = await waitDecided(client, hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Escrow funded with the amount read from the recorded commitment, not from this request.",
  };
}

export async function walletRequestAdjudication(
  client: WalletGenLayerClient,
  input: { actionId: string },
): Promise<StepOutcome> {
  requireConfigured();
  const hash = await submit(client, DECISION_GATE_ADDRESS, "request_adjudication", [input.actionId]);
  const outcome = await waitDecided(client, hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Adjudication complete. If it approved, the action is ACCEPTED -- not final -- and nothing has moved.",
  };
}

export async function walletFinalizeDecision(
  client: WalletGenLayerClient,
  input: { decisionId: string },
): Promise<StepOutcome> {
  requireConfigured();
  // The promotion emits one internal message, and only on the finalized stage.
  // Simulation cannot price that, so the recorded template is used.
  const hash = await submit(
    client,
    DECISION_GATE_ADDRESS,
    "finalize_decision",
    [input.decisionId],
    undefined,
    [FINALITY_VAULT_ADDRESS],
  );
  const outcome = await waitDecided(client, hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Promotion requested. It is refused while the appeal window is open, and nothing moves either way.",
  };
}

/**
 * Release escrow against a final decision.
 *
 * Every field is re-derived from the escrow record the vault itself wrote, so
 * the caller cannot substitute a commitment. The vault then checks the
 * capability against the decision contract before any value moves.
 */
export async function walletSettle(
  client: WalletGenLayerClient,
  input: { actionId: string; decisionId: string },
): Promise<StepOutcome> {
  requireConfigured();
  const reader = readClient();
  const escrow = await contracts.getEscrow(reader, input.actionId);
  if (!escrow.exists) throw new Error("No escrow record exists for that action.");

  const hash = await submit(
    client,
    FINALITY_VAULT_ADDRESS,
    "settle",
    [
      input.actionId,
      input.decisionId,
      String(escrow.intent_hash),
      String(escrow.policy_hash),
      String(escrow.evidence_digest),
      BigInt(Number(escrow.nonce)),
      String(escrow.recipient),
      BigInt(Number(escrow.amount)),
    ],
    undefined,
    [String(escrow.recipient), DECISION_GATE_ADDRESS],
  );
  const outcome = await waitDecided(client, hash);
  return {
    txHash: hash,
    ...outcome,
    note: "Release attempted. It only succeeds if the decision is final and the commitment matches exactly.",
  };
}
