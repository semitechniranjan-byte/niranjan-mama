/**
 * Shared rendering for call outcomes.
 *
 * The disposition is the single most important thing a collections client looks at, so it
 * gets one consistent treatment everywhere it appears - dashboard, campaign detail and
 * call history - rather than each page inventing its own badge.
 *
 * Codes are grouped by what they mean commercially: a promise to pay is a win, a refusal
 * is a loss, an unreachable number is neither. Colour follows that grouping so a client
 * can read a list at a glance without knowing the codes.
 */
import {
  IconCheck,
  IconClock,
  IconHourglass,
  IconPhone,
  IconTarget,
  IconUser,
  IconX,
} from "./Icons";
import type { ComponentType } from "react";

export type DispositionTone = {
  /** Tailwind classes for a filled badge. */
  badge: string;
  /** Tailwind classes for a soft tile used on stat cards. */
  tile: string;
  /** Accent used for the numeric value on a card. */
  value: string;
  Icon: ComponentType<{ size?: number }>;
  /** Commercial grouping, used for the summary counters. */
  group: "won" | "pending" | "lost" | "unreached";
};

const WON: Omit<DispositionTone, "Icon"> = {
  badge: "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200",
  tile: "bg-emerald-50 text-emerald-600",
  value: "text-emerald-700",
  group: "won",
};
const PENDING: Omit<DispositionTone, "Icon"> = {
  badge: "bg-amber-100 text-amber-800 ring-1 ring-amber-200",
  tile: "bg-amber-50 text-amber-600",
  value: "text-amber-700",
  group: "pending",
};
const LOST: Omit<DispositionTone, "Icon"> = {
  badge: "bg-rose-100 text-rose-800 ring-1 ring-rose-200",
  tile: "bg-rose-50 text-rose-600",
  value: "text-rose-700",
  group: "lost",
};
const UNREACHED: Omit<DispositionTone, "Icon"> = {
  badge: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  tile: "bg-slate-100 text-slate-500",
  value: "text-slate-600",
  group: "unreached",
};

const TONES: Record<string, DispositionTone> = {
  PTP: { ...WON, Icon: IconTarget },
  ALREADY_PAID: { ...WON, Icon: IconCheck },
  PARTIAL_PAID: { ...WON, Icon: IconCheck },
  FPTP: { ...PENDING, Icon: IconHourglass },
  CB: { ...PENDING, Icon: IconClock },
  CP: { ...PENDING, Icon: IconClock },
  RTP: { ...LOST, Icon: IconX },
  NC: { ...LOST, Icon: IconX },
  LM: { ...UNREACHED, Icon: IconUser },
  NR: { ...UNREACHED, Icon: IconPhone },
  RNR: { ...UNREACHED, Icon: IconPhone },
  WN: { ...UNREACHED, Icon: IconUser },
  ICR: { ...UNREACHED, Icon: IconPhone },
};

const FALLBACK: DispositionTone = { ...UNREACHED, Icon: IconPhone };

export function dispositionTone(code?: string | null): DispositionTone {
  if (!code) return FALLBACK;
  return TONES[code.toUpperCase()] ?? FALLBACK;
}

/** Compact coloured pill. Use anywhere a single call's outcome is shown. */
export function DispositionBadge({
  code,
  label,
  size = "md",
}: {
  code?: string | null;
  label?: string;
  size?: "sm" | "md";
}) {
  if (!code) {
    return (
      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400">
        Pending analysis
      </span>
    );
  }
  const tone = dispositionTone(code);
  const pad = size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${pad} ${tone.badge}`}
      title={label || code}
    >
      <tone.Icon size={size === "sm" ? 11 : 13} />
      {code.toUpperCase()}
    </span>
  );
}

/** Stat tile for a disposition count, used on the dashboard and campaign stats. */
export function DispositionCard({
  code,
  label,
  count,
  amount,
}: {
  code: string;
  label?: string;
  count: number;
  amount?: number;
}) {
  const tone = dispositionTone(code);
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.tile}`}>
        <tone.Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-slate-600" title={label || code}>
          {label || code}
        </div>
        <div className={`text-xl font-semibold ${tone.value}`}>{count}</div>
        {amount != null && amount > 0 && (
          <div className="text-[11px] text-slate-400">
            ₹<span className="font-medium text-slate-600">{amount.toLocaleString("en-IN")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Mask a phone number for display: country code, then the last three digits.
 *
 * Operator screens are shown in meetings and over screen shares, and a full list of
 * debtor numbers is not something to leave on a projector.
 */
export function maskPhone(value?: string | null): string {
  if (!value) return "-";
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length < 5) return value;
  const cc = value.trim().startsWith("+") ? `+${digits.slice(0, digits.length - 10)}` : "";
  const last = digits.slice(-3);
  const hidden = "•".repeat(6);
  return `${cc} ${hidden} ${last}`.trim();
}
