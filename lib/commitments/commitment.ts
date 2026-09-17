/**
 * Canonical commitment encoding.
 *
 * This module is a byte-for-byte mirror of the encoding implemented inside
 * `contracts/decision_gate.py`. Keeping the two in step is what lets an
 * independent party recompute the thing that was judged without asking us.
 *
 * Any change here must be made in the contract in the same commit, and the
 * domain version string must be bumped.
 */

import { keccak256, toBytes } from "viem";

export const COMMITMENT_DOMAIN = "DEFINIT-COMMITMENT-v1";
export const ACTION_DOMAIN = "DEFINIT-ACTION-v1";
export const DECISION_DOMAIN = "DEFINIT-DECISION-v1";
export const POLICY_DOMAIN = "DEFINIT-POLICY-v1";
export const EVIDENCE_DOMAIN = "DEFINIT-EVIDENCE-v1";

/** Normalisation shared with the adjudicator: collapse whitespace, bound length. */
export const MAX_EVIDENCE_CHARS = 20000;

export function normalizeEvidence(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(" ").slice(0, MAX_EVIDENCE_CHARS);
}

export function hashOf(payload: string): `0x${string}` {
  return keccak256(toBytes(payload));
}

export function policyHashOf(policyText: string): `0x${string}` {
  return hashOf(`${POLICY_DOMAIN}|${policyText}`);
}

export function evidenceDigestOf(rawEvidence: string): `0x${string}` {
  return hashOf(`${EVIDENCE_DOMAIN}|${normalizeEvidence(rawEvidence)}`);
}

export interface CommitmentFields {
  agent: string;
  recipient: string;
  amount: number;
  asset: string;
  policyHash: string;
  evidenceDigest: string;
  nonce: number;
  deadlineUnix: number;
}

export function commitmentPayload(fields: CommitmentFields): string {
  return [
    COMMITMENT_DOMAIN,
    `agent=${fields.agent.toLowerCase()}`,
    `recipient=${fields.recipient.toLowerCase()}`,
    `amount=${fields.amount}`,
    `asset=${fields.asset}`,
    `policy_hash=${fields.policyHash}`,
    `evidence_digest=${fields.evidenceDigest}`,
    `nonce=${fields.nonce}`,
    `deadline=${fields.deadlineUnix}`,
  ].join("|");
}

export function intentHashOf(fields: CommitmentFields): `0x${string}` {
  return hashOf(commitmentPayload(fields));
}

export interface ActionIdFields {
  agent: string;
  recipient: string;
  amount: number;
  asset: string;
  policyHash: string;
  nonce: number;
  createdAt: string;
}

export function actionIdOf(fields: ActionIdFields): `0x${string}` {
  return hashOf(
    [
      ACTION_DOMAIN,
      `agent=${fields.agent.toLowerCase()}`,
      `recipient=${fields.recipient.toLowerCase()}`,
      `amount=${fields.amount}`,
      `asset=${fields.asset}`,
      `policy_hash=${fields.policyHash}`,
      `nonce=${fields.nonce}`,
      `created_at=${fields.createdAt}`,
    ].join("|"),
  );
}

export interface DecisionIdFields {
  actionId: string;
  attempt: number;
  intentHash: string;
  adjudicatedAt: string;
}

export function decisionIdOf(fields: DecisionIdFields): `0x${string}` {
  return hashOf(
    [
      DECISION_DOMAIN,
      `action=${fields.actionId}`,
      `attempt=${fields.attempt}`,
      `intent_hash=${fields.intentHash}`,
      `adjudicated_at=${fields.adjudicatedAt}`,
    ].join("|"),
  );
}

export function shortHash(value: string, lead = 10, tail = 6): string {
  if (!value || value.length <= lead + tail + 2) return value || "--";
  return `${value.slice(0, lead)}...${value.slice(-tail)}`;
}
