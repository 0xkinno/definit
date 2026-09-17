import Link from "next/link";

import { BoundaryToggle } from "@/components/landing/BoundaryToggle";
import { FinalityDiagram } from "@/components/landing/FinalityDiagram";
import { HeroVisual } from "@/components/landing/HeroVisual";
import { ModeBadge, Shell } from "@/components/Shell";
import { Notice, Panel, SectionHeading } from "@/components/ui/primitives";
import { CHAIN_ID, CHAIN_NAME, RUNTIME_MODE } from "@/lib/config";
import { SCENARIO } from "@/lib/demo/scenario";
import { NOT_MEASURED_COPY, loadProofReport } from "@/lib/evidence";

export const dynamic = "force-static";

const CONTRADICTION = [
  {
    assumption: "What everyone assumes",
    text: "The network accepted the AI judgment, so the application can act.",
  },
  {
    assumption: "What the infrastructure actually says",
    text: "Accepted is still provisional. Finalized is the safe irreversible boundary.",
  },
];

const COMPARISON = [
  {
    label: "Ordinary smart contract",
    detail:
      "Can only act on facts that were already machine-readable. It cannot read a delivery record and decide what it means.",
  },
  {
    label: "Centralised AI endpoint",
    detail:
      "One server decides APPROVE and the application obeys it. There is no trust boundary at all, only a promise that the server is honest.",
  },
  {
    label: "GenLayer decision, treated naively",
    detail:
      "Validators reach consensus and the application settles immediately. The judgment is genuinely decentralised -- and it is still appealable. This is the gap DEFINIT closes.",
  },
  {
    label: "DEFINIT",
    detail:
      "The judgment is decentralised, and the effect is bound to the moment the judgment stops being reversible. Finality becomes an execution primitive instead of a status detail.",
  },
];

const MECHANISM = [
  {
    step: "01",
    title: "Commit the intent",
    body: "The agent's action is reduced to a canonical commitment over beneficiary, amount, policy hash, evidence digest, nonce and deadline.",
  },
  {
    step: "02",
    title: "Adjudicate the evidence",
    body: "Validators independently fetch the same public evidence and must agree on verdict, reason code and the exact evidence digest.",
  },
  {
    step: "03",
    title: "Hold the effect",
    body: "On acceptance nothing is released. The provisional record exists in one storage scope and is invisible in the other.",
  },
  {
    step: "04",
    title: "Cross the boundary",
    body: "Only a final-scope read can see the decision. The settlement instruction was emitted on the finalized stage and cannot run earlier.",
  },
  {
    step: "05",
    title: "Release exactly once",
    body: "The vault re-checks the commitment, the nonce and the final capability before value moves. A second delivery is refused.",
  },
];

