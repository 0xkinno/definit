import type { ReactNode } from "react";

import { lifecycleOf, type DefinitLifecycle } from "@/lib/lifecycle/state";
import { classNames, middleTruncate } from "@/lib/format";

export function Panel({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "aside";
}) {
  return <Tag className={classNames("panel p-5 sm:p-6", className)}>{children}</Tag>;
}

export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  id?: string;
}) {
  return (
    <div className="max-w-prose">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h2 id={id} className="mt-2 text-2xl font-semibold text-balance sm:text-[28px]">
        {title}
      </h2>
      {lead ? <p className="mt-3 text-[15px] leading-relaxed text-ink-600 text-pretty">{lead}</p> : null}
    </div>
  );
}

export function FieldRow({
  label,
  value,
  mono = false,
  hint,
  truncate = false,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  hint?: string;
  truncate?: boolean;
}) {
  const text = typeof value === "string" ? value : undefined;
  return (
    <div className="grid gap-1 border-b border-paper-200 py-3 last:border-b-0 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-4">
      <dt className="label pt-[2px]">{label}</dt>
      <dd
        className={classNames(
          "min-w-0 text-[13px] text-ink-800",
          mono ? "hash" : "",
        )}
        title={text}
      >
        {truncate && text ? middleTruncate(text, 18, 10) : value}
        {hint ? <span className="mt-1 block text-[12px] text-ink-500">{hint}</span> : null}
      </dd>
    </div>
  );
}

const TONE_CLASSES: Record<string, string> = {
  neutral: "border-paper-300 bg-paper-100 text-ink-700",
  progress: "border-brass-300 bg-brass-100 text-brass-700",
  provisional: "border-signal-amber bg-signal-ambersoft text-signal-amber",
  final: "border-viridian-300 bg-viridian-100 text-viridian-700",
  failure: "border-signal-rust bg-signal-rustsoft text-signal-rust",
  frozen: "border-signal-slate bg-signal-slatesoft text-signal-slate",
};

export function StatusPill({
  state,
  size = "md",
  showAppealable = false,
}: {
  state: DefinitLifecycle;
  size?: "sm" | "md" | "lg";
  showAppealable?: boolean;
}) {
  const descriptor = lifecycleOf(state);
  const sizes = {
    sm: "text-[10px] px-2 py-[3px] tracking-[0.14em]",
    md: "text-[11px] px-3 py-1 tracking-[0.14em]",
    lg: "text-[13px] px-4 py-[7px] tracking-[0.16em]",
  } as const;
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-2 rounded-full border font-semibold uppercase",
        TONE_CLASSES[descriptor.tone],
        sizes[size],
      )}
    >
      <span
        aria-hidden="true"
        className={classNames(
          "h-[7px] w-[7px] rounded-full",
          descriptor.effectPermitted ? "bg-viridian-600" : "bg-current opacity-70",
        )}
      />
      {descriptor.label}
      {showAppealable && descriptor.appealable ? (
        <span className="font-normal normal-case tracking-normal opacity-80">still appealable</span>
      ) : null}
    </span>
  );
}

export function KeyValueStrip({
  items,
  className,
}: {
  items: Array<{ label: string; value: ReactNode }>;
  className?: string;
}) {
  return (
    <dl
      className={classNames(
        "grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="label">{item.label}</dt>
          <dd className="mt-1 truncate text-[13px] font-medium text-ink-800">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Notice({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warn" | "final" | "danger";
  title: string;
  children?: ReactNode;
}) {
  const tones = {
    neutral: "border-paper-300 bg-paper-100",
    warn: "border-signal-amber/40 bg-signal-ambersoft",
    final: "border-viridian-300 bg-viridian-100",
    danger: "border-signal-rust/40 bg-signal-rustsoft",
  } as const;
  return (
    <div className={classNames("rounded-md border p-4", tones[tone])} role="note">
      <p className="text-[13px] font-semibold text-ink-900">{title}</p>
      {children ? (
        <div className="mt-1 text-[13px] leading-relaxed text-ink-700">{children}</div>
      ) : null}
    </div>
  );
}
