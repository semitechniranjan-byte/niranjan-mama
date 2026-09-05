import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDialog } from "../components/Dialog";
import { createAgent, deleteAgent, listAgents, listDatasheets, updateAgent } from "../api/endpoints";
import type { Agent } from "../api/types";
import { IconPlus, IconTrash, IconUsers, IconX } from "../components/Icons";

function AgentModal({
  agent,
  onClose,
  onSave,
  pending,
}: {
  agent: Agent | null;
  onClose: () => void;
  onSave: (v: { name: string; description: string; max_concurrent_calls: number; max_call_seconds: number }) => void;
  pending: boolean;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [capacity, setCapacity] = useState(agent?.max_concurrent_calls ?? 100);
  const [maxSeconds, setMaxSeconds] = useState(agent?.max_call_seconds ?? 180);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{agent ? "Edit agent" : "New agent"}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <IconX size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            Agent name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent 1"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Description
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Primary calling pool"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-600">
              Simultaneous calls
              <input
                type="number"
                min={1}
                value={capacity}
                onChange={(e) => setCapacity(Number(e.target.value))}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">
                How many calls this agent runs at once.
              </span>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              Max call length (sec)
              <input
                type="number"
                min={10}
                value={maxSeconds}
                onChange={(e) => setMaxSeconds(Number(e.target.value))}
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">
                Calls running past this are hung up.
              </span>
            </label>
          </div>
        </div>

        <button
          onClick={() =>
            onSave({ name: name.trim(), description: description.trim(), max_concurrent_calls: capacity, max_call_seconds: maxSeconds })
          }
          disabled={pending || !name.trim() || capacity < 1}
          className="mt-5 w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          {pending ? "Saving..." : agent ? "Save changes" : "Create agent"}
        </button>
      </div>
    </div>
  );
}

