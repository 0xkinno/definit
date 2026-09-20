import Link from "next/link";

import { Shell } from "@/components/Shell";
import { FieldRow, Notice, Panel, SectionHeading, StatusPill } from "@/components/ui/primitives";
import { explorerAddressUrl, explorerTxUrl, RUNTIME_MODE, RUNTIME_MODE_DETAIL } from "@/lib/config";
import {
  NOT_RECORDED_COPY,
  loadLiveLifecycle,
  type LiveLifecycleRecord,
} from "@/lib/evidence";
import { contracts, readClient } from "@/lib/genlayer/contracts";
import {
  adjudicateRehearsal,
  buildRehearsalAction,
  finalizeRehearsal,
  fullAttemptCorpus,
  settleRehearsal,
} from "@/lib/demo/rehearsal";
import { middleTruncate, formatGen } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Lifecycle -- DEFINIT" };

/** The seven stages the live run performs, in order, with what each one proves. */
const STAGES = [
  { key: "create_action", label: "Register the action", method: "DecisionGate.create_action", proves: "The commitment is derived by the contract, not supplied by the caller." },
  { key: "request_adjudication", label: "Adjudicate the evidence", method: "DecisionGate.request_adjudication", proves: "Validators reach a verdict. The action becomes ACCEPTED -- and nothing has moved." },
  { key: "early_promotion_attempt", label: "Try to promote too early", method: "DecisionGate.finalize_decision", proves: "The contract refuses. This is the boundary doing work rather than being described." },
  { key: "open_escrow", label: "Fund the escrow", method: "FinalityVault.open_escrow", proves: "Value is committed. The vault reads the beneficiary and amount from the decision contract." },
  { key: "finalize_decision", label: "Promote after the window", method: "DecisionGate.finalize_decision", proves: "Only now is FINAL reachable. The gate writes the promotion itself." },
  { key: "settle", label: "Request the release", method: "FinalityVault.settle", proves: "Every guard runs again inside the value-holding contract, including the window." },
  { key: "settled", label: "Read the receipt", method: "FinalityVault.get_receipt", proves: "An audit-grade record of what was checked is stored on chain." },
] as const;

function stageFor(record: LiveLifecycleRecord, key: string) {
  return record.steps.find((step) => step.name === key) ?? null;
}

function HashLink({ value, kind }: { value: string; kind: "tx" | "address" }) {
  const href = kind === "tx" ? explorerTxUrl(value) : explorerAddressUrl(value);
  return (
    <a className="hash link break-all text-[12px]" href={href} target="_blank" rel="noreferrer">
      {value}
    </a>
  );
}

function ExecBadge({ status }: { status?: string | null }) {
  if (!status) return <span className="text-[12px] text-ink-500">not reported</span>;
  const refused = status !== "return" && status !== "success";
  return (
    <span
      className={
        refused
          ? "chip border-signal-rust text-signal-rust"
          : "chip border-viridian-300 text-viridian-700"
      }
    >
      {status}
    </span>
  );
}

