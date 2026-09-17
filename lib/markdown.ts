/**
 * A deliberately small Markdown renderer.
 *
 * The documentation set is shipped as Markdown and has to be readable inside
 * the application without pulling a parser and a sanitiser into the bundle for
 * a handful of headings and lists. It supports exactly the subset the
 * documentation uses: headings, paragraphs, fenced code, bullets, numbered
 * items and blockquotes.
 *
 * Anything it does not understand is rendered as text rather than dropped.
 */

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string; language: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string };

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const language = fence[1] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", text: body.join("\n"), language });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        body.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: body.join(" ").trim() });
      continue;
    }

    const bullet = /^[-*]\s+/.test(line);
    const numbered = /^\d+[.)]\s+/.test(line);
    if (bullet || numbered) {
      const items: string[] = [];
      while (index < lines.length) {
        const candidate = lines[index];
        if (bullet && /^[-*]\s+/.test(candidate)) {
          items.push(candidate.replace(/^[-*]\s+/, "").trim());
          index += 1;
        } else if (numbered && /^\d+[.)]\s+/.test(candidate)) {
          items.push(candidate.replace(/^\d+[.)]\s+/, "").trim());
          index += 1;
        } else if (candidate.trim() && !/^(#{1,6}\s|```)/.test(candidate) && items.length) {
          items[items.length - 1] = `${items[items.length - 1]} ${candidate.trim()}`;
          index += 1;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered: numbered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6}\s|```|>\s?|[-*]\s|\d+[.)]\s)/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}
