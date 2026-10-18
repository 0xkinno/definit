import { FinalityClock } from "@/components/milestone/FinalityClock";
import { Shell } from "@/components/Shell";
import { Notice, Panel, SectionHeading } from "@/components/ui/primitives";
import { milestone as m, proofLine } from "@/lib/milestone/data";

export const dynamic = "force-static";
export const metadata = { title: "Milestone v1: protocol-delivered finality -- DEFINIT" };

const FORMULA = [
  { beat: "Pain", copy: "Your agent paid on an AI verdict. The verdict was appealed. The money is gone." },
  { beat: "Product", copy: "DEFINIT makes the verdict itself release the payment, and only after GenLayer finalizes it." },
  { beat: "Why it is special", copy: "There is no timer and no status check. The payment is a message the protocol will not deliver until the appeal window has passed." },
];

function Row({ cells, head = false }: { cells: React.ReactNode[]; head?: boolean }) {
  const Cell = head ? "th" : "td";
  return (
    <tr className="border-b border-paper-300 last:border-0">
      {cells.map((c, i) => (
        <Cell key={i} className={`px-3 py-2 text-left align-top text-[13px] ${head ? "label font-semibold" : ""}`}>
          {c}
        </Cell>
      ))}
    </tr>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-paper-300 bg-paper-0">
      <table className="w-full min-w-[520px] border-collapse">
        <thead><Row head cells={head} /></thead>
        <tbody>{rows.map((r, i) => <Row key={i} cells={r} />)}</tbody>
      </table>
    </div>
  );
}

const short = (a: string) => `${a.slice(0, 10)}...${a.slice(-6)}`;

