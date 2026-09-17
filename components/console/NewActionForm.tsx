"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Notice, Panel } from "@/components/ui/primitives";
import { MILESTONE_AMOUNT_GEN, SCENARIO, deadlineUnixFromNow, genToWei } from "@/lib/demo/scenario";

export function NewActionForm() {
  const router = useRouter();
  const [recipient, setRecipient] = useState(SCENARIO.recipient);
  const [amount, setAmount] = useState(String(MILESTONE_AMOUNT_GEN));
  const [asset, setAsset] = useState(SCENARIO.asset);
  const [evidenceUrl, setEvidenceUrl] = useState(SCENARIO.evidenceUrl);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          recipient,
          // The form collects GEN; the contract carries wei.
          amount: genToWei(Number(amount)),
          asset,
          policyId: SCENARIO.policyId,
          evidenceUrl,
          deadlineUnix: deadlineUnixFromNow(),
        }),
      });
      const payload = (await response.json()) as { actionId?: string; error?: string; detail?: string };
      if (!response.ok || payload.error) {
        setMessage({ tone: "warn", text: payload.detail ?? payload.error ?? "refused" });
        return;
      }
      setMessage({ tone: "ok", text: `Registered ${payload.actionId}` });
      if (payload.actionId) router.push(`/actions/${payload.actionId}`);
    } catch (error) {
      setMessage({ tone: "warn", text: String(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
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

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Registering..." : "Register the action"}
        </button>

        {message ? (
          <Notice tone={message.tone === "ok" ? "final" : "warn"} title={message.tone === "ok" ? "Registered" : "Refused"}>
            <p>{message.text}</p>
          </Notice>
        ) : null}
      </form>
    </Panel>
  );
}
