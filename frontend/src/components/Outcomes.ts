/**
 * The six outcomes a collections desk actually works from.
 *
 * Thirteen disposition codes is the right vocabulary for a report and the wrong one for
 * a dashboard: a promise is a promise whether it lands inside three days or after them,
 * and a refusal is a refusal whether the customer said no or simply would not commit.
 * The codes stay intact underneath - the report still carries every one - but the tiles
 * group them into the six piles someone can act on, and everything outside those piles
 * (codes belonging to other use cases) is left off the dashboard rather than padding it.
 */
export type OutcomeGroup = {
  key: string;
  label: string;
  /** Disposition codes this tile stands for. */
  codes: string[];
  hint: string;
  /** Tailwind classes, written out so the compiler sees them. */
  tile: string;
  value: string;
};

export const OUTCOME_GROUPS: OutcomeGroup[] = [
  {
    key: "promise",
    label: "Promise to pay",
    codes: ["PTP", "FPTP"],
    hint: "Gave a date",
    tile: "border-emerald-200 bg-emerald-50 hover:border-emerald-300",
    value: "text-emerald-700",
  },
  {
    key: "refused",
    label: "Refused to pay",
    codes: ["RTP", "NC"],
    hint: "No, or no commitment",
    tile: "border-rose-200 bg-rose-50 hover:border-rose-300",
    value: "text-rose-700",
  },
  {
    key: "paid",
    label: "Claims paid",
    codes: ["CP", "ALREADY_PAID", "PARTIAL_PAID"],
    hint: "Says it is done",
    tile: "border-blue-200 bg-blue-50 hover:border-blue-300",
    value: "text-blue-700",
  },
  {
    key: "callback",
    label: "Callback asked",
    codes: ["CB"],
    hint: "Call me later",
    tile: "border-amber-200 bg-amber-50 hover:border-amber-300",
    value: "text-amber-700",
  },
  {
    key: "unreached",
    label: "Not reachable",
    codes: ["NR", "ICR", "RNR", "LM"],
    hint: "Worth another try",
    tile: "border-slate-200 bg-slate-50 hover:border-slate-300",
    value: "text-slate-700",
  },
  {
    key: "wrong",
    label: "Wrong number",
    codes: ["WN"],
    hint: "Not this customer",
    tile: "border-slate-200 bg-slate-50 hover:border-slate-300",
    value: "text-slate-500",
  },
];

export function groupByKey(key: string | null): OutcomeGroup | undefined {
  return OUTCOME_GROUPS.find((g) => g.key === key);
}

/** Count how many of `counts` fall into each group. */
export function countsForGroups(counts: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const group of OUTCOME_GROUPS) {
    out[group.key] = group.codes.reduce((n, code) => n + (counts[code] ?? 0), 0);
  }
  return out;
}
