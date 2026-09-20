"use client";

import { useCallback, useEffect, useState } from "react";

import { FieldRow, Notice, Panel, StatusPill } from "@/components/ui/primitives";
import { explorerTxUrl } from "@/lib/config";
import type { DefinitLifecycle } from "@/lib/lifecycle/state";
import { formatGen, middleTruncate } from "@/lib/format";
import { useWallet } from "@/lib/wallet/provider";
import { signingState } from "@/lib/runtime/signing";
import { runWrite, type WriteStep } from "@/lib/writes/run";

interface Capability {
  exists?: boolean;
  verdict?: string;
  reason_code?: string;
  action_id?: string;
  read_scope?: string;
}

interface ActionState {
  exists?: boolean;
  state?: string;
  intent_hash?: string;
  evidence_digest?: string;
  decision_id?: string;
  last_reason?: string;
}

interface ActionPayload {
  actionId: string;
  action: ActionState;
  escrow: Record<string, unknown>;
  receipt: Record<string, unknown>;
  capability: { provisionalScope: Capability | null; finalScope: Capability | null };
}

interface StepResult {
  txHash?: string;
  status?: string | null;
  note?: string;
  error?: string;
  detail?: string;
}

const LIFECYCLE_BY_CONTRACT_STATE: Record<string, DefinitLifecycle> = {
  SUBMITTED: "proposing",
  ADJUDICATING: "proposing",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  FINALIZED: "finalized",
  HELD: "held",
  SETTLED: "settled",
};