function LiveWalkthrough({ record }: { record: LiveLifecycleRecord }) {
  const early = record.boundary.earlyPromotion;
  const sample = record.boundary.samples?.[0];

  return (
    <>
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Panel className="!p-4">
          <p className="eyebrow">Recorded</p>
          <p className="mt-2 text-[15px] font-semibold text-ink-900">
            {record.outcome === "complete" ? "Complete run" : "Partial run"}
          </p>
          <p className="mt-1 text-[12px] text-ink-500">{record.completedAt ?? record.generatedAt}</p>
        </Panel>
        <Panel className="!p-4">
          <p className="eyebrow">Read scopes disagreed</p>
          <p className="mt-2 font-display text-[22px] font-semibold leading-none">
            {String(record.boundary.observableOnThisNetwork === true)}
          </p>
          <p className="mt-1 text-[12px] text-ink-500">
            {sample
              ? `provisional ${String(sample.provisionalExists)} / finalized ${String(sample.finalExists)} while tx=${sample.transactionStatus}`
              : "no sample recorded"}
          </p>
        </Panel>
        <Panel className="!p-4">
          <p className="eyebrow">Early promotion refused</p>
          <p className="mt-2 font-display text-[22px] font-semibold leading-none">
            {String(early?.refused === true)}
          </p>
          <p className="mt-1 text-[12px] text-ink-500">
            {early?.reasonCode ? `contract answered ${early.reasonCode}` : "no refusal recorded"}
          </p>
        </Panel>
      </div>

      {record.outcome !== "complete" ? (
        <div className="mt-6">
          <Notice tone="warn" title={`This run stopped at ${record.blockedAt ?? "an unnamed stage"}`}>
            <p>
              The record is written either way, so a stopped run produces a document rather than an
              absence of one. The network said: <span className="hash">{record.blockedReason}</span>
            </p>
          </Notice>
        </div>
      ) : null}

      <ol className="mt-8 space-y-3">
        {STAGES.map((stage, index) => {
          const step = stageFor(record, stage.key);
          const tx = typeof step?.transaction === "string" ? step.transaction : null;
          return (
            <li key={stage.key}>
              <Panel className="!p-4 sm:!p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                  <div className="flex items-baseline gap-3">
                    <span className="font-display text-[15px] font-semibold text-ink-500">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3 className="text-[15px] font-semibold text-ink-900">{stage.label}</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="hash text-[11px] text-ink-500">{stage.method}</span>
                    <ExecBadge status={step?.execStatus ?? null} />
                  </div>
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{stage.proves}</p>
                {step ? (
                  <dl className="mt-3">
                    {tx ? (
                      <FieldRow
                        label="Transaction"
                        mono
                        value={<HashLink value={tx} kind="tx" />}
                      />
                    ) : (
                      <FieldRow label="Transaction" value="read-only stage, no transaction" />
                    )}
                    {step.refusalCode ? (
                      <FieldRow label="Contract said" mono value={step.refusalCode} />
                    ) : null}
                    {step.detail ? (
                      <FieldRow label="Detail" mono value={String(step.detail)} />
                    ) : null}
                  </dl>
                ) : (
                  <p className="mt-3 text-[12px] text-ink-500">
                    This stage is not present in the record.
                  </p>
                )}
              </Panel>
            </li>
          );
        })}
      </ol>

      <Panel className="mt-8">
        <SectionHeading
          eyebrow="Settlement receipt"
          title="What the vault wrote down when it paid out"
          lead="The receipt is stored by the contract, so it survives any front end. The scope field names the property that was checked before value moved."
        />
        <dl className="mt-4">
          <FieldRow label="Status" value={record.settlement.status ?? "not settled"} />
          <FieldRow
            label="Amount"
            value={formatGen(Number(record.settlement.amountWei ?? 0) / 1e18, "GEN")}
          />
          <FieldRow label="Beneficiary" mono value={record.settlement.recipient ?? "(none)"} />
          <FieldRow
            label="Checked against"
            mono
            value={record.settlement.decisionReadScope ?? "(none)"}
          />
          <FieldRow label="Finality proof" value={record.settlement.finalityProof ?? "(none)"} />
          <FieldRow
            label="Settled at"
            value={record.settlement.settledAt ?? "(not settled)"}
          />
          {record.settlement.transaction ? (
            <FieldRow
              label="Release transaction"
              mono
              value={<HashLink value={record.settlement.transaction} kind="tx" />}
            />
          ) : null}
        </dl>
      </Panel>

      <Panel className="mt-6">
        <SectionHeading
          eyebrow="Deployment"
          title="The contracts this record was taken from"
          lead="Addresses are read from the running configuration, so this page cannot show one deployment while the record came from another without the mismatch being visible."
        />
        <dl className="mt-4">
          <FieldRow
            label="DecisionGate"
            mono
            value={<HashLink value={record.contracts.decisionGate} kind="address" />}
          />
          <FieldRow
            label="FinalityVault"
            mono
            value={<HashLink value={record.contracts.finalityVault} kind="address" />}
          />
          <FieldRow
            label="ScenarioRegistry"
            mono
            value={<HashLink value={record.contracts.scenarioRegistry} kind="address" />}
          />
          <FieldRow label="Operator" mono value={record.operator} />
          <FieldRow
            label="Action"
            mono
            value={record.actionId ? record.actionId : "(not recorded)"}
          />
        </dl>
      </Panel>
    </>
  );
}

