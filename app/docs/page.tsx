import Link from "next/link";

import { Shell } from "@/components/Shell";
import { Panel, SectionHeading } from "@/components/ui/primitives";

export const dynamic = "force-static";

export const metadata = { title: "Documents -- DEFINIT" };

/**
 * The documentation set, rendered from the same Markdown the repository ships.
 *
 * Keeping one copy matters: a document that exists only inside the application
 * drifts from the one under review, and a document that exists only on disk is
 * invisible to a reader who arrived through the product.
 */
const DOCUMENTS = [
  { slug: "DISCOVERY", title: "Discovery", lead: "The sponsor primitive, read in source, and the constraint that shaped the product." },
  { slug: "ARCHITECTURE", title: "Architecture", lead: "Both contracts, the commitment domain, and every refusal code." },
  { slug: "PROOF", title: "Proof", lead: "The corpus, the baseline, the intervention and the control." },
  { slug: "EVIDENCE", title: "Evidence", lead: "Deployment, the live lifecycle run, and how to reproduce both." },
  { slug: "LIMITATIONS", title: "Limitations", lead: "What is not proven, and what would show the claim is wrong." },
  { slug: "JUDGING_MAP", title: "Judging map", lead: "Where each criterion is answered, and by which artefact." },
];

export default function DocsIndexPage() {
  return (
    <Shell>
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6">
        <SectionHeading
          eyebrow="Documents"
          title="Everything claimed, in writing"
          lead="These are the repository's own Markdown files, rendered unedited. Where a document is silent, that silence is visible here too."
        />
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {DOCUMENTS.map((doc) => (
            <Link key={doc.slug} href={`/docs/${doc.slug}`} className="block">
              <Panel className="h-full transition-colors hover:border-brass-300">
                <p className="eyebrow">{doc.slug}</p>
                <p className="mt-2 text-[16px] font-semibold text-ink-900">{doc.title}</p>
                <p className="mt-2 text-[12.5px] leading-relaxed text-ink-600">{doc.lead}</p>
              </Panel>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-[12px] text-ink-500">
          The README and CONTRIBUTIONS.md live at the repository root and are not duplicated here.
        </p>
      </div>
    </Shell>
  );
}
