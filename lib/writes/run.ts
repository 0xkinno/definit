"use client";

/**
 * One entry point for every state-changing step.
 *
 * The console and the lifecycle demo both call this. It decides how a step is
 * signed, and it is the only thing in the application that decides that:
 *
 *   * with a connected wallet, the step is built in the browser and signed by
 *     the user, after a wallet popup;
 *   * with no wallet, it is handed to the operator endpoint, which signs with
 *     the server's demonstration key.
 *
 * The response always says which pathway was used, so a screen never has to
 * guess whether a signature came from the visitor or from the operator.
 */

import { MILESTONE_AMOUNT_WEI, SCENARIO, deadlineUnixFromNow } from "@/lib/demo/scenario";
import type { WalletHandle } from "@/lib/wallet/provider";
import {
  ensurePolicy,
  walletCreateAction,
  walletFinalizeDecision,
  walletOpenEscrow,
  walletRequestAdjudication,
  walletSettle,
} from "@/lib/wallet/steps";

export type WriteStep = "create" | "adjudicate" | "finalize" | "escrow" | "settle";

export type WritePathway = "wallet" | "operator";

export interface WriteRequest {
  actionId?: string;
  decisionId?: string;
  recipient?: string;
  amountWei?: number;
  asset?: string;
  policyId?: string;
  evidenceUrl?: string;
  deadlineUnix?: number;
  nonce?: number;
}

export interface WriteResult {
  ok: boolean;
  pathway: WritePathway;
  txHash?: string;
  actionId?: string;
  decisionId?: string;
  note?: string;
  detail?: string;
  /** Present when the chain answered with a named refusal. */
  refused?: boolean;
  raw?: Record<string, unknown>;
}

const endpoint: Record<WriteStep, (request: WriteRequest) => string> = {
  create: () => "/api/actions",
  adjudicate: (request) => `/api/actions/${request.actionId}/adjudicate`,
  finalize: (request) => `/api/actions/${request.actionId}/finalize`,
  escrow: (request) => `/api/actions/${request.actionId}/escrow`,
  settle: (request) => `/api/actions/${request.actionId}/settle`,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function viaWallet(
  step: WriteStep,
  request: WriteRequest,
  handle: WalletHandle,
): Promise<WriteResult> {
  const client = handle.client;
  const address = handle.address;
  if (!client || !address) throw new Error("No wallet client is available.");

  if (step === "create") {
    await ensurePolicy(client);
    const result = await walletCreateAction(client, {
      recipient: request.recipient ?? SCENARIO.recipient,
      amountWei: request.amountWei ?? Number(MILESTONE_AMOUNT_WEI),
      asset: request.asset ?? SCENARIO.asset,
      policyId: request.policyId ?? SCENARIO.policyId,
      evidenceUrl: request.evidenceUrl ?? SCENARIO.evidenceUrl,
      deadlineUnix: request.deadlineUnix ?? deadlineUnixFromNow(),
      nonce: request.nonce ?? Date.now() % 2_000_000_000,
      agentAddress: address,
    });
    return {
      ok: true,
      pathway: "wallet",
      txHash: result.txHash,
      actionId: result.actionId,
      note: result.note,
      raw: { status: result.status, resolutionAction: result.resolutionAction },
    };
  }

  const actionId = request.actionId ?? "";
  if (!actionId) throw new Error("This step needs an action id.");

  if (step === "adjudicate") {
    const result = await walletRequestAdjudication(client, { actionId });
    return { ok: true, pathway: "wallet", txHash: result.txHash, actionId, note: result.note, raw: { status: result.status, resolutionAction: result.resolutionAction } };
  }
  if (step === "finalize") {
    const decisionId = request.decisionId ?? "";
    if (!decisionId) throw new Error("This step needs a decision id.");
    const result = await walletFinalizeDecision(client, { decisionId });
    return { ok: true, pathway: "wallet", txHash: result.txHash, actionId, decisionId, note: result.note, raw: { status: result.status, resolutionAction: result.resolutionAction } };
  }
  if (step === "escrow") {
    const result = await walletOpenEscrow(client, { actionId });
    return { ok: true, pathway: "wallet", txHash: result.txHash, actionId, note: result.note, raw: { status: result.status, resolutionAction: result.resolutionAction } };
  }
  const decisionId = request.decisionId ?? "";
  if (!decisionId) throw new Error("This step needs a decision id.");
  const result = await walletSettle(client, { actionId, decisionId });
  return { ok: true, pathway: "wallet", txHash: result.txHash, actionId, decisionId, note: result.note, raw: { status: result.status, resolutionAction: result.resolutionAction } };
}

async function viaOperator(step: WriteStep, request: WriteRequest): Promise<WriteResult> {
  const body: Record<string, unknown> = {};
  if (step === "create") {
    body.recipient = request.recipient ?? SCENARIO.recipient;
    body.amount = request.amountWei ?? Number(MILESTONE_AMOUNT_WEI);
    body.asset = request.asset ?? SCENARIO.asset;
    body.policyId = request.policyId ?? SCENARIO.policyId;
    body.evidenceUrl = request.evidenceUrl ?? SCENARIO.evidenceUrl;
    body.deadlineUnix = request.deadlineUnix ?? deadlineUnixFromNow();
    if (request.nonce !== undefined) body.nonce = request.nonce;
  }
  if (step === "finalize" || step === "settle") {
    body.decisionId = request.decisionId;
  }

  const response = await fetch(endpoint[step](request), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok || payload.error) {
    return {
      ok: false,
      pathway: "operator",
      detail: String(payload.detail ?? payload.error ?? `The step was refused (HTTP ${response.status}).`),
      raw: payload,
    };
  }
  return {
    ok: true,
    pathway: "operator",
    txHash: payload.txHash ? String(payload.txHash) : undefined,
    actionId: payload.actionId ? String(payload.actionId) : undefined,
    decisionId: payload.decisionId ? String(payload.decisionId) : undefined,
    note: payload.note ? String(payload.note) : undefined,
    raw: payload,
  };
}

/**
 * Run one step.
 *
 * A wallet failure is reported, never silently retried through the operator
 * key: a user who declined a popup did not ask for the operator to sign it.
 */
export async function runWrite(
  step: WriteStep,
  request: WriteRequest,
  handle: WalletHandle | null,
): Promise<WriteResult> {
  if (handle?.client && handle.address) {
    try {
      return await viaWallet(step, request, handle);
    } catch (error) {
      return {
        ok: false,
        pathway: "wallet",
        detail: message(error),
        refused: true,
      };
    }
  }
  try {
    return await viaOperator(step, request);
  } catch (error) {
    return { ok: false, pathway: "operator", detail: message(error) };
  }
}
