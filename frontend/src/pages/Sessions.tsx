import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DispositionBadge, maskPhone } from "../components/Disposition";
import { IconEye } from "../components/Icons";
import { getDispositions, listSessions } from "../api/endpoints";

export function Sessions() {
  const { data: sessions, isLoading, error } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
  });
  const [statusFilter, setStatusFilter] = useState("all");
  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const labels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value, d.label])),
    [dispositions],
  );
  const [directionFilter, setDirectionFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    return (sessions ?? []).filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (directionFilter !== "all" && s.direction !== directionFilter) return false;
      if (search && !(s.phone_number ?? "").includes(search) && !s.session_id.includes(search)) {
        return false;
      }
      return true;
    });
  }, [sessions, statusFilter, directionFilter, search]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"><h1 className="text-lg font-semibold tracking-tight text-slate-900">Conversations</h1></div>

      <div className="flex flex-wrap gap-3">
        <input
          placeholder="Search phone or session id"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="ended">Ended</option>
        </select>
        <select
          value={directionFilter}
          onChange={(e) => setDirectionFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="all">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading sessions...</p>}
      {error && <p className="text-sm text-red-600">Failed to load sessions.</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
            <tr>
              <th className="px-4 py-2">Session</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">Direction</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Outcome</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2 text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.session_id} className="border-t border-slate-100 transition hover:bg-slate-50/50">
                <td className="px-4 py-2">
                  <Link
                    to={`/sessions/${s.session_id}`}
                    className="font-mono text-xs text-slate-500 hover:text-indigo-600"
                    title={s.session_id}
                  >
                    {s.session_id.slice(-8)}
                  </Link>
                </td>
                <td className="px-4 py-2 font-mono text-slate-600">{maskPhone(s.phone_number)}</td>
                <td className="px-4 py-2 text-slate-600">{s.direction}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {s.status}
                  </span>
                </td>
                <td className="px-4 py-2">
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
                <td className="px-4 py-2 text-slate-500">
                  {s.created_at ? new Date(s.created_at).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link
                    to={`/sessions/${s.session_id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-700"
                  >
                    <IconEye size={13} />
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No sessions found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
