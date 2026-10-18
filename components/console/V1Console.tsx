"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FieldRow, Notice, Panel } from "@/components/ui/primitives";
import { explorerTxUrl } from "@/lib/config";
import { createReadClient } from "@/lib/genlayer/client";
import {
  POSTURES, V1, gen, makeKit, quoteWrite, readLifecycle, submitQuoted,
  type Lifecycle, type Quoted, type Write,
} from "@/lib/v1/console";
import { useWallet } from "@/lib/wallet/provider";

const ORIGIN = "https://definit-snowy.vercel.app/demo";
const EVIDENCE = {
  approve: { label: "Delivered in full", url: `${ORIGIN}/delivery-742.txt`, expect: "Expect APPROVE. The release is delivered by the protocol after finality." },
  partial: { label: "Partial delivery", url: `${ORIGIN}/delivery-742-partial.txt`, expect: "Expect REJECT. The refusal is delivered after finality and you withdraw." },
  injected: { label: "Partial delivery with an injected instruction", url: `${ORIGIN}/delivery-742-injected.txt`, expect: "Expect REJECT. The record tells the model to approve; the facts still decide." },
} as const;
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const AMOUNT = 10_000_000_000_000_000n; // 0.01 GEN

type EvidenceKey = keyof typeof EVIDENCE;
type Preset = keyof typeof POSTURES;

const unwrap = (v: unknown): Record<string, any> => (v instanceof Map ? Object.fromEntries(v) : ((v ?? {}) as Record<string, any>));

