import { useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { IconPhone, IconPulse, IconCheck, IconClock, IconHourglass, IconX, IconMessage, IconChart } from "../components/Icons";
import { DispositionCard } from "../components/Disposition";
import { useQuery } from "@tanstack/react-query";
import { getCampaign, getDispositions, getSession, getSessionMessages, getTemplate } from "../api/endpoints";
import type { DatasheetRow } from "../api/types";

const STATUS_DOT: Record<string, string> = {
  draft: "bg-slate-400",
  running: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const TOP_TABS = ["Info", "Call Stats", "Financial", "Calls List"] as const;
type TopTab = (typeof TOP_TABS)[number];

const STAT_SUB_TABS = ["Call Distribution", "Disposition Codes"] as const;
type StatSubTab = (typeof STAT_SUB_TABS)[number];

function DispositionBadge({ code, color }: { code: string; color?: string }) {
  if (color) {
    return <span className={`rounded-full px-2 py-0.5 text-xs font-medium text-white ${color}`}>{code}</span>;
  }
  return <span className="text-xs text-slate-600">{code}</span>;
}

function findAmount(modelData?: Record<string, unknown>): number {
  if (!modelData) return 0;
  for (const [k, v] of Object.entries(modelData)) {
    if (/amount/i.test(k)) {
      const n = Number(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => getCampaign(id!),
    refetchInterval: 4_000,
  });
  const campaign = data?.campaign;
  const rows = useMemo(() => data?.rows ?? [], [data]);

  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const { data: template } = useQuery({
    queryKey: ["template", campaign?.prompt_template_id],
    queryFn: () => getTemplate(campaign!.prompt_template_id),
    enabled: !!campaign?.prompt_template_id,
  });

  const phoneColumn = template?.phone_column;
  const dispositionColor = (value?: string | null) =>
    dispositions?.find((d) => d.value.trim() === (value ?? "").trim())?.color;
  const dispositionLabel = (value?: string | null) =>
    dispositions?.find((d) => d.value.trim() === (value ?? "").trim())?.label ?? value;

  const [topTab, setTopTab] = useState<TopTab>("Info");
  const [statSubTab, setStatSubTab] = useState<StatSubTab>("Call Distribution");

  const stats = campaign?.stats;
  const answered = stats?.completed ?? 0;
  const notAnswered = stats?.no_answer ?? 0;
  const failed = stats?.failed ?? 0;
  const ongoing = stats?.calling ?? 0;
  const total = stats?.total ?? 0;
  const answerRate = total > 0 ? Math.round((answered / total) * 100) : 0;

  const dispositionCounts = useMemo(() => {
    const map = new Map<string, { count: number; amount: number }>();
    for (const row of rows) {
      const code = row.disposition_code?.trim();
      if (!code) continue;
      const entry = map.get(code) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += findAmount(row.model_data);
      map.set(code, entry);
    }
    return Array.from(map.entries()).map(([code, v]) => ({ code, ...v }));
  }, [rows]);

  const totalAmount = dispositionCounts.reduce((sum, d) => sum + d.amount, 0);

  const [callsFilter, setCallsFilter] = useState<"all" | "answered" | "not_answered">("all");
  const [search, setSearch] = useState("");
  const [selectedRow, setSelectedRow] = useState<DatasheetRow | null>(null);

  const phoneOf = (row: DatasheetRow) => (phoneColumn ? String(row.data?.[phoneColumn] ?? "") : "");

  const filteredRows = rows.filter((row) => {
    if (callsFilter === "answered" && row.status !== "completed") return false;
    if (callsFilter === "not_answered" && row.status === "completed") return false;
    if (search.trim() && !phoneOf(row).includes(search.trim())) return false;
    return true;
  });

  const { data: selectedSession } = useQuery({
    queryKey: ["session", selectedRow?.session_id],
    queryFn: () => getSession(selectedRow!.session_id!),
    enabled: !!selectedRow?.session_id,
  });
  const { data: selectedMessages } = useQuery({
    queryKey: ["session-messages", selectedRow?.session_id],
    queryFn: () => getSessionMessages(selectedRow!.session_id!),
    enabled: !!selectedRow?.session_id,
  });

  const exportCsv = () => {
    if (filteredRows.length === 0) return;
    const cols = Array.from(new Set(filteredRows.flatMap((r) => Object.keys(r.data ?? {}))));
    const header = [...cols, "STATUS", "DISPOSITION"];
    const lines = [header.join(",")];
    for (const row of filteredRows) {
      const vals = cols.map((c) => JSON.stringify(String(row.data?.[c] ?? "")));
      vals.push(JSON.stringify(row.status));
      vals.push(JSON.stringify(row.disposition_code ?? ""));
      lines.push(vals.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaign?.name ?? "campaign"}-calls.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div>
        <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:underline">
          Back
        </button>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{campaign?.name}</h1>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-3 pt-2">
          {TOP_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setTopTab(tab)}
              className={`whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium ${
                topTab === tab
                  ? "border-b-2 border-indigo-600 text-indigo-700"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="p-4">
          {topTab === "Info" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-400">Campaign Status</div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                    <span className={`h-2 w-2 rounded-full ${STATUS_DOT[campaign?.status ?? ""] ?? "bg-slate-400"}`} />
                    {(campaign?.status ?? "").toUpperCase()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Calls</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">{total}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Mode</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {campaign?.mode === "production" ? "Production" : "Test"}
                  </div>
                </div>
              </div>

              {/* What was chosen before dialling: which script, which language, how fast. */}
              <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-400">Use case</div>
                  <div className="mt-1">
                    {campaign?.use_case ? (
                      <span className="inline-block rounded-full bg-slate-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
                        {template?.use_cases?.[campaign.use_case]?.label || campaign.use_case}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Not recorded</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Language</div>
                  <div className="mt-1">
                    <span className="inline-block rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                      {!campaign?.language || campaign.language === "auto"
                        ? `Auto${template?.language_column ? ` · ${template.language_column}` : ""}`
                        : campaign.language}
                    </span>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Simultaneous calls</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {campaign?.concurrency ? `${campaign.concurrency} at a time` : "—"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-400">Max Attempts</div>
                  <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    N/A
                  </span>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Time Gap (hours)</div>
                  <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    N/A
                  </span>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Work Hours</div>
                  <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    N/A
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Retry scheduling (max attempts / time gap / work hours) and DND/Email/SMS channel
                settings aren't implemented in this build — each row is called once, voice-only.
              </p>
              {campaign?.execution_id && (
                <div className="border-t border-slate-100 pt-4">
                  <div className="text-xs text-slate-400">Execution ID</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                      {campaign.execution_id}
                    </span>
                    <Link
                      to={`/analytics?execution_id=${campaign.execution_id}`}
                      className="text-xs font-medium text-slate-700 hover:underline"
                    >
                      Analyze in Analytics 
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}

          {topTab === "Call Stats" && (
            <div>
              <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-100">
                {STAT_SUB_TABS.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setStatSubTab(tab)}
                    className={`whitespace-nowrap px-3 py-2 text-sm font-medium ${
                      statSubTab === tab
                        ? "border-b-2 border-indigo-600 text-indigo-700"
                        : "text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {statSubTab === "Call Distribution" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {[
                    { label: "Total Calls", value: total, Icon: IconPhone, tone: "bg-slate-100 text-slate-600" },
                    { label: "Ongoing Calls", value: ongoing, Icon: IconPulse, tone: "bg-amber-50 text-amber-600" },
                    { label: "Answered", value: answered, Icon: IconCheck, tone: "bg-emerald-50 text-emerald-600" },
                    { label: "Not Answered", value: notAnswered, Icon: IconClock, tone: "bg-slate-100 text-slate-500" },
                    { label: "Busy", value: 0, Icon: IconHourglass, tone: "bg-orange-50 text-orange-600" },
                    { label: "Failed", value: failed, Icon: IconX, tone: "bg-rose-50 text-rose-600" },
                    { label: "Voicemail", value: 0, Icon: IconMessage, tone: "bg-violet-50 text-violet-600" },
                    { label: "Answer Rate", value: `${answerRate}%`, Icon: IconChart, tone: "bg-indigo-50 text-indigo-600" },
                  ].map((card) => (
                    <div key={card.label} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${card.tone}`}>
                        <card.Icon size={17} />
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs text-slate-400">{card.label}</div>
                        <div className="text-lg font-semibold text-slate-900">{card.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {statSubTab === "Disposition Codes" && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {dispositionCounts.map((d) => (
                    <DispositionCard
                      key={d.code}
                      code={d.code}
                      label={dispositionLabel(d.code) || d.code}
                      count={d.count}
                      amount={d.amount}
                    />
                  ))}
                  {dispositionCounts.length === 0 && (
                    <p className="text-sm text-slate-400">No dispositions recorded yet.</p>
                  )}
                </div>
              )}

              <p className="mt-4 text-xs text-slate-400">
                Conversation Stages, Cooperation Levels, Information Status, Language Distribution,
                and Interruption Patterns aren't tracked yet — they'd need dedicated fields added to
                the post-call analysis prompt.
              </p>
            </div>
          )}

          {topTab === "Financial" && (
            <div>
              <div className="rounded-lg border border-slate-200 p-4">
                <div className="text-xs text-slate-400">Total amount (from model_data "*amount*" fields)</div>
                <div className="text-2xl font-semibold text-slate-900">₹{totalAmount}</div>
              </div>
              <p className="mt-3 text-xs text-slate-400">
                No standardized amount field exists in the current analysis prompts, so this sums
                any field whose name contains "amount" across all rows. Add a consistent field
                (e.g. "promised_amount") to the Analysis Prompts tab for accurate totals.
              </p>
            </div>
          )}

          {topTab === "Calls List" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setCallsFilter("all")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    callsFilter === "all" ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600"
                  }`}
                >
                  All {total}
                </button>
                <button
                  onClick={() => setCallsFilter("answered")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    callsFilter === "answered" ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600"
                  }`}
                >
                  Answered {answered}
                </button>
                <button
                  onClick={() => setCallsFilter("not_answered")}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                    callsFilter === "not_answered" ? "bg-indigo-600 text-white" : "border border-slate-200 text-slate-600"
                  }`}
                >
                  Not Answered {notAnswered + failed}
                </button>
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={exportCsv}
                    className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                  >
                    Export
                  </button>
                  <button
                    onClick={() => refetch()}
                    className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                  >
                    {isFetching ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by phone number"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-2 lg:col-span-1">
                  <h3 className="text-xs font-semibold uppercase text-slate-400">Call Records</h3>
                  <div className="max-h-[28rem] space-y-2 overflow-y-auto">
                    {filteredRows.map((row) => (
                      <button
                        key={row.row_index}
                        onClick={() => setSelectedRow(row)}
                        className={`block w-full rounded-lg border p-3 text-left text-sm ${
                          selectedRow?.row_index === row.row_index
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className="font-medium text-slate-800">{phoneOf(row) || `Row ${row.row_index + 1}`}</div>
                        {row.disposition_code && (
                          <div className="mt-1">
                            <DispositionBadge code={row.disposition_code} color={dispositionColor(row.disposition_code)} />
                          </div>
                        )}
                      </button>
                    ))}
                    {filteredRows.length === 0 && (
                      <p className="text-xs text-slate-400">No calls match this filter.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-4 lg:col-span-2">
                  <h3 className="mb-2 text-sm font-semibold text-slate-900">Call Details</h3>
                  {!selectedRow && (
                    <p className="text-sm text-slate-400">Select a call record to view its transcript.</p>
                  )}
                  {selectedRow && !selectedRow.session_id && (
                    <p className="text-sm text-slate-400">No call was placed for this row.</p>
                  )}
                  {selectedRow?.session_id && (
                    <div className="space-y-3">
                      {selectedSession?.recording_url && (
                        <audio controls src={selectedSession.recording_url} className="w-full" />
                      )}
                      <div className="max-h-96 space-y-2 overflow-y-auto">
                        {(selectedMessages ?? []).map((m, idx) => (
                          <div
                            key={m._id ?? idx}
                            className={`rounded-md px-3 py-2 text-sm ${
                              m.role === "user" ? "bg-slate-100 text-slate-800" : "bg-indigo-600 text-white ml-8"
                            }`}
                          >
                            <div className="text-xs opacity-60">{m.role}</div>
                            {m.content}
                          </div>
                        ))}
                        {(selectedMessages ?? []).length === 0 && (
                          <p className="text-sm text-slate-400">No transcript recorded for this call.</p>
                        )}
                      </div>
                      <Link
                        to={`/sessions/${selectedRow.session_id}`}
                        className="text-xs font-medium text-slate-700 hover:underline"
                      >
                        Open full session
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
