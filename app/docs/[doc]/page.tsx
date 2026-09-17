import { readFile } from "node:fs/promises";
import path from "node:path";

import Link from "next/link";

import { Shell } from "@/components/Shell";
import { Notice, SectionHeading } from "@/components/ui/primitives";
import { parseMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

/** Only these documents may be rendered. The route is not a file browser. */
const ALLOWED = new Set([
  "DISCOVERY",
  "ARCHITECTURE",
  "PROOF",
  "EVIDENCE",
  "LIMITATIONS",
  "JUDGING_MAP",
]);

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ doc: string }>;
}) {
  const { doc } = await params;
  const name = doc.toUpperCase();

  if (!ALLOWED.has(name)) {
    return (
      <Shell>
        <div className="mx-auto max-w-[820px] px-4 py-10 sm:px-6">
          <Notice tone="warn" title="No such document">
            <p>
              <span className="hash">{doc}</span> is not part of the shipped documentation set.
            </p>
            <p className="mt-2">
              <Link className="link" href="/docs">
                Back to the documents
              </Link>
            </p>
          </Notice>
        </div>
      </Shell>
    );
  }

  let blocks: ReturnType<typeof parseMarkdown> = [];
  let failure: string | null = null;
  try {
    const raw = await readFile(path.join(process.cwd(), "docs", `${name}.md`), "utf8");
    blocks = parseMarkdown(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  return (
    <Shell>
      <article className="mx-auto max-w-[820px] px-4 py-10 sm:px-6">
        <div className="no-print">
          <Link className="link text-[13px]" href="/docs">
            All documents
          </Link>
        </div>

        {failure ? (
          <div className="mt-6">
            <Notice tone="danger" title="The document could not be read">
              <p>{failure}</p>
            </Notice>
          </div>
        ) : null}

        <div className="mt-6 space-y-5">
          {blocks.map((block, index) => {
            if (block.kind === "heading") {
              if (block.level === 1) {
                return <SectionHeading key={index} eyebrow={name} title={block.text} />;
              }
              const sizes: Record<number, string> = {
                2: "mt-10 text-[20px]",
                3: "mt-8 text-[17px]",
                4: "mt-6 text-[15px]",
              };
              return (
                <h3
                  key={index}
                  className={`font-semibold text-ink-900 ${sizes[block.level] ?? "mt-6 text-[15px]"}`}
                >
                  {block.text}
                </h3>
              );
            }
            if (block.kind === "paragraph") {
              return (
                <p key={index} className="text-[14px] leading-relaxed text-ink-700 text-pretty">
                  {block.text}
                </p>
              );
            }
            if (block.kind === "code") {
              return (
                <pre
                  key={index}
                  className="overflow-x-auto rounded-lg border border-paper-300 bg-ink-900 p-4 text-[12px] leading-relaxed text-paper-100"
                >
                  {block.text}
                </pre>
              );
            }
            if (block.kind === "quote") {
              return (
                <blockquote
                  key={index}
                  className="border-l-2 border-brass-300 pl-4 text-[14px] italic leading-relaxed text-ink-600"
                >
                  {block.text}
                </blockquote>
              );
            }
            const ListTag = block.ordered ? "ol" : "ul";
            return (
              <ListTag
                key={index}
                className={`ml-5 space-y-2 text-[14px] leading-relaxed text-ink-700 ${
                  block.ordered ? "list-decimal" : "list-disc"
                }`}
              >
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}>{item}</li>
                ))}
              </ListTag>
            );
          })}
        </div>
      </article>
    </Shell>
  );
}
