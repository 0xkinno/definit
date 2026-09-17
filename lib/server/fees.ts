/**
 * Server-side fee construction for the console write path.
 *
 * A thin adapter: it resolves the recorded template and hands the work to
 * `lib/fees/plan.ts`, which is shared with the browser write path so both sign
 * the same fee tree.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { FEE_TEMPLATE } from "@/lib/fees/template-data";
import {
  planFees,
  type BuiltFees,
  type FeeTemplate,
  type WriteShape,
} from "@/lib/fees/plan";

export type { BuiltFees, WriteShape };

let cached: FeeTemplate | null | undefined;

function recordedTemplate(): FeeTemplate | null {
  if (cached !== undefined) return cached;
  try {
    cached = JSON.parse(
      readFileSync(path.join(process.cwd(), "artifacts", "fee-template.json"), "utf8"),
    ) as FeeTemplate;
  } catch {
    cached = null;
  }
  return cached;
}

/**
 * Prefer the file when it is present, so refreshing it locally takes effect
 * immediately; fall back to the bundled copy, which is what a deployment has.
 */
function template(): FeeTemplate {
  return recordedTemplate() ?? FEE_TEMPLATE;
}

export async function buildFees(
  client: never,
  write: WriteShape,
  messages: string[] = [],
): Promise<BuiltFees | undefined> {
  return planFees(client as never, write, messages, template());
}