export default function MilestonePage() {
  const { counterfactual: cf, corpus, property, deployment: d } = m;
  const arms = [
    ["Pay on Accepted", cf.arms.baseline],
    [`Fixed timer (${cf.medianWindowSeconds} s, the measured window)`, cf.arms.control],
    ["DEFINIT v0 timer rule (120 s)", cf.arms.v0],
    ["DEFINIT v1", cf.arms.v1],
  ] as const;

  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <SectionHeading
          level={1}
          eyebrow="Milestone v1"
          title="Payments now wait for GenLayer's own finality, not a timer"
          lead="Release authority is a protocol delivery. The vault releases value only when it receives an on='finalized' message from the bound gate, and that message does not exist until the deciding transaction has survived its appeal window."
        />

        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {FORMULA.map((f) => (
            <li key={f.beat} className="rounded-md border border-paper-300 bg-paper-0 p-5">
              <p className="eyebrow">{f.beat}</p>
              <p className="mt-2 text-[15px] leading-relaxed">{f.copy}</p>
            </li>
          ))}
        </ol>

        <Panel className="mt-6">
          <p className="eyebrow">The proof, generated</p>
          <p data-testid="proof-line" className="mt-2 text-[15px] leading-relaxed">{proofLine()}</p>
          <p className="mt-2 text-[12px] text-ink-500">
            Computed by <span className="hash">scripts/counterfactual.mjs</span> over {cf.timelines} recorded timelines and re-derived by <span className="hash">npm run verify:offline</span>.
          </p>
        </Panel>

        {/* --------------------------------------------------- finality clock */}
        <section className="mt-14" aria-labelledby="clock">
          <SectionHeading id="clock" eyebrow="Finality clock" title="Accepted is a draft. These payments moved at Finalized." lead={`Each timeline is drawn from the chain's own timestamps on ${m.network.name}. Nodes link to the explorer.`} />
          <div className="mt-6 grid gap-6">
            {m.runs.map((run) => (
              <Panel key={run.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[16px] font-semibold">
                    {run.id}: {run.kind === "approve" ? "approved payment" : run.kind === "reject" ? "refused payment" : "approved payment, appealed inside the window"}
                  </h3>
                  <span className="chip">{run.verdict} &middot; {run.reasonCode}</span>
                </div>
                <FinalityClock run={run} />
                <p className="mt-3 text-[13px] text-ink-700">
                  Vault: {run.escrow.join(" then ")}.{" "}
                  {run.receipt ? <>Receipt: {run.receipt.finalitySource}, delivered by <span className="hash">{short(run.receipt.deliveredBy)}</span>.</> : "No receipt: nothing was released."}
                </p>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
                  {run.links.createAction && <a className="link" href={run.links.createAction} target="_blank" rel="noreferrer">create_action</a>}
                  {run.links.openEscrow && <a className="link" href={run.links.openEscrow} target="_blank" rel="noreferrer">open_escrow</a>}
                  <a className="link" href={run.links.adjudication} target="_blank" rel="noreferrer">adjudication</a>
                  <a className="link" href={run.links.delivery} target="_blank" rel="noreferrer">delivery</a>
                  {run.links.withdraw && <a className="link" href={run.links.withdraw} target="_blank" rel="noreferrer">withdraw_refund</a>}
                </p>
              </Panel>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------- live contracts */}
        <section className="mt-14" aria-labelledby="contracts">
          <SectionHeading id="contracts" eyebrow="Live contracts" title="v1 on Studio-dev, readable without a wallet" lead={`Deployed ${d.deployedAt.slice(0, 10)} to ${m.network.name} (chain ${m.network.chainId}). The vault is bound to the gate; it reports clock: ${String(d.describe.vault.clock)}.`} />
          <div className="mt-6">
            <Table
              head={["Contract", "Address", "Rule it reports"]}
              rows={[
                ["DecisionGate v1", <a key="g" className="link hash" href={d.links.decisionGate} target="_blank" rel="noreferrer">{d.addresses.decisionGate}</a>, `${String(d.describe.gate.finality_rule)}; clock ${String(d.describe.gate.clock)}`],
                ["FinalityVault v1", <a key="v" className="link hash" href={d.links.finalityVault} target="_blank" rel="noreferrer">{d.addresses.finalityVault}</a>, `${String(d.describe.vault.finality_rule)}; clock ${String(d.describe.vault.clock)}`],
                ["ScenarioRegistry v1", <a key="r" className="link hash" href={d.links.scenarioRegistry} target="_blank" rel="noreferrer">{d.addresses.scenarioRegistry}</a>, `policy ${d.policy.id} ${d.policy.version}`],
              ]}
            />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {Object.entries(m.sizes).map(([name, s]) => (
              <div key={name} className="rounded-md border border-paper-300 bg-paper-0 p-4">
                <p className="label">{name}</p>
                <p className="mt-1 text-[13px]">{s.minifiedBytes.toLocaleString("en-US")} bytes minified</p>
                <p className="text-[12px] text-ink-500">{s.readableBytes.toLocaleString("en-US")} bytes readable</p>
              </div>
            ))}
          </div>
        </section>

        {/* --------------------------------------------------- counterfactual */}
        <section className="mt-14" aria-labelledby="cf">
          <SectionHeading id="cf" eyebrow="Counterfactual" title="Four rules, the same recorded timelines" lead="Unsafe means a payment executed before the deciding decision's appeal deadline. The rules are small enough to audit in a minute." />
          <div className="mt-6">
            <Table
              head={["Rule", "Unsafe payments", "Legitimate releases refused", "Median seconds from Finalized to payment"]}
              rows={arms.map(([label, a]) => [label, `${a.unsafe} of ${a.of}`, String(a.refusedLegitimate), String(a.medianSecondsFromFinalToPayment)])}
            />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Notice tone="danger" title={`The v0 hole, measured: ${cf.v1FunderPath.unsafe} of ${cf.v1FunderPath.of} funder releases ran early`}>
              In v0 the funder could call settle while the promotion transaction was only {m.differential.promotionLifecycle.projectedStatus} (resolutionAction {m.differential.promotionLifecycle.resolutionAction}). The settle was decided at {m.differential.settleDecidedAt}, before the promotion&apos;s appeal deadline {m.differential.promotionAppealDeadline}, and the vault recorded {m.differential.vaultStatus}.{" "}
              <a className="link" href={m.differential.link} target="_blank" rel="noreferrer">The transaction</a>.
            </Notice>
            <Notice tone="warn" title="What this does not show">
              {cf.caveats.map((c) => <span key={c} className="mb-1 block">{c}</span>)}
            </Notice>
          </div>
        </section>

        {/* --------------------------------------------------------- invariants */}
        <section className="mt-14" aria-labelledby="inv">
          <SectionHeading id="inv" eyebrow="Invariants" title={`${corpus.headline.cases} cases, ${property.lifecycles.toLocaleString("en-US")} random lifecycles`} lead="Counts are generated and every breakdown sums to its headline." />
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Table
              head={["Invariant", "Cases", "Passed", "Attacked by"]}
              rows={corpus.byInvariant.map((r) => [r.invariant, String(r.cases), String(r.passed), r.attackedBy])}
            />
            <div className="grid gap-4">
              <Table
                head={["Refusal code", `Count (sums to ${corpus.headline.refusals})`]}
                rows={Object.entries(corpus.refusalsByCode).map(([k, v]) => [k, String(v)])}
              />
              <p className="text-[13px] text-ink-700">
                {corpus.headline.recordedNoops} deliveries were recorded no-ops. The property suite ran {property.lifecycles.toLocaleString("en-US")} random lifecycles over {property.seeds} seeds ({property.events.toLocaleString("en-US")} events) against the vault and a pure model; they agreed on every refusal, no-op, state and unit of value.
              </p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------------- faults */}
        <section className="mt-14" aria-labelledby="faults">
          <SectionHeading id="faults" eyebrow="Fault matrix" title="What was attacked, and where" lead="A row nothing exercised is shown as not exercised, never as a pass." />
          <div className="mt-6">
            <Table
              head={["", "Fault", "Expected", "Where", "Status"]}
              rows={m.faults.map((f) => [f.id, f.fault, f.expected, f.where, <span key={f.id} className="chip">{f.status}</span>])}
            />
          </div>
        </section>

        {/* ---------------------------------------------------- evidence integrity */}
        <section className="mt-14" aria-labelledby="verify">
          <SectionHeading id="verify" eyebrow="Offline verification" title="Every claim is re-derived from recorded evidence" lead={`npm run verify:offline recomputes hashes and timing without calling the network or a model: ${m.verification.pass} checks pass, ${m.verification.fail} fail.`} />
          <div className="mt-6">
            <Table head={["Check", "What it re-derives", "Status"]} rows={m.verification.checks.map((c) => [c.id, c.title, <span key={c.id} className="chip">{c.status}</span>])} />
          </div>
          <div className="mt-6">
            <p className="label">Evidence snapshots served from the DEFINIT domain, with their keccak digests</p>
            <div className="mt-2">
              <Table head={["File", "Digest"]} rows={m.evidenceFiles.map((e) => [<a key={e.file} className="link" href={e.url} target="_blank" rel="noreferrer">{e.file}</a>, <span key={e.digest} className="hash break-all">{e.digest}</span>])} />
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ adoption and checks */}
        <section className="mt-14" aria-labelledby="extras">
          <SectionHeading id="extras" eyebrow="Beyond the suite" title="Checks that try to break the checks, and a package to adopt the rule" lead="Each number below is read from a generated evidence file." />
          <div className="mt-6 grid gap-4 md:grid-cols-2" data-testid="extras">
            {m.extras.mutation ? (
              <Panel>
                <p className="label">Mutation sweep</p>
                <p className="mt-1 text-[15px] font-semibold text-ink-900">{m.extras.mutation.killed} of {m.extras.mutation.total} weakened vaults were caught{m.extras.mutation.survived ? `; ${m.extras.mutation.survived} survived` : ""}</p>
                <p className="mt-1 text-[13px] text-ink-600">Each mutant removes one guard from {m.extras.mutation.target}. A mutant that survives is a guard no test depends on.</p>
              </Panel>
            ) : null}
            <Panel>
              <p className="label">Parity with the contracts</p>
              <p className="mt-1 text-[15px] font-semibold text-ink-900">{m.extras.parity.vectors} vectors, TypeScript equals Python</p>
              <p className="mt-1 text-[13px] text-ink-600">The commitment encoding exists twice. Both must hash every vector identically. The suite found that amounts above 2^53 were unsafe as numbers, and the TypeScript side now takes a bigint or string.</p>
            </Panel>
            {m.extras.books ? (
              <Panel>
                <p className="label">Books</p>
                <p className="mt-1 text-[15px] font-semibold text-ink-900">{m.extras.books.escrows} escrows reconcile: in equals out plus held{m.extras.books.balanced ? "" : " (does not balance)"}</p>
                <p className="mt-1 text-[13px] text-ink-600">Read from the vault records and the emitted transfers, not from balances, because Studio-dev does not credit emitted transfers.</p>
              </Panel>
            ) : null}
            {m.extras.injected ? (
              <Panel>
                <p className="label">Injected evidence</p>
                <p className="mt-1 text-[15px] font-semibold text-ink-900">A record told the model to approve. Verdict: {m.extras.injected.verdict} ({m.extras.injected.reasonCode})</p>
                <p className="mt-1 text-[13px] text-ink-600">The refusal was delivered at finality and the funder withdrew. <a className="link" href={m.extras.injected.adjudication} target="_blank" rel="noreferrer">Adjudication</a>{m.extras.injected.delivery ? <> and <a className="link" href={m.extras.injected.delivery} target="_blank" rel="noreferrer">delivery</a></> : null} on the explorer.</p>
              </Panel>
            ) : null}
            <Panel>
              <p className="label">Fee profile and Transaction Kit</p>
              <p className="mt-1 text-[15px] font-semibold text-ink-900">Quoted from a measured profile, blocked on a stale quote</p>
              <p className="mt-1 text-[13px] text-ink-600">{m.extras.feeProfile.methods.filter((x) => x.basis === "simulation").length} methods are measured by simulation; the rest use the network default and say so. The console never sets allowUnverified.</p>
            </Panel>
            <Panel>
              <p className="label">definit-guard and agent skill</p>
              <p className="mt-1 text-[15px] font-semibold text-ink-900">{m.extras.guard.tests} package tests</p>
              <p className="mt-1 text-[13px] text-ink-600">An autonomous agent ran through the package on the live network and treated a payment as done only when the vault held a receipt. The skill lives at <span className="hash">{m.extras.guard.skill}</span>.</p>
              {m.extras.agentRuns.length ? (
                <ul className="mt-2 space-y-1 text-[13px]">
                  {m.extras.agentRuns.map((a) => (
                    <li key={a.kind}>Agent run ({a.kind}): vault {a.state}. <a className="link" href={a.adjudication} target="_blank" rel="noreferrer">Adjudication</a></li>
                  ))}
                </ul>
              ) : null}
            </Panel>
          </div>
        </section>

        {/* ------------------------------------------------------------- networks */}
        <section className="mt-14 mb-6" aria-labelledby="net">
          <SectionHeading id="net" eyebrow="Networks" title="Measured, including where it did not work" />
          <div className="mt-6">
            <Table
              head={["Network", "Chain", "Lifecycle method", "Executes contracts", "Funding"]}
              rows={m.networks.map((n) => [n.network, String(n.chainId), String(n.lifecycleMethod), String(n.executesContracts), n.funding])}
            />
          </div>
          <div className="mt-4">
            <Notice tone="neutral" title="Where this stands">
              Every recorded run is on Studio-dev, the only network that was funded and that answers the lifecycle projection. The Bradbury faucet requires a wallet holding mainnet ETH, so Bradbury runs are pending. Studio-dev does not credit a value transfer a contract emits (a standalone probe is recorded), so the evidence is the emitted finalized-stage transfer message and the vault&apos;s state and receipt, not a balance.
            </Notice>
          </div>
        </section>
      </div>
    </Shell>
  );
}
