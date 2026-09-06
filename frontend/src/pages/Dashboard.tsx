import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dispositionTone, maskPhone } from "../components/Disposition";
import { OUTCOME_GROUPS, countsForGroups } from "../components/Outcomes";
import {
  getHealth,
  getPromisesDue,
  recallSession,
  listCampaigns,
  listQueueCalls,
  listSessions,
} from "../api/endpoints";
import {
  IconArrowRight,
  IconCampaign,
  IconChart,
  IconCpu,
  IconDatabase,
  IconHourglass,
  IconMessage,
  IconMic,
  IconSpeaker,
  IconTable,
  IconTemplate,
} from "../components/Icons";
import type { ComponentType } from "react";

/** Vendor names stay server-side; the console only shows the capability and its state. */
type Capability = {
  key: string;
  Icon: ComponentType<{ size?: number }>;
  label: string;
  description: string;
  ready: boolean | undefined;
};

function StatCard({
  label,
  value,
  sub,
  Icon,
  to,
}: {
  label: string;
  value: string | number;
  sub?: string;
  Icon: ComponentType<{ size?: number }>;
  to?: string;
}) {
  const body = (
    <div className="group h-full rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow">
      <div className="flex items-start justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon size={17} />
        </span>
        {to && (
          <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
            <IconArrowRight size={16} />
          </span>
        )}
      </div>
      <div className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{value}</div>
      <div className="mt-1 text-sm font-medium text-slate-700">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

function CapabilityRow({ capability }: { capability: Capability }) {
  const { Icon, label, description, ready } = capability;
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2.5 transition hover:bg-slate-50">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
          <Icon size={16} />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-800">{label}</div>
          <div className="truncate text-xs text-slate-400">{description}</div>
        </div>
      </div>
      <span
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          ready ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-emerald-500" : "bg-slate-400"}`}
        />
        {ready ? "Operational" : "Unavailable"}
      </span>
    </div>
  );
}

export function Dashboard() {
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: getHealth, refetchInterval: 15_000 });
  const { data: sessions } = useQuery({ queryKey: ["sessions"], queryFn: listSessions });
  const { data: queue } = useQuery({ queryKey: ["queue"], queryFn: listQueueCalls });
  const { data: campaigns } = useQuery({ queryKey: ["campaigns"], queryFn: listCampaigns });
  const promiseClient = useQueryClient();
  const [calling, setCalling] = useState<string | null>(null);
  const [callNote, setCallNote] = useState<string | null>(null);
  // Chasing a promise means ringing the person back, so the row that names them is where
  // the call belongs - not a number to copy into the test-call form.
  const callAgain = useMutation({
    mutationFn: recallSession,
    onSuccess: () => {
      setCallNote("Calling now — it will show up in Conversations.");
      promiseClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data
        ?.detail;
      setCallNote(detail || (err as Error).message);
    },
    onSettled: () => setCalling(null),
  });

  const { data: promises } = useQuery({
    queryKey: ["promisesDue"],
    queryFn: getPromisesDue,
    refetchInterval: 60_000,
  });

  const activeSessions = sessions?.filter((s) => s.active).length ?? 0;
  const queuedCalls = queue?.filter((q) => q.status === "queued" || q.status === "ready").length ?? 0;

  const campaignStats = useMemo(() => {
    const list = campaigns ?? [];
    const running = list.filter((c) => c.status === "running").length;
    const totals = list.reduce(
      (acc, c) => {
        acc.completed += c.stats?.completed ?? 0;
        acc.noAnswer += c.stats?.no_answer ?? 0;
        acc.failed += c.stats?.failed ?? 0;
        return acc;
      },
      { completed: 0, noAnswer: 0, failed: 0 },
    );
    const attempted = totals.completed + totals.noAnswer + totals.failed;
    return {
      running,
      total: list.length,
      connectRate: attempted > 0 ? Math.round((totals.completed / attempted) * 100) : null,
      ...totals,
    };
  }, [campaigns]);

  // What a collections client actually looks at: how many calls produced a promise to
  // pay, how many were refused, how many never reached anyone. Derived from the sessions
  // already loaded, so this costs no extra request.
  const outcomes = useMemo(() => {
    const counts = new Map<string, number>();
    let analysed = 0;
    for (const s of sessions ?? []) {
      const code = (s as { disposition_code?: string | null }).disposition_code;
      if (!code) continue;
      analysed += 1;
      const key = code.toUpperCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const rows = [...counts.entries()]
      .map(([code, count]) => ({ code, count, group: dispositionTone(code).group }))
      .sort((a, b) => b.count - a.count);
    // Answer rate used to come off the campaign counters, which only know about calls a
    // campaign placed - 32 mostly-empty test campaigns reported 15% while the calls
    // themselves connected 73% of the time. Count the calls.
    const UNREACHED = ["NR", "ICR", "RNR", "LM"];
    const notReached = rows
      .filter((r) => UNREACHED.includes(r.code))
      .reduce((n, r) => n + r.count, 0);
    const reached = analysed - notReached;
    const counts_by_code: Record<string, number> = {};
    for (const [code, n] of counts.entries()) counts_by_code[code] = n;
    const grouped = countsForGroups(counts_by_code);
    // Codes outside the six tiles - ones belonging to other use cases, or any new one the
    // analysis starts returning - are deliberately left off this page. Saying how many
    // there are keeps the tiles from looking like they should add up to the total.
    const onTiles = Object.values(grouped).reduce((n, v) => n + v, 0);
    return {
      rows,
      analysed,
      reached,
      notReached,
      onTiles,
      otherCodes: analysed - onTiles,
      answerRate: analysed > 0 ? Math.round((reached / analysed) * 100) : null,
      byGroupKey: grouped,
    };
  }, [sessions]);

  const capabilities: Capability[] = [
    {
      key: "db",
      Icon: IconDatabase,
      label: "Data store",
      description: "Sessions, bulk calls and transcripts",
      ready: health?.mongo_ready,
    },
    {
      key: "stt",
      Icon: IconMic,
      label: "Speech recognition",
      description: "Transcribes the caller in real time",
      ready: health?.stt_ready,
    },
    {
      key: "llm",
      Icon: IconCpu,
      label: "Conversation engine",
      description: "Decides what the agent says next",
      ready: health?.llm_ready,
    },
    {
      key: "tts",
      Icon: IconSpeaker,
      label: "Voice synthesis",
      description: "Speaks the reply back to the caller",
      ready: health?.tts_ready,
    },
  ];

  const allReady = capabilities.every((c) => c.ready);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Live overview of your voice agent — calls, bulk calls and system health.
            </p>
          </div>
          <span
            className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium ${
              allReady
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${allReady ? "bg-emerald-500" : "bg-amber-500"}`}
            />
            {allReady ? "All systems operational" : "Degraded"}
          </span>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Conversations"
          value={sessions?.length ?? "—"}
          sub={`${activeSessions} currently active`}
          Icon={IconMessage}
          to="/sessions"
        />
        <StatCard
          label="Bulk Calls"
          value={campaignStats.total}
          sub={campaignStats.running > 0 ? `${campaignStats.running} running now` : "None running"}
          Icon={IconCampaign}
          to="/campaigns"
        />
        <StatCard
          label="Answer rate"
          value={outcomes.answerRate === null ? "—" : `${outcomes.answerRate}%`}
          sub={`${outcomes.reached} spoke · ${outcomes.notReached} not reached`}
          Icon={IconChart}
          to="/analytics"
        />
        <StatCard
          label="Calls in queue"
          value={queuedCalls}
          sub={queuedCalls === 0 ? "Nothing waiting" : "Waiting to dial"}
          Icon={IconHourglass}
          to="/calls"
        />
      </div>

      {/* Call outcomes */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Call outcomes</h2>
            <p className="text-xs text-slate-400">
              {outcomes.analysed === 0
                ? "Outcomes appear here once calls have been analysed"
                : outcomes.otherCodes > 0
                  ? `${outcomes.onTiles} of ${outcomes.analysed} analysed calls · ${outcomes.otherCodes} on other codes, in Bulk Calls`
                  : `Across ${outcomes.analysed} analysed call${outcomes.analysed === 1 ? "" : "s"}`}
            </p>
          </div>
          <Link
            to="/sessions"
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            All conversations
          </Link>
        </div>

        {outcomes.analysed > 0 ? (
          /* Six tiles, each a link into the calls behind it. A number nobody can act on
             is just decoration; from the list a caller can be dialled again or read. */
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
            {OUTCOME_GROUPS.map((g) => {
              const n = outcomes.byGroupKey[g.key] ?? 0;
              return (
                <Link
                  key={g.key}
                  to={`/sessions?outcome=${g.key}`}
                  className={`group rounded-xl border p-4 transition ${g.tile}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className={`text-2xl font-semibold ${g.value}`}>{n}</div>
                    <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
                      <IconArrowRight size={14} />
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs font-medium text-slate-700">{g.label}</div>
                  <div className="text-[11px] text-slate-400">{g.hint}</div>
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
            No analysed calls yet. Make a test call and the outcome will show up here.
          </p>
        )}
      </div>

      {/* Promises to chase. A promise is only worth something if somebody rings on the
        day, and the date and amount were already sitting in every scored call with
        nothing reading them back out. */}
      {promises && promises.counts.today + promises.counts.tomorrow + promises.counts.overdue > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Promises to chase</h2>
              <p className="text-xs text-slate-400">
                ₹{promises.amount_promised.toLocaleString("en-IN")} promised across{" "}
                {promises.counts.overdue +
                  promises.counts.today +
                  promises.counts.tomorrow +
                  promises.counts.later}{" "}
                calls
              </p>
            </div>
            <Link
              to="/sessions?outcome=promise"
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              All promises
            </Link>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { n: promises.counts.overdue, label: "Overdue", hint: "day has passed",
                cls: "border-rose-200 bg-rose-50", value: "text-rose-700" },
              { n: promises.counts.today, label: "Due today", hint: "ring them now",
                cls: "border-emerald-200 bg-emerald-50", value: "text-emerald-700" },
              { n: promises.counts.tomorrow, label: "Due tomorrow", hint: "line up for the morning",
                cls: "border-amber-200 bg-amber-50", value: "text-amber-700" },
            ].map((b) => (
              <div key={b.label} className={`rounded-xl border p-4 ${b.cls}`}>
                <div className={`text-2xl font-semibold ${b.value}`}>{b.n}</div>
                <div className="mt-0.5 text-xs font-medium text-slate-700">{b.label}</div>
                <div className="text-[11px] text-slate-400">{b.hint}</div>
              </div>
            ))}
          </div>

          {callNote && <p className="mt-3 text-xs text-slate-500">{callNote}</p>}

          <div className="mt-4 divide-y divide-slate-100">
            {promises.due_soon.slice(0, 6).map((p) => (
              <div key={p.session_id} className="flex items-center gap-3 py-2.5">
                <span className="w-24 shrink-0 font-mono text-xs text-slate-700">
                  {maskPhone(p.phone_number)}
                </span>
                <span className="w-20 shrink-0 text-xs text-slate-500">
                  {new Date(p.due).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </span>
                <span className="w-16 shrink-0 text-xs font-medium text-slate-700">
                  {p.amount > 0 ? `₹${p.amount.toLocaleString("en-IN")}` : "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500" title={p.summary}>
                  {p.summary}
                </span>
                <button
                  onClick={() => {
                    setCallNote(null);
                    setCalling(p.session_id);
                    callAgain.mutate(p.session_id);
                  }}
                  disabled={calling === p.session_id}
                  title="Ring this customer again"
                  className="shrink-0 rounded-lg bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
                >
                  {calling === p.session_id ? "Calling…" : "Call"}
                </button>
                <Link
                  to={`/sessions/${p.session_id}`}
                  className="shrink-0 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Open
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* System health */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">System health</h2>
              <p className="text-xs text-slate-400">Core capabilities powering every call</p>
            </div>
            <Link
              to="/settings"
              className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Settings
            </Link>
          </div>
          <div className="mt-3 space-y-2">
            {capabilities.map((c) => (
              <CapabilityRow key={c.key} capability={c} />
            ))}
          </div>
        </div>

        {/* Quick actions */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
          <p className="text-xs text-slate-400">Jump straight into the common tasks</p>
          <div className="mt-3 space-y-2">
            {[
              { to: "/campaigns", Icon: IconCampaign, label: "Start a bulk call", hint: "Pick a datasheet and language" },
              { to: "/templates", Icon: IconTemplate, label: "Edit prompts", hint: "Use cases and languages" },
              { to: "/datasheets", Icon: IconTable, label: "Upload a datasheet", hint: "Add contacts to call" },
              { to: "/sessions", Icon: IconMessage, label: "Review transcripts", hint: "Listen back to calls" },
            ].map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="group flex items-center gap-3 rounded-md border border-slate-200 px-3 py-2.5 transition hover:bg-slate-50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  <a.Icon size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{a.label}</div>
                  <div className="truncate text-xs text-slate-400">{a.hint}</div>
                </div>
                <span className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500">
                  <IconArrowRight size={16} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
