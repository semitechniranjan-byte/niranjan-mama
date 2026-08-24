import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DispositionBadge, maskPhone } from "../components/Disposition";
import { IconChevronRight, IconEye, IconSearch } from "../components/Icons";
import { getDispositions, listSessionPage } from "../api/endpoints";

const PAGE_SIZE = 25;

export function Sessions() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [directionFilter, setDirectionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(0);

  // Typing would otherwise fire one request per keystroke; a short settle makes it one
  // request per pause.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Any filter change invalidates the current offset.
  useEffect(() => setPage(0), [statusFilter, directionFilter, debounced]);

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["sessionPage", page, statusFilter, directionFilter, debounced],
    queryFn: () =>
      listSessionPage({
        limit: PAGE_SIZE,
        skip: page * PAGE_SIZE,
        status: statusFilter,
        direction: directionFilter,
        search: debounced || undefined,
      }),
    // Keeps the current page on screen while the next loads, instead of flashing empty.
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const labels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value, d.label])),
    [dispositions],
  );

  const rows = data?.sessions ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-5 pb-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Conversations</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              {total.toLocaleString("en-IN")} call{total === 1 ? "" : "s"} recorded
            </p>
          </div>
          {isFetching && <span className="text-xs text-slate-400">Refreshing…</span>}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <IconSearch size={15} />
            </span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number or id"
              className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-indigo-400 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
          </select>
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-indigo-400 focus:outline-none"
          >
            <option value="all">All directions</option>
            <option value="outbound">Outbound</option>
            <option value="inbound">Inbound</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Number</th>
                <th className="px-4 py-2.5 font-semibold">Outcome</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">When</th>
                <th className="px-4 py-2.5 text-right font-semibold">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((s) => (
                <tr key={s.session_id} className="transition hover:bg-indigo-50/40">
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-slate-800">{maskPhone(s.phone_number)}</div>
                    <div className="font-mono text-[10px] text-slate-400" title={s.session_id}>
                      {s.session_id.slice(-8)}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    {s.active ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                        On call
                      </span>
                    ) : (
                      <DispositionBadge
                        code={s.disposition_code}
                        label={s.disposition_code ? labels[s.disposition_code] : undefined}
                        size="sm"
                      />
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-slate-500">{s.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-slate-500">
                    {s.created_at ? new Date(s.created_at).toLocaleString() : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to={`/sessions/${s.session_id}`}
                      className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-700"
                    >
                      <IconEye size={13} />
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">
                    {debounced || statusFilter !== "all" || directionFilter !== "all"
                      ? "No calls match these filters."
                      : "No calls yet."}
                  </td>
                </tr>
              )}
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">
                    Loading…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <span className="text-xs text-slate-500">
              {from}-{to} of {total.toLocaleString("en-IN")}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                aria-label="Previous page"
              >
                <span className="inline-block rotate-180">
                  <IconChevronRight size={13} />
                </span>
              </button>
              <span className="px-2 text-xs text-slate-500">
                {page + 1} / {pages}
              </span>
              <button
                onClick={() => setPage((p) => (p + 1 < pages ? p + 1 : p))}
                disabled={page + 1 >= pages}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
                aria-label="Next page"
              >
                <IconChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Could not load conversations: {(error as Error).message}
        </div>
      )}
    </div>
  );
}
