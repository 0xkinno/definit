"use client";

/**
 * The lifecycle walkthrough.
 *
 * One action, five steps, and the boundary in the middle. Every step is a real
 * transaction signed by whoever is connected. Nothing here is mocked: if the
 * wallet signs, the hash on screen is the hash on the chain, and the explorer
 * link beside it resolves to that transaction.
 *
 * With no wallet connected the walkthrough does not pretend. It says what is
 * missing, and it offers the two things that are still true without one: the
 * offline rehearsal, and a replay of a run that was recorded against these
 * exact contracts.
 */

import { useCallback, useMemo, useState } from "react";

import { Notice, Panel } from "@/components/ui/primitives";
import { CHAIN_NAME, explorerAddressUrl, explorerTxUrl } from "@/lib/config";
import { MILESTONE_AMOUNT_GEN, SCENARIO } from "@/lib/demo/scenario";
import type { LiveLifecycleRecord } from "@/lib/evidence";
import { classNames, middleTruncate } from "@/lib/format";
import { useWallet } from "@/lib/wallet/provider";
import { runWrite, type WriteStep } from "@/lib/writes/run";

interface LedgerEntry {
  label: string;
  ok: boolean;
  pathway: "wallet" | "operator";
  txHash?: string;
  detail?: string;
  note?: string;
  at: string;
}

interface ActionSnapshot {
  exists?: boolean;
  state?: string;
  decision_id?: string;
  last_reason?: string;
}

const STEP_ORDER: Array<{ step: WriteStep; title: string; body: string; needsDecision?: boolean }> = [
  {
    step: "create",
    title: "1 - Register the action",
    body: "Records the commitment: beneficiary, amount, policy and deadline. The evidence digest is deliberately absent, because it cannot exist before the judgement does.",
  },
  {
    step: "adjudicate",
    title: "2 - Adjudicate the evidence",
    body: "Validators fetch the same snapshot independently and score it against the policy. An approving verdict lands as ACCEPTED, which is provisional.",
  },
  {
    step: "escrow",
    title: "3 - Fund the escrow",
    body: `Sends ${MILESTONE_AMOUNT_GEN} GEN. The beneficiary and the amount are read from the recorded commitment, and the vault rejects a mismatch.`,
  },
  {
    step: "finalize",
    title: "4 - Promote to final",
    body: "Asks the gate to promote the decision. This is refused while the appeal window is open, and that refusal is the product working.",
    needsDecision: true,
  },
  {
    step: "settle",
    title: "5 - Release",
    body: "The vault re-derives the appeal window from the gate's own record, checks the commitment field by field, and only then moves value.",
    needsDecision: true,
  },
];

