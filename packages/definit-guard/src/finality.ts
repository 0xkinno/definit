import type { Lifecycle } from "./types.ts";

export type FinalityVerdict = "wait" | "contested" | "final" | "dead";

/**
 * The rule, in one function.
 *
 * Accepted is a draft: it can be appealed and replaced. Only Finalized is a fact.
 * `contested` means an appeal is in progress.
 */
export function finalityOf(lc: Lifecycle): FinalityVerdict {
  const status = lc.projectedStatus ?? lc.storedStatus ?? "";
  if (status === "Finalized" || status === "FINALIZED") return "final";
  if (status === "Canceled" || status === "Undetermined" || status === "Leader Timeout") return "dead";
  if (lc.decisionActive === true && lc.resolutionAction === "Appeal") return "contested";
  return "wait";
}

/** An irreversible effect is allowed only on `final`. */
export const mayExecute = (lc: Lifecycle): boolean => finalityOf(lc) === "final";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Yield lifecycle snapshots until the transaction is final (or dead).
 * The last snapshot yielded is the one that ended the watch.
 */
export async function* watchFinality(
  lifecycle: (txId: string) => Promise<Lifecycle>,
  txId: string,
  options: { intervalMs?: number; maxSamples?: number; signal?: AbortSignal } = {},
): AsyncGenerator<Lifecycle & { verdict: FinalityVerdict }> {
  const { intervalMs = 8000, maxSamples = 400, signal } = options;
  for (let i = 0; i < maxSamples; i++) {
    if (signal?.aborted) return;
    const snapshot = await lifecycle(txId);
    const verdict = finalityOf(snapshot);
    yield { ...snapshot, verdict };
    if (verdict === "final" || verdict === "dead") return;
    await sleep(intervalMs);
  }
}