export default async function LandingPage() {
  const { report, available } = await loadProofReport();

  return (
    <Shell>
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden border-b border-paper-300">
        <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:py-20">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="chip">GenLayer Agent Tank 2026</span>
              <ModeBadge />
            </div>

            <h1 className="mt-6 text-[34px] font-semibold leading-[1.08] tracking-tightest text-balance sm:text-[46px] lg:text-[54px]">
              The agent can be right.
              <br />
              <span className="text-ink-600">It can still be too early to act.</span>
            </h1>

            <p className="mt-6 max-w-prose text-[16px] leading-relaxed text-ink-600 text-pretty">
              DEFINIT is a finality firewall for autonomous payments. GenLayer can accept a
              judgment long before that judgment becomes final. DEFINIT makes irreversible
              effects wait for the one boundary that actually matters.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link className="btn-primary" href="/console">
                Run the live protection demo
              </Link>
              <Link className="btn-quiet" href="/lab">
                Inspect the finality path
              </Link>
            </div>

            <dl className="mt-10 grid gap-x-8 gap-y-4 border-t border-paper-300 pt-6 sm:grid-cols-3">
              <div>
                <dt className="label">Network</dt>
                <dd className="mt-1 text-[13px] font-medium">
                  {CHAIN_NAME}
                  <span className="block text-[12px] font-normal text-ink-500">
                    Chain ID {CHAIN_ID}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="label">Enforced by</dt>
                <dd className="mt-1 text-[13px] font-medium">
                  Intelligent contracts
                  <span className="block text-[12px] font-normal text-ink-500">
                    not by the interface
                  </span>
                </dd>
              </div>
              <div>
                <dt className="label">Release rule</dt>
                <dd className="mt-1 text-[13px] font-medium">
                  Finalized only
                  <span className="block text-[12px] font-normal text-ink-500">
                    accepted never settles
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          <div className="flex justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- contradiction */}
      <section className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="The contradiction"
          title="A judgment can be accepted before it is safe to treat as final."
          lead="This is not a bug in anyone's contract. It is a property of how the infrastructure separates agreement from irreversibility, and it is invisible unless you go looking for it."
        />
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {CONTRADICTION.map((item) => (
            <Panel key={item.assumption}>
              <p className="eyebrow">{item.assumption}</p>
              <p className="mt-3 font-display text-[19px] leading-snug text-ink-800">
                {item.text}
              </p>
            </Panel>
          ))}
        </div>
        <div className="mt-6">
          <Notice tone="warn" title="The dangerous boundary is not the decision. It is the gap after it.">
            An accepted judgment can still be appealed, and an appeal can change it. If a payment
            instruction already executed on the accepted path, the money has moved and the
            correction arrives too late.
          </Notice>
        </div>
      </section>

      {/* -------------------------------------------------------- boundary */}
      <section className="border-y border-paper-300 bg-paper-100/50">
        <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Accepted versus finalized"
            title="Two words, two completely different permissions."
            lead="Move between the two states and watch what changes. The instrument is not decorative: the position of the gate is the difference between holding and releasing."
          />
          <div className="mt-10">
            <BoundaryToggle />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ one example */}
      <section className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="One example, end to end"
          title="A treasury manager delegates one routine payment."
          lead="This is the whole product surface. One policy, one action, one judgment, one release. Nothing else is offered because nothing else is needed to make the point."
        />

        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <Panel>
            <p className="eyebrow">The delegation</p>
            <p className="mt-3 font-display text-[21px] leading-snug">
              &ldquo;{SCENARIO.plainLanguage}&rdquo;
            </p>
            <dl className="mt-5 divide-y divide-paper-200 border-t border-paper-200 text-[13px]">
              {[
                ["Agent", "Autonomous procurement agent"],
                ["Beneficiary", SCENARIO.supplier],
                ["Amount", `${SCENARIO.amount} ${SCENARIO.asset} (testnet)`],
                ["Purchase order", SCENARIO.purchaseOrder],
                ["Milestone", SCENARIO.milestone],
                ["Policy", `${SCENARIO.policyId} v${SCENARIO.policyVersion}`],
                ["Evidence", SCENARIO.evidenceLabel],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-6 py-2.5">
                  <dt className="text-ink-500">{label}</dt>
                  <dd className="text-right font-medium text-ink-800">{value}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel>
            <p className="eyebrow">What happens next</p>
            <ol className="mt-4 space-y-4">
              {[
                [
                  "Accepted arrives",
                  "Validators agree that the delivery record satisfies the policy. The console says accepted -- not final. Ten GEN stay exactly where they are.",
                ],
                [
                  "The window closes",
                  "The appeal window passes without the outcome changing. The decision becomes readable in final storage state.",
                ],
                [
                  "The release runs",
                  "The vault re-reads the final capability, compares it against the escrow commitment, checks the nonce, and releases ten GEN once.",
                ],
                [
                  "The receipt is written",
                  "A structured receipt records the action, the decision, the commitment and the read scope used to authorise the release.",
                ],
              ].map(([title, body]) => (
                <li key={title} className="border-l-2 border-brass-300 pl-4">
                  <p className="text-[14px] font-semibold text-ink-900">{title}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink-600">{body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-paper-200 pt-4 text-[13px] text-ink-600">
              No step in this sequence can be skipped by the interface, by the agent, or by a
              caller with a different address.
            </p>
          </Panel>
        </div>
      </section>

      {/* -------------------------------------------------- why not the rest */}
      <section className="border-y border-paper-300 bg-paper-100/50">
        <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Why this is not another escrow"
            title="Escrow is the visible outcome. Finality is the contribution."
            lead="Escrow answers who gets paid. DEFINIT answers a different question: when is it safe for the payment to become irreversible?"
          />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {COMPARISON.map((row, index) => (
              <div
                key={row.label}
                className={
                  index === COMPARISON.length - 1
                    ? "rounded-lg border border-viridian-300 bg-viridian-100/60 p-5"
                    : "rounded-lg border border-paper-300 bg-paper-0 p-5"
                }
              >
                <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-ink-700">
                  {row.label}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-ink-600">{row.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- mechanism */}
      <section className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
        <SectionHeading
          eyebrow="Technical mechanism"
          title="Five steps, and the fourth one is the product."
          lead="The first three are ordinary decentralised adjudication. The fourth is what makes an irreversible effect safe. The fifth is what makes it safe to repeat."
        />
        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {MECHANISM.map((item) => (
            <li key={item.step} className="panel p-5">
              <p className="font-mono text-[12px] text-brass-600">{item.step}</p>
              <p className="mt-3 text-[14px] font-semibold text-ink-900">{item.title}</p>
              <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{item.body}</p>
            </li>
          ))}
        </ol>

        <figure className="mt-8 overflow-hidden rounded-lg border border-paper-300 bg-paper-0">
          <FinalityDiagram />
          <figcaption className="sr-only">
            An action is adjudicated by independent validators and lands as ACCEPTED, which is
            provisional and still appealable. Releasing value at that point is refused while the
            appeal window is open. Only once the decision is FINALIZED may the escrow be released
            into SETTLEMENT.
          </figcaption>
        </figure>
      </section>

      {/* ------------------------------------------------------------- proof */}
      <section className="border-t border-paper-300">
        <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6">
          <SectionHeading
            eyebrow="Proof"
            title="Every number on this page is generated, not written."
            lead="The proof harness drives a corpus of adversarial cases against the same contract source and emits a machine-readable report. If the report is missing, this page shows nothing rather than a comforting figure."
          />

          {available && report ? (
            <>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    label: "Provisional settlements blocked",
                    value: `${report.metrics.provisionalSettlementsBlocked}`,
                  },
                  {
                    label: "Commitment mismatches blocked",
                    value: `${report.metrics.commitmentMismatchesBlocked}`,
                  },
                  {
                    label: "Replay attempts blocked",
                    value: `${report.metrics.replayAttemptsBlocked}`,
                  },
                  {
                    label: "Finalized settlements verified",
                    value: `${report.metrics.finalizedSettlementsVerified}`,
                  },
                ].map((metric) => (
                  <div key={metric.label} className="panel p-5">
                    <p className="font-display text-[30px] font-semibold leading-none">
                      {metric.value}
                    </p>
                    <p className="mt-2 text-[12px] uppercase tracking-[0.12em] text-ink-500">
                      {metric.label}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[12px] text-ink-500">
                Cases: {report.metrics.passing} of {report.metrics.totalCases} passing. Generated{" "}
                {report.generatedAt} by {report.source}.
              </p>
            </>
          ) : (
            <div className="mt-8">
              <Notice tone="neutral" title="No proof report in this checkout">
                {NOT_MEASURED_COPY}
              </Notice>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Link className="btn-quiet" href="/proof">
              Read the evidence
            </Link>
            <Link className="btn-quiet" href="/lab">
              Run the attacks yourself
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------- cta */}
      <section className="border-t border-paper-300 bg-ink-900 text-paper-100">
        <div className="mx-auto grid max-w-[1240px] gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <h2 className="font-display text-[26px] font-semibold leading-snug text-paper-50 sm:text-[32px]">
              Everyone asks whether the agent made the right decision.
            </h2>
            <p className="mt-3 max-w-prose font-display text-[20px] leading-snug text-brass-300">
              DEFINIT asks the more dangerous question: when does that decision become safe to act
              on?
            </p>
            {RUNTIME_MODE === "rehearsal" ? (
              <p className="mt-5 max-w-prose text-[13px] leading-relaxed text-paper-200/70">
                This instance is running without configured contract addresses, so the console
                labels itself as an offline rehearsal and produces no chain evidence.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className="btn-accent" href="/console">
              Open the console
            </Link>
            <Link
              className="btn border border-paper-100/25 bg-transparent text-paper-100 hover:border-paper-100/50"
              href="/docs"
            >
              Read the documents
            </Link>
          </div>
        </div>
      </section>
    </Shell>
  );
}
