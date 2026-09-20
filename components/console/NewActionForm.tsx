"use client";

/**
 * Register an action.
 *
 * This form does not invent its own write path. It calls the same `runWrite`
 * dispatcher the console and the lifecycle demo call, so the signing policy is
 * decided in exactly one place:
 *
 *   * a connected wallet signs the registration in the browser;
 *   * with no wallet, the request goes to the operator endpoint, which exists
 *     only when this deployment actually holds a key;
 *   * with no wallet and no key, the submit control is disabled and says so,
 *     rather than posting into a route that can only answer 503.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Notice, Panel } from "@/components/ui/primitives";
import { MILESTONE_AMOUNT_GEN, SCENARIO, deadlineUnixFromNow, genToWei } from "@/lib/demo/scenario";
import { signingState } from "@/lib/runtime/signing";
import { useWallet } from "@/lib/wallet/provider";
import { runWrite } from "@/lib/writes/run";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function NewActionForm({ operatorSigning }: { operatorSigning: boolean }) {
  const router = useRouter();
  const wallet = useWallet();
  const [recipient, setRecipient] = useState(SCENARIO.recipient);
  const [amount, setAmount] = useState(String(MILESTONE_AMOUNT_GEN));
  const [asset, setAsset] = useState(SCENARIO.asset);
  const [evidenceUrl, setEvidenceUrl] = useState(SCENARIO.evidenceUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string; txHash?: string } | null>(
    null,
  );

  const signing = signingState({ walletReady: wallet.ready, operatorSigning });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!signing.liveActionsEnabled) {
      setMessage({ tone: "warn", text: signing.detail });
      return;
    }
    if (!ADDRESS.test(recipient.trim())) {
      setMessage({ tone: "warn", text: "The beneficiary must be a 20-byte hex address." });
      return;
    }
    const amountWei = genToWei(Number(amount));
    if (!Number.isFinite(amountWei) || amountWei <= 0) {
      setMessage({ tone: "warn", text: "The amount must be greater than zero." });
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await runWrite(
        "create",
        {
          recipient: recipient.trim(),
          amountWei,
          asset,
          policyId: SCENARIO.policyId,
          evidenceUrl,
          deadlineUnix: deadlineUnixFromNow(),
        },
        wallet.handle,
      );

      if (!result.ok) {
        setMessage({ tone: "warn", text: result.detail ?? "The registration was refused." });
        return;
      }

      setMessage({
        tone: "ok",
        text: `Registered ${result.actionId ?? ""} -- signed by the ${
          result.pathway === "wallet" ? "connected wallet" : "operator key"
        }.`.trim(),
        txHash: result.txHash,
      });
      if (result.actionId) router.push(`/actions/${result.actionId}`);
    } catch (error) {
      setMessage({ tone: "warn", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="mb-4" data-signing-state={signing.key}>
        <Notice
          tone={signing.key === "wallet" ? "final" : signing.key === "operator" ? "neutral" : "warn"}
          title={signing.title}
        >
          <p>{signing.detail}</p>
        </Notice>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label" htmlFor="recipient">
            Beneficiary address
          </label>
          <input
            id="recipient"
            className="field mt-1"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="amount">
              Amount
            </label>
            <input
              id="amount"
              className="field mt-1"
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="asset">
              Asset
            </label>
            <input
              id="asset"
              className="field mt-1"
              value={asset}
              onChange={(event) => setAsset(event.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="evidence">
            Public evidence URL
          </label>
          <input
            id="evidence"
            className="field mt-1"
            value={evidenceUrl}
            onChange={(event) => setEvidenceUrl(event.target.value)}
            required
          />
          <p className="mt-1 text-[12px] text-ink-500">
            Fetched from inside the network, not from this machine. It must be reachable over HTTPS.
          </p>
        </div>

        <button
          type="submit"
          className="btn btn-primary w-full"
          disabled={busy || !signing.liveActionsEnabled}
        >
          {busy
            ? "Waiting for signature..."
            : signing.liveActionsEnabled
              ? "Register the action"
              : "Connect wallet to register"}
        </button>

        {message ? (
          <Notice
            tone={message.tone === "ok" ? "final" : "warn"}
            title={message.tone === "ok" ? "Registered" : "Refused"}
          >
            <p>{message.text}</p>
            {message.txHash ? (
              <p className="mt-2 font-mono text-[11px] break-all text-ink-600">{message.txHash}</p>
            ) : null}
          </Notice>
        ) : null}
      </form>
    </Panel>
  );
}
