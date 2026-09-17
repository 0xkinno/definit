/** Small presentation helpers. No domain meaning lives here. */

export function formatGen(amount: number, asset = "GEN"): string {
  return `${amount.toLocaleString("en-US")} ${asset}`;
}

export function formatTimestamp(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === "") return "--";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace(".000Z", "Z");
}

export function formatRelative(iso: string | undefined | null): string {
  if (!iso) return "--";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "--";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function middleTruncate(value: string, lead = 12, tail = 8): string {
  if (!value) return "--";
  if (value.length <= lead + tail + 3) return value;
  return `${value.slice(0, lead)}\u2026${value.slice(-tail)}`;
}

export function classNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