/** Turns capacity + call length into an estimated time to work through a datasheet. */
function CapacityPlanner({ totalCapacity, avgSeconds }: { totalCapacity: number; avgSeconds: number }) {
  const { data: datasheets } = useQuery({ queryKey: ["datasheets"], queryFn: listDatasheets });
  const [records, setRecords] = useState(20000);

  const biggest = useMemo(
    () => (datasheets ?? []).reduce((max, d) => Math.max(max, d.row_count ?? 0), 0),
    [datasheets],
  );

  const callsPerHour = totalCapacity > 0 && avgSeconds > 0 ? (3600 / avgSeconds) * totalCapacity : 0;
  const hours = callsPerHour > 0 ? records / callsPerHour : 0;

  const fmt = (h: number) => {
    if (!isFinite(h) || h <= 0) return "—";
    if (h < 1) return `${Math.ceil(h * 60)} min`;
    if (h < 24) return `${h.toFixed(1)} hours`;
    return `${(h / 24).toFixed(1)} days`;
  };

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">Capacity planner</h2>
        <p className="text-xs text-slate-400">
          Throughput assuming every agent is saturated and calls average the length below.
        </p>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block text-xs font-medium text-slate-600">
            Records to call
            <input
              type="number"
              value={records}
              onChange={(e) => setRecords(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
            {biggest > 0 && (
              <button
                onClick={() => setRecords(biggest)}
                className="mt-1 text-[11px] font-normal text-slate-500 hover:underline"
              >
                Use largest datasheet ({biggest.toLocaleString()})
              </button>
            )}
          </label>
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="text-xs text-slate-400">Total simultaneous calls</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{totalCapacity}</div>
            <div className="text-[11px] text-slate-400">across all agents</div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <div className="text-xs text-emerald-700">Estimated time</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-800">{fmt(hours)}</div>
            <div className="text-[11px] text-emerald-600">
              ≈ {Math.round(callsPerHour).toLocaleString()} calls/hour
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Estimate only — real throughput depends on answer rate, ring time and any limits your
          calling provider enforces on simultaneous channels.
        </p>
      </div>
    </div>
  );
}

export function Agents() {
  const dialog = useDialog();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["agents"],
    queryFn: listAgents,
    refetchInterval: 5_000,
  });
  const [modal, setModal] = useState<{ agent: Agent | null } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["agents"] });

  const createMutation = useMutation({ mutationFn: createAgent, onSuccess: () => { invalidate(); setModal(null); } });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<Agent> }) => updateAgent(id, payload),
    onSuccess: () => { invalidate(); setModal(null); },
  });
  const deleteMutation = useMutation({ mutationFn: deleteAgent, onSuccess: invalidate });

  const agents = data?.agents ?? [];
  // Agent limits divide the deployment ceiling; they do not raise it. Adding them up and
  // calling the total the capacity read as 500 on a host that runs 5.
  const ceiling = data?.max_concurrent_calls ?? 0;
  const configured = agents.reduce((sum, a) => sum + (a.max_concurrent_calls ?? 0), 0);
  const totalCapacity = ceiling > 0 ? Math.min(configured, ceiling) : configured;
  const oversubscribed = ceiling > 0 && configured > ceiling;
  const avgSeconds =
    agents.length > 0
      ? Math.round(agents.reduce((s, a) => s + (a.max_call_seconds ?? 180), 0) / agents.length)
      : 180;
  const totalActive = data?.total_active_calls ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-slate-900">Agents</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Each agent is a calling pool — its capacity is how many calls run at the same time.
          </p>
        </div>
        <button
          onClick={() => setModal({ agent: null })}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Add Agent
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile label="Agents" value={String(agents.length)} />
        <Tile
          label="Calls running now"
          value={String(totalActive)}
          hint={totalCapacity > 0 ? `of ${totalCapacity} that can run at once` : undefined}
          tone={totalActive > 0 ? "text-emerald-700" : undefined}
        />
        <Tile
          label="Ceiling on this host"
          value={ceiling > 0 ? String(ceiling) : "—"}
          hint={
            oversubscribed
              ? `Agents are set to ${configured}; the host allows ${ceiling}`
              : "Set by MAX_CONCURRENT_CALLS"
          }
          tone={oversubscribed ? "text-amber-700" : undefined}
        />
      </div>

      {oversubscribed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          These agents are configured for <strong>{configured}</strong> calls at once, but this
          host runs at most <strong>{ceiling}</strong>. Calls beyond that wait their turn rather
          than failing — raise MAX_CONCURRENT_CALLS, and the instance size with it, to use the
          rest.
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      {/* Compact 4-up grid: an agent is a small tile, not a full-width panel. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {agents.map((a) => {
          const used = a.active_calls ?? 0;
          const pct = a.max_concurrent_calls > 0 ? Math.min(100, (used / a.max_concurrent_calls) * 100) : 0;
          // Throughput off an agent limit the host cannot honour is a made-up number.
          const effective = ceiling > 0 ? Math.min(a.max_concurrent_calls, ceiling) : a.max_concurrent_calls;
          const perHour = Math.round((3600 / (a.max_call_seconds || 180)) * effective);
          return (
            <div
              key={a._id}
              className="group flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                    <IconUsers size={14} />
                  </span>
                  <h3 className="truncate text-sm font-semibold text-slate-900">{a.name}</h3>
                </div>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                    used > 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {used > 0 ? "Calling" : "Idle"}
                </span>
              </div>

              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-2xl font-semibold tracking-tight text-slate-900">
                  {effective}
                </span>
                <span className="text-xs text-slate-400">at a time</span>
                {effective !== a.max_concurrent_calls && (
                  <span
                    className="ml-auto rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                    title={`Set to ${a.max_concurrent_calls}, capped by the host ceiling of ${ceiling}`}
                  >
                    set {a.max_concurrent_calls}
                  </span>
                )}
              </div>

              <div className="mt-2 space-y-0.5 text-[11px] text-slate-500">
                <div className="flex justify-between">
                  <span>In progress</span>
                  <span className="font-medium text-slate-700">{used}</span>
                </div>
                <div className="flex justify-between">
                  <span>Max length</span>
                  <span className="font-medium text-slate-700">{a.max_call_seconds}s</span>
                </div>
                <div className="flex justify-between">
                  <span>Throughput</span>
                  <span className="font-medium text-slate-700">{perHour.toLocaleString()}/hr</span>
                </div>
              </div>

              <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>

              {/* Kept visible. Hiding these until hover left a band of empty space under
                  every tile and a ghost of the buttons showing through it. */}
              <div className="mt-auto flex gap-1.5 pt-3">
                <button
                  onClick={() => setModal({ agent: a })}
                  className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    void (async () => {
                        if (await dialog.confirm(`Delete agent "${a.name}"?`, { danger: true }))
                          deleteMutation.mutate(a._id);
                      })();
                  }}
                  className="rounded-md border border-slate-200 px-2 py-1 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  title="Delete agent"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            </div>
          );
        })}

        {/* Add tile sits inline with the grid rather than as a separate control. */}
        {!isLoading && (
          <button
            onClick={() => setModal({ agent: null })}
            className="flex min-h-[11rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white text-slate-400 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            <IconPlus size={18} />
            <span className="text-xs font-medium">Add agent</span>
          </button>
        )}
      </div>

      {agents.length === 0 && !isLoading && (
        <p className="text-xs text-slate-400">
          Campaigns fall back to 100 simultaneous calls until you create an agent.
        </p>
      )}

      <CapacityPlanner totalCapacity={totalCapacity} avgSeconds={avgSeconds} />

      {modal && (
        <AgentModal
          agent={modal.agent}
          pending={createMutation.isPending || updateMutation.isPending}
          onClose={() => setModal(null)}
          onSave={(v) =>
            modal.agent
              ? updateMutation.mutate({ id: modal.agent._id, payload: v })
              : createMutation.mutate(v)
          }
        />
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone || "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}
