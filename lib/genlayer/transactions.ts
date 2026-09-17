/**
 * Transaction lifecycle handling.
 *
 * The rules this module enforces, in order of importance:
 *
 *   1. A transaction id is persisted the moment it exists, before anything else.
 *   2. Polling reads lifecycle; it never re-sends.
 *   3. A timeout or a hanging round is surfaced as unresolved, never as failure.
 *      Re-submitting in that window is how an agent pays a supplier twice.
 *   4. Downstream action is only permitted once the protocol reports the
 *      finalisation resolution.
 */

import type { TransactionLifecycle } from "genlayer-js/types";

import { toDefinitLifecycle, type LifecycleReading } from "@/lib/lifecycle/map";
import type { DefinitLifecycle } from "@/lib/lifecycle/state";
import { asHash, createReadClient } from "@/lib/genlayer/client";

export interface TrackedTransaction {
  hash: string;
  actionId?: string;
  decisionId?: string;
  /** What the caller believed it was doing. */
  intent: "create_action" | "open_escrow" | "request_adjudication" | "finalize_decision" | "publish_policy" | "unknown";
  submittedAt: string;
  /** Last reading, so the UI can resume after a reload. */
  lastState?: DefinitLifecycle;
  lastReason?: string;
  lastCheckedAt?: string;
}

const STORAGE_KEY = "definit.transactions.v1";

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listTracked(): TrackedTransaction[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TrackedTransaction[]) : [];
  } catch {
    return [];
  }
}

function persist(all: TrackedTransaction[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(all.slice(-200)));
  } catch {
    /* storage full or unavailable: polling still works, it just will not resume */
  }
}

export function trackTransaction(entry: Omit<TrackedTransaction, "submittedAt"> & { submittedAt?: string }): TrackedTransaction {
  const record: TrackedTransaction = {
    ...entry,
    submittedAt: entry.submittedAt ?? new Date().toISOString(),
  };
  const all = listTracked().filter((item) => item.hash !== record.hash);
  all.push(record);
  persist(all);
  return record;
}

export function updateTracked(hash: string, patch: Partial<TrackedTransaction>): void {
  const all = listTracked();
  const index = all.findIndex((item) => item.hash === hash);
  if (index === -1) return;
  all[index] = { ...all[index], ...patch };
  persist(all);
}

export function forgetTracked(hash: string): void {
  persist(listTracked().filter((item) => item.hash !== hash));
}

export function clearTracked(): void {
  persist([]);
}

export interface LifecycleSnapshot {
  hash: string;
  lifecycle: TransactionLifecycle | null;
  rawStatus: string | null;
  resolutionAction: string | null;
  decisionActive: boolean | null;
  reading: LifecycleReading;
  /** True when the protocol reports the finalisation resolution. */
  final: boolean;
  fetchedAt: string;
  error?: string;
}

/**
 * Read the protocol lifecycle for one transaction.
 *
 * `resolutionAction === "Finalize"` is the protocol's finalisation capability
 * and is the only signal this module treats as permission to proceed.
 */
export async function readLifecycle(hash: string): Promise<LifecycleSnapshot> {
  const client = createReadClient();
  try {
    const raw = await client.getTransaction({ hash: asHash(hash) });
    const status = String((raw as unknown as { status_name?: string; statusName?: string }).status_name
      ?? (raw as unknown as { status_name?: string }).status_name
      ?? (raw as unknown as { status?: string }).status
      ?? "");

    let protocolLifecycle: { resolutionAction?: string; decisionActive?: boolean } | null = null;
    try {
      protocolLifecycle = await client.advanced.getTransactionLifecycle({
        hash: asHash(hash),
      });
    } catch {
      // The advanced read is an enhancement, not a requirement: the stored
      // status still answers the only question that matters here.
      protocolLifecycle = null;
    }

    const lifecycle = (
      (raw as unknown as { lifecycle?: TransactionLifecycle }).lifecycle ?? null
    ) as TransactionLifecycle | null;

    const reading = toDefinitLifecycle({
      txStatus: status,
      txLifecycle: lifecycle as never,
      resolutionAction: protocolLifecycle?.resolutionAction ?? null,
    });

    const snapshot: LifecycleSnapshot = {
      hash,
      lifecycle,
      rawStatus: status || null,
      resolutionAction: protocolLifecycle?.resolutionAction ?? null,
      decisionActive: protocolLifecycle?.decisionActive ?? null,
      reading,
      final: reading.state === "finalized",
      fetchedAt: new Date().toISOString(),
    };

    updateTracked(hash, {
      lastState: reading.state,
      lastReason: reading.reason,
      lastCheckedAt: snapshot.fetchedAt,
    });

    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      hash,
      lifecycle: null,
      rawStatus: null,
      resolutionAction: null,
      decisionActive: null,
      reading: {
        state: "proposing",
        reason: `The transaction could not be read (${message}). That is not evidence that it failed. It will be retried by polling, and it will never be resubmitted.`,
        decidedBy: "read failure",
        unresolved: true,
      },
      final: false,
      fetchedAt: new Date().toISOString(),
      error: message,
    };
  }
}

/** Poll interval schedule: fast at first, then patient. */
export function pollDelays(attempt: number): number {
  if (attempt < 10) return 3000;
  if (attempt < 30) return 6000;
  return 12000;
}

export const NEVER_RESUBMIT_NOTE =
  "Timeouts and hanging rounds are unresolved states, not failures. DEFINIT never re-sends a transaction on timeout.";
