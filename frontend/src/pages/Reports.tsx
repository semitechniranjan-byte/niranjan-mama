import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  downloadCallsCsv,
  getAnalyticsSummary,
  getDispositions,
  type ReportFilters,
} from "../api/endpoints";
import { dispositionTone } from "../components/Disposition";
import { IconCloudUpload, IconSearch } from "../components/Icons";

/** YYYY-MM-DD for an offset from today, which is the form the date filters take. */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const RANGES = [
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "All time", days: null as number | null },
];

const COLUMNS = [
  "Date", "Time", "Phone", "Direction", "Status", "Outcome", "Promise date",
  "Promise time", "Promise amount", "Cooperation", "Interruptions", "Turns",
  "Duration (s)", "Language", "Use case", "Ended by", "Customer said", "Session id",
];

export function Reports() {
  const [rangeIdx, setRangeIdx] = useState(1);
  const [disposition, setDisposition] = useState("all");
  const [direction, setDirection] = useState("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const range = RANGES[rangeIdx];
  const dateFrom = range.days == null ? undefined : isoDaysAgo(range.days);

  const filters: ReportFilters = {
    date_from: dateFrom,
    disposition: disposition === "all" ? undefined : disposition,
    direction: direction === "all" ? undefined : direction,
    search: search.trim() || undefined,
  };

  const { data: summary, isLoading } = useQuery({
    queryKey: ["analyticsSummary", dateFrom ?? "all"],
    queryFn: () => getAnalyticsSummary({ date_from: dateFrom }),
  });
  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const labels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value, d.label])),
    [dispositions],
  );

  const inPeriod = summary?.total ?? 0;

  const onDownload = async () => {
    setBusy(true);
    setNote(null);
    try {
      const bytes = await downloadCallsCsv(filters);
      setNote(`Downloaded ${(bytes / 1024).toFixed(0)} KB`);
    } catch (err) {
      setNote(`Could not build the report: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Reports</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Every call in the period as a spreadsheet — outcome, promise date, what the customer
          said, and how long it took.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-slate-600">
            Period
            <select
              value={rangeIdx}
              onChange={(e) => setRangeIdx(Number(e.target.value))}
              className="mt-1 block h-9 rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none"
            >
              {RANGES.map((r, i) => (
                <option key={r.label} value={i}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-600">
            Outcome
            <select
              value={disposition}
              onChange={(e) => setDisposition(e.target.value)}
              className="mt-1 block h-9 rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">All outcomes</option>
              {(summary?.by_disposition ?? []).map((d) => (
                <option key={d.code} value={d.code}>
                  {d.code} — {labels[d.code] || d.code} ({d.count})
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-slate-600">
            Direction
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="mt-1 block h-9 rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none"
            >
              <option value="all">Both</option>
              <option value="outbound">Outbound</option>
              <option value="inbound">Inbound</option>
            </select>
          </label>

          <label className="min-w-0 flex-1 text-xs font-medium text-slate-600 sm:max-w-xs">
            Number
            <span className="relative mt-1 block">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <IconSearch size={14} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Any part of a number"
                className="h-9 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </span>
          </label>

          <button
            onClick={onDownload}
            disabled={busy || inPeriod === 0}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
          >
            <IconCloudUpload size={15} />
            {busy ? "Building…" : "Download CSV"}
          </button>
        </div>

        {note && <p className="mt-3 text-xs text-slate-500">{note}</p>}
        {inPeriod === 0 && !isLoading && (
          <p className="mt-3 text-xs text-slate-400">No calls in this period yet.</p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Calls in period" value={inPeriod.toLocaleString("en-IN")} />
        <Stat label="Scored" value={(summary?.scored ?? 0).toLocaleString("en-IN")} />
        <Stat
          label="Promises to pay"
          value={(summary?.promises ?? 0).toLocaleString("en-IN")}
          tone="text-emerald-700"
        />
        <Stat label="Promise rate" value={`${summary?.promise_rate ?? 0}%`} tone="text-emerald-700" />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Outcomes in this period</h2>
        <div className="mt-4 space-y-2">
          {(summary?.by_disposition ?? []).map((d) => {
            const tone = dispositionTone(d.code);
            const pct = inPeriod ? (d.count / inPeriod) * 100 : 0;
            return (
              <div key={d.code} className="flex items-center gap-3">
                <span className="w-12 shrink-0 font-mono text-[11px] font-semibold text-slate-700">
                  {d.code}
                </span>
                <span className="hidden w-40 shrink-0 truncate text-xs text-slate-500 sm:block">
                  {labels[d.code] || d.code}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${tone.value.replace("text-", "bg-")}`}
                    style={{ width: `${Math.max(pct, 1.5)}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-slate-600">
                  {d.count}
                  <span className="ml-1 text-slate-400">{pct.toFixed(0)}%</span>
                </span>
              </div>
            );
          })}
          {!isLoading && (summary?.by_disposition ?? []).length === 0 && (
            <p className="text-xs text-slate-400">Nothing scored in this period yet.</p>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Columns in the file</h2>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {COLUMNS.map((c) => (
            <span
              key={c}
              className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600"
            >
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone || "text-slate-900"}`}>{value}</div>
    </div>
  );
}