export function V1Console() {
  const wallet = useWallet();
  const reader = useMemo(() => createReadClient(), []);
  const [evidence, setEvidence] = useState<EvidenceKey>("approve");
  const [preset, setPreset] = useState<Preset>("standard");
  const [actionId, setActionId] = useState<string>("");
  const [adjTx, setAdjTx] = useState<string>("");
  const [txs, setTxs] = useState<Array<{ label: string; hash: string }>>([]);
  const [escrow, setEscrow] = useState<Record<string, any> | null>(null);
  const [lc, setLc] = useState<Lifecycle | null>(null);
  const [quote, setQuote] = useState<{ step: string; q: Quoted } | null>(null);
  const [appeal, setAppeal] = useState<{ charge: bigint } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deposits = useRef<Array<{ label: string; total: bigint }>>([]);
  const [depositTotal, setDepositTotal] = useState(0n);

  const ready = wallet.ready && !!wallet.handle.provider && !!wallet.address;
  const kit = useMemo(() => (ready ? makeKit(wallet.handle.provider!, wallet.address!) : null), [ready, wallet.handle.provider, wallet.address]);

  // Poll the protocol's own lifecycle and the vault's own state. Nothing is inferred from elapsed time.
  useEffect(() => {
    if (!actionId) return;
    let stop = false;
    const tick = async () => {
      try {
        const e = unwrap(await reader.readContract({ address: V1.vault as `0x${string}`, functionName: "get_escrow", args: [actionId] as never }));
        if (!stop) setEscrow(e);
      } catch { /* an escrow that does not exist yet is not an error */ }
      if (adjTx) {
        try { const l = await readLifecycle(adjTx); if (!stop) setLc(l); } catch { /* keep the last snapshot */ }
      }
    };
    void tick();
    const t = setInterval(tick, 9000);
    return () => { stop = true; clearInterval(t); };
  }, [actionId, adjTx, reader]);

  const record = (label: string, hash: string, total?: bigint) => {
    setTxs((p) => [...p, { label, hash }]);
    if (total !== undefined) { deposits.current.push({ label, total }); setDepositTotal(deposits.current.reduce((s, d) => s + d.total, 0n)); }
  };

  async function send(label: string, w: Write): Promise<string> {
    if (!kit) throw new Error("Connect a wallet first.");
    const q = await quoteWrite(kit, preset, w);
    setQuote({ step: label, q });
    const hash = await submitQuoted(kit, q, w, wallet.handle.client as never);
    record(label, hash, q.quote.total);
    return hash;
  }

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message.split("\n")[0] : String(e)); } finally { setBusy(null); }
  }

  const propose = () => run("propose", async () => {
    const deadline = Math.floor(Date.now() / 1000) + 7 * 86400;
    const nonce = Math.floor(Date.now() / 1000);
    const before = new Set(((await reader.readContract({ address: V1.gate as `0x${string}`, functionName: "list_actions_for", args: [wallet.address!.toLowerCase()] as never })) as unknown[]).map((r) => String(unwrap(r).action_id)));
    await send("create_action", { address: V1.gate, method: "create_action", args: [RECIPIENT, AMOUNT, "GEN", V1.policy.id, EVIDENCE[evidence].url, deadline, nonce] });
    // The gate lists the action once the transaction is accepted; poll for it rather than trust the hash.
    for (let i = 0; i < 20; i++) {
      const rows = (await reader.readContract({ address: V1.gate as `0x${string}`, functionName: "list_actions_for", args: [wallet.address!.toLowerCase()] as never })) as unknown[];
      const fresh = rows.map((r) => String(unwrap(r).action_id)).find((id) => !before.has(id));
      if (fresh) { setActionId(fresh); return; }
      await new Promise((r) => setTimeout(r, 4000));
    }
    throw new Error("The gate has not listed the action yet. Check the transaction and try again.");
  });

  const fund = () => run("fund", async () => {
    const a = unwrap(await reader.readContract({ address: V1.gate as `0x${string}`, functionName: "get_action", args: [actionId] as never }));
    await send("open_escrow", { address: V1.vault, method: "open_escrow", args: [actionId, a.recipient, BigInt(a.amount), a.asset, a.policy_hash, Number(a.nonce), Number(a.deadline_unix)], value: BigInt(a.amount) });
  });

  const adjudicate = () => run("adjudicate", async () => {
    const hash = await send("request_adjudication", { address: V1.gate, method: "request_adjudication", args: [actionId], messages: [{ recipient: V1.vault, method: "authorize_release" }, { recipient: V1.vault, method: "close_refused" }] });
    setAdjTx(hash);
  });

  const contest = () => run("contest", async () => {
    const client = wallet.handle.client as any;
    if (!appeal) { setAppeal({ charge: BigInt(await client.getAppealCharge({ txId: adjTx })) }); return; }
    const hash = await client.appealTransaction({ txId: adjTx, value: appeal.charge });
    record("appeal", String(hash));
    setAppeal(null);
  });

  const withdraw = () => run("withdraw", async () => { await send("withdraw_refund", { address: V1.vault, method: "withdraw_refund", args: [actionId] }); });

  const status = lc?.projectedStatus ?? "";
  const escrowState = String(escrow?.state ?? "");
  const hasAction = !!actionId;
  const funded = !!escrowState;
  const canContest = ready && status === "Accepted";
  const disabledWhy = ready ? null : "Connect a wallet to sign. Reading works without one.";
  const btn = "min-h-[44px] rounded-md border border-ink-900 bg-ink-900 px-4 text-[14px] font-medium text-paper-50 disabled:cursor-not-allowed disabled:opacity-40";
  const ghost = "min-h-[44px] rounded-md border border-ink-900 bg-paper-50 px-4 text-[14px] font-medium text-ink-900 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-6" data-testid="v1-console">
      <Panel>
        <h2 className="text-[20px] font-semibold text-ink-900">1. Choose the evidence</h2>
        <p className="mt-1 text-[14px] text-ink-600">One payment of 0.01 GEN, judged against policy <span className="hash">{V1.policy.id}</span>.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Evidence record">
          {(Object.keys(EVIDENCE) as EvidenceKey[]).map((k) => (
            <label key={k} className={`cursor-pointer rounded-lg border p-4 ${evidence === k ? "border-ink-900 bg-paper-100" : "border-paper-300 bg-paper-50"} ${hasAction ? "opacity-60" : ""}`}>
              <input type="radio" name="evidence" aria-label={EVIDENCE[k].label} className="sr-only" checked={evidence === k} disabled={hasAction} onChange={() => setEvidence(k)} />
              <span className="block text-[14px] font-medium text-ink-900">{EVIDENCE[k].label}</span>
              <span className="mt-1 block text-[13px] text-ink-600">{EVIDENCE[k].expect}</span>
            </label>
          ))}
        </div>
      </Panel>

      <Panel>
        <h2 className="text-[20px] font-semibold text-ink-900">2. Send it through the protocol</h2>
        {disabledWhy ? <p className="mt-2 text-[13px] text-ink-600" data-testid="v1-gate-note">{disabledWhy}</p> : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className={btn} disabled={!ready || !!busy || hasAction} onClick={propose} data-step="propose">{busy === "propose" ? "Signing…" : "Propose"}</button>
          <button className={btn} disabled={!ready || !!busy || !hasAction || funded} onClick={fund} data-step="fund">{busy === "fund" ? "Signing…" : "Fund escrow"}</button>
          <button className={btn} disabled={!ready || !!busy || !funded || !!adjTx} onClick={adjudicate} data-step="adjudicate">{busy === "adjudicate" ? "Signing…" : "Request adjudication"}</button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <label className="label block" htmlFor="posture">Appeal posture</label>
            <select id="posture" className="mt-1 min-h-[44px] w-full rounded-md border border-paper-300 bg-paper-50 px-3 text-[14px]" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
              {(Object.keys(POSTURES) as Preset[]).map((p) => <option key={p} value={p}>{POSTURES[p].label} ({POSTURES[p].rounds} funded round{POSTURES[p].rounds > 1 ? "s" : ""})</option>)}
            </select>
            <p className="mt-2 text-[13px] text-ink-600">{POSTURES[preset].line}</p>
          </div>
          <div className="rounded-lg border border-paper-300 bg-paper-50 p-4" data-testid="fee-receipt">
            <span className="label block">Fee receipt</span>
            <FieldRow label="Deposit (last quote)" value={quote ? `${gen(quote.q.quote.total)} GEN` : "no quote yet"} mono />
            <FieldRow label="Quote source" value={quote ? quote.q.quote.source : "-"} />
            <FieldRow label="Fee policy check" value={quote ? quote.q.quote.verification.status : "-"} />
            <FieldRow label="Pending ahead" value={quote?.q.quote.queue ? String(quote.q.quote.queue.pendingAhead) : "-"} />
            <FieldRow label="Deposited this session" value={`${gen(depositTotal)} GEN`} mono />
            <p className="mt-2 text-[12px] text-ink-500">Spent and refund are settled by the protocol when each transaction finalizes. They are not estimated here.</p>
          </div>
        </div>
        {quote?.q.blocked ? <div className="mt-4"><Notice tone="danger" title="Signing is blocked">{quote.q.blocked}</Notice></div> : null}
        {error ? <div className="mt-4"><Notice tone="warn" title="Not sent">{error}</Notice></div> : null}
      </Panel>

      <Panel>
        <h2 className="text-[20px] font-semibold text-ink-900">3. Watch it become final</h2>
        <p className="mt-1 text-[14px] text-ink-600">Accepted is a draft. This payment moves at Finalized, through a delivery the protocol creates.</p>
        <div className="mt-3 grid gap-1 sm:grid-cols-2" data-testid="v1-state">
          <FieldRow label="Action" value={actionId || "none yet"} mono truncate />
          <FieldRow label="Deciding transaction" value={lc?.projectedStatus ?? (adjTx ? "reading" : "not requested")} />
          <FieldRow label="Next protocol step" value={lc?.resolutionAction ?? "-"} />
          <FieldRow label="Vault escrow" value={escrowState || "none"} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button className={ghost} disabled={!canContest || !!busy} onClick={contest} data-step="contest">
            {appeal ? `Confirm appeal (bond ${gen(appeal.charge)} GEN)` : "Contest this verdict"}
          </button>
          <button className={ghost} disabled={!ready || !!busy || escrowState !== "REFUNDABLE"} onClick={withdraw} data-step="withdraw">Withdraw refund</button>
        </div>
        <p className="mt-2 text-[12px] text-ink-500">Contest is offered only while the verdict is Accepted. Finalizing is done by the protocol; there is no button because there is no public path that could release early.</p>
      </Panel>

      {txs.length ? (
        <Panel>
          <h2 className="text-[16px] font-semibold text-ink-900">Transactions</h2>
          <ul className="mt-2 space-y-1 text-[13px]">
            {txs.map((t) => (
              <li key={t.hash}><span className="label mr-2">{t.label}</span><a className="hash underline" href={explorerTxUrl(t.hash)} target="_blank" rel="noreferrer">{t.hash.slice(0, 14)}…{t.hash.slice(-6)}</a></li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}