export function LifecycleDemo({ recorded }: { recorded: LiveLifecycleRecord | null }) {
  const wallet = useWallet();
  const [actionId, setActionId] = useState("");
  const [decisionId, setDecisionId] = useState("");
  const [snapshot, setSnapshot] = useState<ActionSnapshot | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [busy, setBusy] = useState<WriteStep | null>(null);
  const [showReplay, setShowReplay] = useState(false);

  const refresh = useCallback(async (id: string) => {
    if (!id) return;
    const response = await fetch(`/api/actions/${id}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { action?: ActionSnapshot };
    if (payload.action) {
      setSnapshot(payload.action);
      if (payload.action.decision_id) setDecisionId(String(payload.action.decision_id));
    }
  }, []);

  const run = useCallback(
    async (step: WriteStep) => {
      setBusy(step);
      try {
        const result = await runWrite(
          step,
          {
            actionId,
            decisionId,
            recipient: SCENARIO.recipient,
            asset: SCENARIO.asset,
            policyId: SCENARIO.policyId,
            evidenceUrl: SCENARIO.evidenceUrl,
          },
          wallet.handle,
        );

        setLedger((entries) => [
          {
            label: step,
            ok: result.ok,
            pathway: result.pathway,
            txHash: result.txHash,
            detail: result.detail,
            note: result.note,
            at: new Date().toISOString(),
          },
          ...entries,
        ]);

        if (result.actionId) {
          setActionId(result.actionId);
          await refresh(result.actionId);
        } else if (result.ok) {
          await refresh(actionId);
        }
      } finally {
        setBusy(null);
      }
    },
    [actionId, decisionId, refresh, wallet.handle],
  );

  const state = snapshot?.state ?? "not registered";
  const busyAny = busy !== null;
  const gate = !wallet.ready;

  const pathwayNote = wallet.ready
    ? `Every step below will raise a ${wallet.walletName} popup and be signed by ${middleTruncate(wallet.address ?? "", 6, 4)}. The hash that comes back is the transaction hash on ${CHAIN_NAME}.`
    : "No wallet is connected, so the buttons below will fall back to the operator-signed demo path. Connect a wallet to sign every step yourself.";

  return (
    <div className="space-y-5">
      <Notice tone={wallet.ready ? "final" : "neutral"} title={wallet.ready ? "Ready to sign" : "Operator fallback active"}>
        <p>{pathwayNote}</p>
      </Notice>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {STEP_ORDER.map((entry) => {
            const blocked = entry.needsDecision && !decisionId;
            const disabled = busyAny || blocked || (entry.step !== "create" && !actionId);
            return (
              <Panel key={entry.step}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold">{entry.title}</h2>
                    <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-600">{entry.body}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary shrink-0"
                    disabled={disabled}
                    onClick={() => void run(entry.step)}
                  >
                    {busy === entry.step ? "Waiting for the wallet..." : "Run"}
                  </button>
                </div>
                {blocked ? (
                  <p className="mt-2 text-[12px] text-signal-amber">
                    This step needs a decision id. Run step 2 first.
                  </p>
                ) : null}
              </Panel>
            );
          })}
        </div>

        <aside className="space-y-4">
          <Panel>
            <p className="eyebrow">Live state</p>
            <dl className="mt-3 space-y-2 text-[13px]">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Action</dt>
                <dd className="font-mono text-[12px]">{actionId ? middleTruncate(actionId, 8, 6) : "--"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Decision</dt>
                <dd className="font-mono text-[12px]">{decisionId ? middleTruncate(decisionId, 8, 6) : "--"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Contract state</dt>
                <dd className="font-semibold text-ink-800">{state}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-ink-500">Reason</dt>
                <dd className="text-right text-[12px] text-ink-600">{snapshot?.last_reason || "--"}</dd>
              </div>
            </dl>
            {actionId ? (
              <p className="mt-3">
                <a className="link text-[12px]" href={explorerAddressUrl(actionId)} target="_blank" rel="noreferrer">
                  Action on the explorer
                </a>
              </p>
            ) : null}
          </Panel>

          <Panel>
            <p className="eyebrow">Transaction ledger</p>
            {ledger.length === 0 ? (
              <p className="mt-2 text-[13px] text-ink-600">Nothing has been sent yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {ledger.map((entry) => (
                  <li key={`${entry.label}-${entry.at}`} className="border-t border-paper-200 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-700">
                        {entry.label}
                      </span>
                      <span
                        className={classNames(
                          "chip",
                          entry.ok ? "border-viridian-300 text-viridian-700" : "border-signal-rust text-signal-rust",
                        )}
                      >
                        {entry.ok ? "landed" : "refused"}
                      </span>
                    </div>
                    {entry.txHash ? (
                      <p className="mt-1 font-mono text-[11px] break-all text-ink-600">{entry.txHash}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-ink-500">
                      signed by the {entry.pathway === "wallet" ? "wallet" : "operator key"}
                    </p>
                    {entry.txHash ? (
                      <a className="link text-[12px]" href={explorerTxUrl(entry.txHash)} target="_blank" rel="noreferrer">
                        Verify on the explorer
                      </a>
                    ) : null}
                    <p className="mt-1 text-[12px] leading-relaxed text-ink-600">
                      {entry.detail ?? entry.note}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <p className="eyebrow">No wallet?</p>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-600">
              A wallet is only needed to sign. Everything already on chain is readable without one.
            </p>
            <button
              type="button"
              className="btn btn-quiet mt-3"
              onClick={() => setShowReplay((value) => !value)}
            >
              {showReplay ? "Hide the recorded run" : "Replay the recorded run"}
            </button>
          </Panel>
        </aside>
      </div>

      {showReplay ? <RecordedRun record={recorded} /> : null}
    </div>
  );
}

/**
 * The fallback: a run that already happened, replayed from its own record.
 *
 * This is not a simulation. Every hash below was written to disk by the
 * lifecycle script after the network returned it, and each one links to the
 * explorer. What it cannot do is produce a new transaction, which is exactly
 * why it is labelled rather than presented as a live walkthrough.
 */
function RecordedRun({ record }: { record: LiveLifecycleRecord | null }) {
  if (!record) {
    return (
      <Notice tone="warn" title="No recorded run in this checkout">
        <p>
          There is nothing to replay, so this panel shows nothing rather than an invented run.
        </p>
      </Notice>
    );
  }

  const steps = record.steps.filter((step) => step.name !== "capability_read_boundary" && step.name !== "capability_after_promotion" && step.name !== "settled");

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">Recorded live run</p>
        <span className="chip border-paper-300 text-ink-600">
          {record.completedAt ? new Date(record.completedAt).toISOString().replace(".000Z", "Z") : record.generatedAt}
        </span>
      </div>
      <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-600">
        One operator-signed run against these exact contracts on {record.network.name}. Outcome:{" "}
        <strong>{record.outcome}</strong>. Every transaction links to the explorer.
      </p>

      <ol className="mt-4 space-y-3">
        {steps.map((step) => (
          <li key={step.name} className="border-t border-paper-200 pt-3 first:border-t-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-700">{step.name}</span>
              {step.refusalCode ? (
                <span className="chip border-signal-amber text-signal-amber">{step.refusalCode}</span>
              ) : (
                <span className="chip border-viridian-300 text-viridian-700">{step.execStatus ?? "recorded"}</span>
              )}
            </div>
            {step.transaction ? (
              <p className="mt-1 font-mono text-[11px] break-all text-ink-600">{step.transaction}</p>
            ) : null}
            {step.explorer ? (
              <a className="link text-[12px]" href={String(step.explorer)} target="_blank" rel="noreferrer">
                Verify on the explorer
              </a>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[12px] text-ink-500">
        Contracts: gate {middleTruncate(record.contracts.decisionGate, 8, 6)}, vault{" "}
        {middleTruncate(record.contracts.finalityVault, 8, 6)}, registry{" "}
        {middleTruncate(record.contracts.scenarioRegistry, 8, 6)}.
      </p>
    </Panel>
  );
}
