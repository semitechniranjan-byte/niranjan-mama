import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCampaign,
  launchCampaign,
  listCampaigns,
  listAgents,
  listDatasheets,
  listTemplates,
} from "../api/endpoints";
import type { Campaign, Template } from "../api/types";
import { IconX, IconEye } from "../components/Icons";

const STATUS_DOT: Record<string, string> = {
  draft: "bg-slate-400",
  running: "bg-amber-500",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  running: "Calling",
  completed: "Completed",
  failed: "Failed",
};

function formatIST(dateStr?: string): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  const datePart = d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" });
  const timePart = d
    .toLocaleTimeString("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${datePart} - ${timePart} IST`;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

function useCaseKeysOf(template?: Template | null): string[] {
  return Object.keys(template?.use_cases ?? {});
}

/** Languages configured for a use case, and whether each actually has a prompt. */
function languagesOf(template: Template | null | undefined, useCase: string) {
  const languages = template?.use_cases?.[useCase]?.languages ?? {};
  return Object.entries(languages).map(([key, cfg]) => ({
    key,
    ready: (cfg?.prompt ?? "").trim().length > 0,
  }));
}

export function Campaigns() {
  const queryClient = useQueryClient();
  const { data: campaigns } = useQuery({
    queryKey: ["campaigns"],
    queryFn: listCampaigns,
    refetchInterval: 5_000,
  });
  const { data: datasheets } = useQuery({ queryKey: ["datasheets"], queryFn: listDatasheets });
  const { data: templates } = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const { data: agentData } = useQuery({ queryKey: ["agents"], queryFn: listAgents });
  const agents = agentData?.agents ?? [];

  const template = templates?.[0] ?? null;
  const promptTemplateId = template?._id ?? "";
  const useCaseKeys = useCaseKeysOf(template);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  // A generated name should not overwrite one the operator has typed.
  const nameEdited = useRef(false);
  const [mode, setMode] = useState("test");
  const [datasheetId, setDatasheetId] = useState("");
  const [useCase, setUseCase] = useState("");
  const [language, setLanguage] = useState("auto");
  // Several agents can work one campaign, so a big datasheet uses all capacity.
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const effectiveAgents = selectedAgentIds.length
    ? agents.filter((a) => selectedAgentIds.includes(a._id))
    : agents;
  const totalCapacity = effectiveAgents.reduce((s, a) => s + (a.max_concurrent_calls ?? 0), 0);
  const avgCallSeconds =
    effectiveAgents.length > 0
      ? effectiveAgents.reduce((s, a) => s + (a.max_call_seconds ?? 180), 0) / effectiveAgents.length
      : 180;

  const toggleAgent = (id: string) =>
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const effectiveUseCase = useCase || template?.default_use_case || useCaseKeys[0] || "";
  const languages = languagesOf(template, effectiveUseCase);
  const selectedLanguageReady =
    language === "auto" || languages.find((l) => l.key === language)?.ready !== false;

  // Arriving from a datasheet: open the form with that sheet already chosen, so uploading
  // a file and calling it are one movement rather than two screens and six choices.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const wanted = searchParams.get("datasheet");
    if (!wanted) return;
    setDatasheetId(wanted);
    setIsModalOpen(true);
    nameEdited.current = false;
    searchParams.delete("datasheet");
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Name it after the sheet being called and the day, which is what these get called
  // anyway, and leave it editable.
  useEffect(() => {
    if (!isModalOpen || !datasheetId || nameEdited.current) return;
    const sheet = datasheets?.find((d) => d._id === datasheetId);
    if (!sheet) return;
    const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" });
    setName(`${sheet.name} - ${today}`);
  }, [isModalOpen, datasheetId, datasheets]);

  const resetForm = () => {
    nameEdited.current = false;
    setName("");
    setDatasheetId("");
    setUseCase("");
    setLanguage("auto");
    setSelectedAgentIds([]);
  };

  const createAndLaunchMutation = useMutation({
    mutationFn: async () => {
      const created = await createCampaign({
        name,
        mode,
        datasheet_id: datasheetId,
        prompt_template_id: promptTemplateId,
        use_case: effectiveUseCase,
        language,
        agent_ids: effectiveAgents.map((a) => a._id),
      });
      await launchCampaign(created.campaign_id);
      return created;
    },
    onSuccess: () => {
      resetForm();
      setIsModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    },
  });

  const launchMutation = useMutation({
    mutationFn: (id: string) => launchCampaign(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !datasheetId || !promptTemplateId) return;
    createAndLaunchMutation.mutate();
  };

  const datasheetName = (id: string) => datasheets?.find((d) => d._id === id)?.name || id;
  const datasheetRowCount = (id: string) => datasheets?.find((d) => d._id === id)?.row_count ?? 0;

  const groups = useMemo(() => {
    const map = new Map<string, Campaign[]>();
    for (const c of campaigns ?? []) {
      const list = map.get(c.datasheet_id) ?? [];
      list.push(c);
      map.set(c.datasheet_id, list);
    }
    return Array.from(map.entries())
      .map(([datasheetId, runs]) => {
        const oldestFirst = [...runs].sort(
          (a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime(),
        );
        const numbered = oldestFirst.map((c, idx) => ({ campaign: c, runNumber: idx + 1 }));
        const newestFirst = [...numbered].reverse();
        return {
          datasheetId,
          runs: newestFirst,
          completedCount: runs.filter((c) => c.status === "completed").length,
          latestCreatedAt: oldestFirst[oldestFirst.length - 1]?.created_at,
        };
      })
      .sort((a, b) => new Date(b.latestCreatedAt ?? 0).getTime() - new Date(a.latestCreatedAt ?? 0).getTime());
  }, [campaigns]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (datasheetId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(datasheetId)) next.delete(datasheetId);
      else next.add(datasheetId);
      return next;
    });
  };

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const totalPages = Math.max(1, Math.ceil(groups.length / pageSize));
  const pageStart = (page - 1) * pageSize;
  const pagedGroups = groups.slice(pageStart, pageStart + pageSize);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm"><h1 className="text-lg font-semibold tracking-tight text-slate-900">Campaigns</h1></div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create Campaign
        </button>
      </div>

      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Launch a new campaign</h2>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-700"
              >
            <IconX size={16} />
          </button>
            </div>

            <label className="block text-xs font-medium text-slate-600">
              Campaign name
              <input
                value={name}
                onChange={(e) => {
                  nameEdited.current = true;
                  setName(e.target.value);
                }}
                placeholder="July follow-up calls"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-600">
                Mode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="test">Test (first row only)</option>
                  <option value="production">Production (full datasheet)</option>
                </select>
              </label>

              <label className="block text-xs font-medium text-slate-600">
                Datasheet
                <select
                  value={datasheetId}
                  onChange={(e) => setDatasheetId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select a datasheet...</option>
                  {(datasheets ?? []).map((ds) => (
                    <option key={ds._id} value={ds._id}>
                      {ds.name} ({ds.row_count} rows)
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-slate-600">
                Prompt template
                <div className="mt-1 flex w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {template?.name ?? "No template configured yet"}
                </div>
              </label>

              <label className="block text-xs font-medium text-slate-600">
                Use case
                <select
                  value={effectiveUseCase}
                  onChange={(e) => {
                    setUseCase(e.target.value);
                    setLanguage("auto");
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {useCaseKeys.length === 0 && <option value="">No use cases configured</option>}
                  {useCaseKeys.map((k) => (
                    <option key={k} value={k}>
                      {template?.use_cases?.[k]?.label || k}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-slate-600">
                Language
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="auto">Auto — use each row's language column</option>
                  {languages.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.key}
                      {l.ready ? "" : "  (no prompt yet)"}
                    </option>
                  ))}
                </select>
              </label>

            </div>

            {mode === "production" && agents.length > 0 && (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600">
                    Agents ({effectiveAgents.length} of {agents.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedAgentIds(
                        selectedAgentIds.length === agents.length ? [] : agents.map((a) => a._id),
                      )
                    }
                    className="text-xs font-medium text-slate-500 hover:underline"
                  >
                    {selectedAgentIds.length === agents.length ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {agents.map((a) => {
                    const on = effectiveAgents.some((x) => x._id === a._id);
                    return (
                      <button
                        key={a._id}
                        type="button"
                        onClick={() => toggleAgent(a._id)}
                        className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                          on
                            ? "border-slate-900 bg-indigo-600 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        }`}
                      >
                        {a.name}
                        <span className={on ? "text-white/60" : "text-slate-400"}> ×{a.max_concurrent_calls}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  Rows are split across the selected agents in proportion to their capacity.
                </p>
              </div>
            )}

            {mode === "production" && datasheetId && (
              <div className="rounded-md bg-slate-50 px-3 py-2.5 text-xs">
                {(() => {
                  const rows = datasheetRowCount(datasheetId);
                  const cap = totalCapacity || 100;
                  const perHour = (3600 / avgCallSeconds) * cap;
                  const hours = perHour > 0 ? rows / perHour : 0;
                  const eta = hours < 1 ? `${Math.ceil(hours * 60)} min` : `${hours.toFixed(1)} hours`;
                  return (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600">
                      <span>
                        <strong className="text-slate-900">{rows.toLocaleString()}</strong> rows
                      </span>
                      <span>
                        <strong className="text-slate-900">{cap}</strong> calls at a time
                      </span>
                      <span>
                        ≈ <strong className="text-slate-900">{Math.round(perHour).toLocaleString()}</strong>/hr
                      </span>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
                        ~{eta}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}

            {mode === "production" && effectiveAgents.length === 0 && agents.length > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                No agents selected — the campaign will use all {agents.length} agents.
              </p>
            )}

            {!selectedLanguageReady && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                "{language}" has no prompt configured in Templates yet — calls would run with an
                empty prompt. Add one first, or pick another language.
              </p>
            )}
            <p className="text-xs text-slate-400">
              Pick a language to run the whole campaign in it. <strong>Auto</strong> reads each
              row's language from the datasheet column set in Templates
              {template?.language_column ? ` (${template.language_column})` : ""}.
            </p>

            <button
              type="submit"
              disabled={
                createAndLaunchMutation.isPending ||
                !name.trim() ||
                !datasheetId ||
                !promptTemplateId ||
                !effectiveUseCase
              }
              className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {createAndLaunchMutation.isPending ? "Launching..." : "Launch Campaign"}
            </button>
          </form>
        </div>
      )}

      <div className="space-y-3">
        {pagedGroups.map((group) => {
          const isOpen = expanded.has(group.datasheetId);
          return (
            <div key={group.datasheetId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <button
                onClick={() => toggleExpanded(group.datasheetId)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <div className="flex items-center gap-2">
                  <span className={`text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}></span>
                  <span className="text-sm font-semibold text-slate-900">{datasheetName(group.datasheetId)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {group.runs.length} executions
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {datasheetRowCount(group.datasheetId)} rows
                  </span>
                </div>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  completed: {group.completedCount}
                </span>
              </button>

              {isOpen && (
                <div className="overflow-x-auto border-t border-slate-100">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
                      <tr>
                        <th className="px-4 py-2">Actions</th>
                        <th className="px-4 py-2">ID</th>
                        <th className="px-4 py-2">Use case / Language</th>
                        <th className="px-4 py-2">Calls</th>
                        <th className="px-4 py-2">Created At</th>
                        <th className="px-4 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.runs.map(({ campaign: c, runNumber }) => (
                        <tr key={c._id} className="border-t border-slate-100">
                          <td className="px-4 py-2">
                            <Link
                              to={`/campaigns/${c._id}`}
                              title="View"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-slate-500 transition hover:bg-indigo-600 hover:text-white"
                            >
                              <IconEye size={15} />
                            </Link>
                          </td>
                          <td className="px-4 py-2 font-medium text-slate-700">RUN-{runNumber}</td>
                          <td className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {c.use_case && (
                                <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                                  {template?.use_cases?.[c.use_case]?.label || c.use_case}
                                </span>
                              )}
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                {!c.language || c.language === "auto" ? "Auto" : c.language}
                              </span>
                              {c.concurrency ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                  ×{c.concurrency}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-slate-600">{c.stats?.total ?? 0}</td>
                          <td className="px-4 py-2 text-slate-500">{formatIST(c.created_at)}</td>
                          <td className="px-4 py-2">
                            <span className="flex items-center gap-1.5 text-slate-700">
                              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[c.status] ?? "bg-slate-400"}`} />
                              {STATUS_LABEL[c.status] ?? c.status}
                            </span>
                          </td>
                          {c.status === "draft" && (
                            <td className="px-4 py-2 text-right">
                              <button
                                onClick={() => launchMutation.mutate(c._id)}
                                disabled={launchMutation.isPending}
                                className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                              >
                                Launch
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && (
          <p className="text-sm text-slate-400">No campaigns yet.</p>
        )}
      </div>

      {groups.length > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            Showing {groups.length === 0 ? 0 : pageStart + 1} to {Math.min(pageStart + pageSize, groups.length)} of{" "}
            {groups.length} entries
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
            >
              
            </button>
            <span className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-900">
              {page}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
            >
              
            </button>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