function FallbackWalkthrough() {
  const initial = buildRehearsalAction();
  const accepted = adjudicateRehearsal(initial);
  const finalized = finalizeRehearsal(accepted);
  const settled = settleRehearsal(finalized);
  const attempts = fullAttemptCorpus(finalized, true);

  const stages = [
    { label: "Register the action", state: initial, note: "A commitment is derived over the action's terms." },
    { label: "Adjudicate the evidence", state: accepted, note: "APPROVE. The action is accepted -- still appealable, and nothing has moved." },
    { label: "Promote after the window", state: finalized, note: "FINALLY reachable. The gate writes the promotion itself." },
    { label: "Request the release", state: settled, note: "The vault re-checks every guard, then pays." },
  ];

  return (
    <>
      <div className="mt-6">
        <Notice tone="warn" title="Offline replay -- not chain evidence">
          <p>{NOT_RECORDED_COPY}</p>
          <p className="mt-2">
            Nothing below has a transaction hash, because nothing below happened on a network. It
            runs the same state machine and the same refusal rules in the browser so the walkthrough
            still works with no keys and no connectivity.
          </p>
        </Notice>
      </div>

      <ol className="mt-8 space-y-3">
        {stages.map((stage, index) => (
          <li key={stage.label}>
            <Panel className="!p-4 sm:!p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-baseline gap-3">
                  <span className="font-display text-[15px] font-semibold text-ink-500">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h3 className="text-[15px] font-semibold text-ink-900">{stage.label}</h3>
                </div>
                <StatusPill size="sm" state={stage.state.state} showAppealable />
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{stage.note}</p>
            </Panel>
          </li>
        ))}
      </ol>

      <Panel className="mt-6">
        <SectionHeading
          eyebrow="Refusals, replayed"
          title="What the boundary rejects"
          lead="Each attempt below is evaluated against the same rules the contract enforces. They are labelled BLOCKED or PASS, and a suite in which everything is blocked would be a failure, not a success."
        />
        <ul className="mt-4 space-y-2">
          {attempts.map((attempt) => (
            <li
              key={attempt.label}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-paper-200 py-3 last:border-b-0"
            >
              <span className="text-[13px] font-medium text-ink-800">{attempt.label}</span>
              <span className="flex items-center gap-3">
                <span className="hash text-[11px] text-ink-500">{attempt.invariant}</span>
                <span
                  className={
                    attempt.outcome === "BLOCKED"
                      ? "chip border-signal-rust text-signal-rust"
                      : "chip border-viridian-300 text-viridian-700"
                  }
                >
                  {attempt.outcome}
                </span>
              </span>
              <p className="w-full text-[12px] text-ink-600">{attempt.detail}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

async function liveActionState(actionId: string): Promise<Record<string, unknown> | null> {
  if (RUNTIME_MODE !== "live" || !/^0x[0-9a-fA-F]{64}$/.test(actionId)) return null;
  try {
    const action = await contracts.getAction(readClient(), actionId);
    return action as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default async function LifecyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { record, available } = await loadLiveLifecycle();
  const onChain = await liveActionState(id);

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <SectionHeading
          level={1}
          eyebrow="Lifecycle"
          title="Watch one action cross the finality boundary"
          lead="Registration, adjudication, a refusal, funding, promotion and release -- every stage written down with the transaction that produced it. Where no live record exists, the walkthrough falls back to a local replay and says so on the page."
        />

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="chip border-paper-300 text-ink-600">
            action {middleTruncate(id, 14, 8)}
          </span>
          <Link className="link" href="/actions">
            All actions
          </Link>
          <Link className="link" href="/console">
            Drive it from the console
          </Link>
        </div>

        {RUNTIME_MODE !== "live" ? (
          <div className="mt-6">
            <Notice tone="warn" title="This build is in rehearsal">
              <p>{RUNTIME_MODE_DETAIL}</p>
            </Notice>
          </div>
        ) : null}

        {onChain ? (
          <Panel className="mt-6">
            <SectionHeading
              eyebrow="Live read"
              title="This action, read from the decision contract now"
              lead="Read straight from chain, not from the record. If the record and the chain ever disagreed, this panel is where it would show."
            />
            <dl className="mt-4">
              <FieldRow label="State" value={String(onChain.state ?? "(unknown)")} />
              <FieldRow label="Decision" mono value={String(onChain.decision_id ?? "(none)")} />
              <FieldRow
                label="Amount"
                value={formatGen(Number(onChain.amount ?? 0) / 1e18, String(onChain.asset ?? "GEN"))}
              />
              <FieldRow label="Policy" mono value={String(onChain.policy_id ?? "(none)")} />
            </dl>
          </Panel>
        ) : null}

        {available && record ? <LiveWalkthrough record={record} /> : <FallbackWalkthrough />}

        <Panel className="mt-8">
          <SectionHeading
            eyebrow="Why there is a fallback"
            title="A demonstration that only works when everything works is not a demonstration"
            lead="The offline replay runs the same refusal rules as the contract, so the walkthrough still teaches the boundary with no keys, no funds and no connectivity. It is labelled everywhere it appears, and it never claims a transaction hash."
          />
          <p className="mt-4 text-[13px] leading-relaxed text-ink-600">
            The two are deliberately not mergeable. A live record is evidence and carries explorer
            links; a replay is an explanation and carries none. Conflating them would be the easiest
            way to make this product dishonest, so the page keeps them visually and structurally
            separate.
          </p>
        </Panel>
      </div>
    </Shell>
  );
}