export function ConsoleBoard({
  operatorSigning,
}: {
  /** Resolved on the server. False means no live write pathway exists here. */
  operatorSigning: boolean;
}) {
  const [state, setState] = useState<ActionPayload | null>(null);
  const [actionId, setActionId] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<
    { tone: string; text: string; txHash?: string; pathway?: string } | null
  >(null);
  const [started, setStarted] = useState(false);
  const wallet = useWallet();

  const refresh = useCallback(async (id: string) => {
    if (!id) return;
    const response = await fetch(`/api/actions/${id}`, { cache: "no-store" });
    if (!response.ok) return;
    setState((await response.json()) as ActionPayload);
  }, []);

  useEffect(() => {
    if (!actionId) return;
    let cancelled = false;
    const tick = async () => {
      if (!cancelled) await refresh(actionId);
    };
    void tick();
    const timer = setInterval(tick, 12000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [actionId, refresh]);

  /**
   * Run one step.
   *
   * With a wallet connected the step is signed in the browser; without one it
   * is handed to the operator endpoint. The result says which happened, and
   * the transaction hash is offered for independent verification either way.
   */
  async function post(step: WriteStep, label?: string) {
    setBusy(label ?? step);
    setMessage(null);
    try {
      if (!signing.liveActionsEnabled) {
        setMessage({ tone: "warn", text: signing.detail });
        return null;
      }
      const result = await runWrite(
        step,
        { actionId, decisionId: state?.action?.decision_id },
        wallet.handle,
      );

      setMessage({
        tone: result.ok ? "ok" : "warn",
        text: result.ok
          ? `${result.note ?? "Step submitted."} Signed by the ${
              result.pathway === "wallet" ? "connected wallet" : "operator key"
            }.`
          : result.detail ?? "The step was refused.",
        txHash: result.txHash,
        pathway: result.pathway,
      });

      if (result.actionId) {
        setActionId(result.actionId);
        await refresh(result.actionId);
      } else if (result.ok && actionId) {
        await refresh(actionId);
      }
      return result;
    } catch (error) {
      setMessage({ tone: "warn", text: String(error) });
      return null;
    } finally {
      setBusy(null);
    }
  }

  const contractState = state?.action?.state ?? "";
  const lifecycle: DefinitLifecycle = LIFECYCLE_BY_CONTRACT_STATE[contractState] ?? "draft";
  const signing = signingState({ walletReady: wallet.ready, operatorSigning });
  const writesDisabled = busy !== null || !signing.liveActionsEnabled;

  return (
    <div className="space-y-5" data-signing-state={signing.key}>
      <Notice
        tone={signing.key === "wallet" ? "final" : signing.key === "operator" ? "neutral" : "warn"}
        title={signing.title}
      >
        <p>{signing.detail}</p>
      </Notice>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">1 &middot; Register the action</h2>
          <button
            type="button"
            className="btn btn-primary"
            disabled={writesDisabled}
            onClick={async () => {
              setStarted(true);
              await post("create");
            }}
          >
            {busy === "create"
              ? "Waiting for signature..."
              : signing.liveActionsEnabled
                ? "Register the demo action"
                : "Connect wallet to register"}
          </button>
        </div>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-600">
          Registration records the commitment the agent intends to act on. The evidence digest is
          deliberately empty at this point: it cannot exist before the judgement does.
        </p>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">2 &middot; Adjudicate, then wait</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn"
              disabled={!actionId || writesDisabled}
              onClick={() => post("adjudicate")}
            >
              {busy === "adjudicate"
                ? "Waiting for signature..."
                : signing.liveActionsEnabled
                  ? "Adjudicate the evidence"
                  : "Wallet required"}
            </button>
            <button
              type="button"
              className="btn"
              disabled={!actionId || writesDisabled}
              onClick={() => post("finalize")}
            >
              {busy === "finalize"
                ? "Waiting for signature..."
                : signing.liveActionsEnabled
                  ? "Promote to final"
                  : "Wallet required"}
            </button>
          </div>
        </div>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-600">
          An approving judgement lands as <strong>ACCEPTED</strong>, which is provisional. Promotion
          does not settle anything: it asks the vault to try, and the vault re-derives the appeal
          window from the gate's own record before it decides.
        </p>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">3 &middot; Fund and release</h2>
          <button
            type="button"
            className="btn"
            disabled={!actionId || writesDisabled}
            onClick={() => post("escrow")}
          >
            {busy === "escrow"
              ? "Waiting for signature..."
              : signing.liveActionsEnabled
                ? "Open the escrow"
                : "Wallet required"}
          </button>
        </div>
        <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-ink-600">
          The escrow derives its beneficiary and amount from the recorded commitment, not from this
          request. A caller cannot name a different payee.
        </p>
      </Panel>

      {message ? (
        <Notice tone={message.tone === "ok" ? "final" : "warn"} title={message.tone === "ok" ? "Done" : "Refused"}>
          <p>{message.text}</p>
          {message.txHash ? (
            <>
              <p className="mt-2 font-mono text-[11px] break-all text-ink-600">{message.txHash}</p>
              <p className="mt-1">
                <a
                  className="link text-[12px]"
                  href={explorerTxUrl(message.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Verify this transaction on the explorer
                </a>
              </p>
            </>
          ) : null}
          <p className="mt-1 text-[12px] text-ink-500">
            Pathway: {message.pathway === "wallet" ? "signed by your wallet" : "signed by the operator key"}.
          </p>
        </Notice>
      ) : null}

      {!signing.liveActionsEnabled ? (
        <Notice tone="warn" title="Live writes are unavailable here">
          <p>
            Every control above is disabled because neither signing pathway exists in this session.
            Connect a Studio Next wallet from the header, and they enable themselves. Nothing on
            this page is mocked: a disabled button is disabled because the route behind it would
            refuse.
          </p>
        </Notice>
      ) : null}

      {!started ? (
        <Notice tone="neutral" title="Nothing has been sent">
          <p>
            Registering an action is the only step that costs anything, and it costs a fraction of
            test GEN. Nothing moves until the final step, and that step is refused while the
            judgement is still appealable.
          </p>
        </Notice>
      ) : null}

      {state ? (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Live state</h2>
            <StatusPill state={lifecycle} showAppealable />
          </div>

          <dl className="mt-4">
            <FieldRow
              label="Action"
              value={state.actionId}
              mono
              truncate
              hint="The commitment identifier derived by the decision contract."
            />
            <FieldRow
              label="Decision"
              value={state.action?.decision_id || "--"}
              mono
              truncate
            />
            <FieldRow label="Contract state" value={state.action?.state || "unknown"} />
            <FieldRow
              label="Provisional scope"
              value={
                state.capability?.provisionalScope?.exists
                  ? `${state.capability.provisionalScope.verdict ?? "readable"}`
                  : "not readable"
              }
              hint="The default read. This is what an integration sees when it treats a decided judgment as actionable."
            />
            <FieldRow
              label="Final scope"
              value={
                state.capability?.finalScope?.exists
                  ? `${state.capability.finalScope.verdict ?? "readable"}`
                  : "not readable"
              }
              hint="Scoped to the latest finalized transaction. It executes here, and it also answers for a decision that is still appealable, so it is a diagnostic rather than a boundary. The vault re-derives the appeal window instead."
            />
            <FieldRow
              label="Escrow"
              value={
                (state.escrow as { exists?: boolean; state?: string })?.exists
                  ? `${(state.escrow as { state?: string }).state}`
                  : "not funded"
              }
            />
            <FieldRow
              label="Receipt"
              value={
                (state.receipt as { exists?: boolean; status?: string })?.exists
                  ? `${(state.receipt as { status?: string }).status}`
                  : "not written"
              }
              hint="A receipt only exists once value has actually moved."
            />
            {(state.escrow as { amount?: number })?.amount ? (
              <FieldRow
                label="Amount"
                value={formatGen(
                  Number((state.escrow as { amount?: number }).amount ?? 0) / 1e18,
                  "GEN",
                )}
              />
            ) : null}
          </dl>

          {(state.receipt as { exists?: boolean })?.exists ? (
            <p className="mt-4">
              <a className="link" href={`/receipts/${state.actionId}`}>
                Open the settlement receipt
              </a>
            </p>
          ) : null}

          <p className="mt-4 text-[12px] text-ink-500">
            Action {middleTruncate(state.actionId, 14, 8)}
          </p>
        </Panel>
      ) : null}
    </div>
  );
}
