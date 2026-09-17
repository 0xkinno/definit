/**
 * Receipt schema.
 *
 * A receipt is the human-readable projection of the vault's stored settlement
 * record. It is never the source of truth, and it is never constructed from
 * client-side assumptions: every field comes from a contract read.
 */

import type { ReceiptView } from "@/lib/genlayer/contracts";

export interface FinalityReceiptDocument {
  actionId: string;
  decisionId: string;
  network: string;
  chainId: number;
  intentHash: string;
  policyHash: string;
  evidenceDigest: string;
  nonce: number;
  amount: number;
  asset: string;
  funder: string;
  recipient: string;
  openedAt: string;
  settledAt: string;
  decisionReadScope: string;
  finalityProof: string;
  status: string;
  messageStage: string;
  contractAddress: string;
  settlementTxHash?: string;
}

export function toReceiptDocument(
  view: ReceiptView,
  meta: { network: string; chainId: number; contractAddress: string; settlementTxHash?: string },
): FinalityReceiptDocument | null {
  if (!view.exists) return null;
  return {
    actionId: view.action_id,
    decisionId: view.decision_id ?? "",
    network: meta.network,
    chainId: meta.chainId,
    intentHash: view.intent_hash ?? "",
    policyHash: view.policy_hash ?? "",
    evidenceDigest: view.evidence_digest ?? "",
    nonce: view.nonce ?? 0,
    amount: view.amount ?? 0,
    asset: view.asset ?? "GEN",
    funder: view.funder ?? "",
    recipient: view.recipient ?? "",
    openedAt: view.opened_at ?? "",
    settledAt: view.settled_at ?? "",
    decisionReadScope: view.decision_read_scope ?? "FINALIZED_CAPABILITY",
    finalityProof: view.finality_proof ?? "",
    status: view.status ?? "",
    messageStage: view.message_stage ?? "finalized",
    contractAddress: meta.contractAddress,
    settlementTxHash: meta.settlementTxHash,
  };
}

export function receiptLines(doc: FinalityReceiptDocument): Array<[string, string]> {
  return [
    ["Action", doc.actionId],
    ["Decision", doc.decisionId],
    ["Intent hash", doc.intentHash],
    ["Policy hash", doc.policyHash],
    ["Evidence digest", doc.evidenceDigest],
    ["Settlement nonce", String(doc.nonce)],
    ["Amount", `${doc.amount} ${doc.asset}`],
    ["Funder", doc.funder],
    ["Beneficiary", doc.recipient],
    ["Escrow opened", doc.openedAt],
    ["Settled", doc.settledAt],
    ["Decision read scope", doc.decisionReadScope],
    ["Finality proof", doc.finalityProof],
    ["Release message stage", doc.messageStage],
    ["Network", `${doc.network} (chain ${doc.chainId})`],
    ["Vault", doc.contractAddress],
  ];
}
