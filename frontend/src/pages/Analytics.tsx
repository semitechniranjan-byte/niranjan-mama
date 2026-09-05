import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAnalyticsSummary,
  getDispositions,
  listAnalyzeJobs,
  startAnalyzeJob,
} from "../api/endpoints";
import { dispositionTone } from "../components/Disposition";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All", days: null as number | null },
];

export function Analytics() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [rangeIdx, setRangeIdx] = useState(1);
  const [executionId, setExecutionId] = useState(searchParams.get("execution_id") ?? "");
  const [parallelCount, setParallelCount] = useState(10);
  const [showJobs, setShowJobs] = useState(false);

  const dateFrom = RANGES[rangeIdx].days == null ? undefined : isoDaysAgo(RANGES[rangeIdx].days!);

  const { data: summary, isLoading } = useQuery({
    queryKey: ["analyticsSummary", dateFrom ?? "all"],
    queryFn: () => getAnalyticsSummary({ date_from: dateFrom }),
    refetchInterval: 30_000,
  });
  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const labels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value, d.label])),
    [dispositions],
  );

  const { data: jobs } = useQuery({
    queryKey: ["analyze-jobs"],
    queryFn: listAnalyzeJobs,
    refetchInterval: showJobs ? 5_000 : false,
  });

  const startMutation = useMutation({
    mutationFn: () => startAnalyzeJob(executionId, parallelCount),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["analyze-jobs"] }),
  });

  const days = summary?.by_day ?? [];
  const busiest = Math.max(1, ...days.map((d) => d.calls));
  const total = summary?.total ?? 0;
  const languages = summary?.by_language ?? [];
  const languageTotal = languages.reduce((s, l) => s + l.count, 0) || 1;

  return (
    <div className="space-y-5 pb-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Analytics</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              What the agent achieved, counted from every scored call.
            </p>
          </div>
          <div className="flex rounded-lg border border-slate-200 p-0.5">
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => setRangeIdx(i)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                  i === rangeIdx
                    ? "bg-indigo-600 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Calls" value={total.toLocaleString("en-IN")} />
        <Stat
          label="Scored"
          value={(summary?.scored ?? 0).toLocaleString("en-IN")}
          hint={total ? `${Math.round(((summary?.scored ?? 0) / total) * 100)}% of calls` : undefined}
        />
        <Stat
          label="Promises to pay"
          value={(summary?.promises ?? 0).toLocaleString("en-IN")}
          tone="text-emerald-700"
          hint="PTP and FPTP together"
        />
        <Stat
          label="Promise rate"
          value={`${summary?.promise_rate ?? 0}%`}
          tone="text-emerald-700"
          hint="of every scored call"
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Calls per day</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          The darker part of each bar is the promises that came out of that day.
        </p>
        {days.length === 0 && !isLoading ? (
          <p className="mt-4 text-xs text-slate-400">No calls in this period.</p>
        ) : (
          <div className="mt-5 flex h-40 items-end gap-1.5 overflow-x-auto">
            {days.map((d) => {
              const height = (d.calls / busiest) * 100;
              const promiseShare = d.calls ? (d.promises / d.calls) * 100 : 0;
              return (
                <div key={d.date} className="flex min-w-[26px] flex-1 flex-col items-center gap-1">
                  <span className="text-[9px] text-slate-400">{d.calls}</span>
                  <div
                    className="relative flex w-full flex-col justify-end overflow-hidden rounded-t bg-indigo-200"
                    style={{ height: `${Math.max(height, 4)}%` }}
                    title={`${d.date}: ${d.calls} calls, ${d.promises} promises`}
                  >
                    <div
                      className="w-full bg-indigo-600"
                      style={{ height: `${promiseShare}%` }}
                    />
                  </div>
                  <span className="text-[9px] text-slate-400">{d.date.slice(5)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Outcomes</h2>
          <div className="mt-4 space-y-2">
            {(summary?.by_disposition ?? []).map((d) => {
              const tone = dispositionTone(d.code);
              const pct = total ? (d.count / total) * 100 : 0;
              return (
                <div key={d.code} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 font-mono text-[11px] font-semibold text-slate-700">
                    {d.code}
                  </span>
                  <span className="hidden w-36 shrink-0 truncate text-xs text-slate-500 sm:block">
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
              <p className="text-xs text-slate-400">Nothing scored in this period.</p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Languages</h2>
          <div className="mt-4 space-y-3">
            {languages.map((l) => {
              const pct = (l.count / languageTotal) * 100;
              return (
                <div key={l.language}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="font-medium capitalize text-slate-700">{l.language}</span>
                    <span className="text-slate-500">
                      {l.count} <span className="text-slate-400">{pct.toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {languages.length === 0 && !isLoading && (
              <p className="text-xs text-slate-400">No calls yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Re-running the scorer over a past execution is a maintenance job, not something
          anyone opens this page for, so it stays folded away. */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <button
          onClick={() => setShowJobs((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-3 text-left"
        >
          <span className="text-sm font-semibold text-slate-900">Re-score a past execution</span>
          <span className="text-xs text-slate-400">{showJobs ? "Hide" : "Show"}</span>
        </button>

        {showJobs && (
          <div className="border-t border-slate-100 p-5">
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (executionId.trim()) startMutation.mutate();
              }}
              className="flex flex-wrap items-end gap-3"
            >
              <label className="text-xs font-medium text-slate-600">
                Execution ID
                <input
                  value={executionId}
                  onChange={(e) => setExecutionId(e.target.value)}
                  className="mt-1 block h-9 rounded-lg border border-slate-300 px-2.5 text-sm"
                />
              </label>
              <label className="text-xs font-medium text-slate-600">
                Parallel count
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={parallelCount}
                  onChange={(e) => setParallelCount(Number(e.target.value))}
                  className="mt-1 block h-9 w-28 rounded-lg border border-slate-300 px-2.5 text-sm"
                />
              </label>
              <button
                type="submit"
                disabled={startMutation.isPending || !executionId.trim()}
                className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
              >
                Start
              </button>
            </form>

            <table className="mt-5 w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1 font-semibold">Job</th>
                  <th className="py-1 font-semibold">Execution</th>
                  <th className="py-1 font-semibold">Status</th>
                  <th className="py-1 font-semibold">Progress</th>
                </tr>
              </thead>
              <tbody>
                {(jobs ?? []).map((job) => (
                  <tr key={job.job_id} className="border-t border-slate-100">
                    <td className="py-2 font-mono text-xs">{job.job_id.slice(-8)}</td>
                    <td className="py-2 text-xs">{job.execution_id}</td>
                    <td className="py-2">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                        {job.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full bg-indigo-600"
                            style={{ width: `${job.percentage}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">
                          {job.processed}/{job.total}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
                {(jobs ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-xs text-slate-400">
                      No analysis jobs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone || "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}
