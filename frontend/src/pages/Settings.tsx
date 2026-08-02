import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getAppSettings,
  getDispositions,
  getHealth,
  getLogs,
  listProviders,
  listSupportedLanguages,
  setDispositions,
  updateAppSettings,
} from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import type { AppSettings, Disposition, ProviderCapability } from "../api/types";

const COLOR_OPTIONS = [
  "bg-green-500",
  "bg-blue-500",
  "bg-yellow-500",
  "bg-red-500",
  "bg-indigo-500",
  "bg-gray-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-teal-500",
  "bg-pink-500",
];

const TABS = ["Providers", "Calling", "Voice & Timing", "Dispositions", "System"] as const;
type Tab = (typeof TABS)[number];

/** Which AppSettings keys hold the provider + model for each capability. */
const CAPABILITY_FIELDS: Record<string, { provider: keyof AppSettings; model?: keyof AppSettings; icon: string; accent: string }> = {
  stt: { provider: "stt_provider", model: "stt_model", icon: "", accent: "bg-blue-50 text-blue-600" },
  llm: { provider: "llm_provider", model: "llm_model", icon: "", accent: "bg-slate-50 text-indigo-600" },
  tts: { provider: "tts_provider", model: "tts_model_id", icon: "", accent: "bg-amber-50 text-amber-600" },
  telephony: { provider: "telephony_provider", icon: "", accent: "bg-teal-50 text-teal-600" },
};

/** Renders one capability's provider + model pickers straight from the server registry,
 *  so a newly supported vendor shows up here without any frontend change. */
function ProviderCard({
  capabilityKey,
  capability,
  draft,
  set,
}: {
  capabilityKey: string;
  capability: ProviderCapability;
  draft: AppSettings;
  set: (k: keyof AppSettings, v: string) => void;
}) {
  const meta = CAPABILITY_FIELDS[capabilityKey];
  if (!meta) return null;

  const selectedKey = (draft[meta.provider] as string) ?? "";
  const selected = capability.providers.find((p) => p.key === selectedKey);
  const usable = capability.providers.filter((p) => p.available);
  const upcoming = capability.providers.filter((p) => !p.available);

  return (
    <Card icon={meta.icon} accent={meta.accent} title={capability.label}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Provider"
          value={selectedKey}
          onChange={(v) => {
            set(meta.provider, v);
            const next = capability.providers.find((p) => p.key === v);
            if (meta.model && next?.default_model) set(meta.model, next.default_model);
          }}
          options={usable.map((p) => ({ value: p.key, label: p.label }))}
          hint={usable.length <= 1 ? "More providers unlock as they're configured." : undefined}
        />
        {meta.model && (selected?.models.length ?? 0) > 0 && (
          <Field
            label="Model"
            value={(draft[meta.model] as string) ?? ""}
            onChange={(v) => set(meta.model!, v)}
            options={(selected?.models ?? []).map((m) => ({ value: m, label: m }))}
          />
        )}
      </div>

      {upcoming.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="text-[11px] font-medium text-slate-400">Not available yet</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {upcoming.map((p) => (
              <span
                key={p.key}
                title={
                  !p.implemented
                    ? "Support not built yet"
                    : `Add ${p.missing_env.join(", ")} to the server config`
                }
                className="rounded-full border border-dashed border-slate-200 px-2.5 py-1 text-[11px] text-slate-400"
              >
                {p.label}
                <span className="ml-1 text-slate-300">
                  {p.implemented ? "· needs keys" : "· coming soon"}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function Card({
  icon,
  accent,
  title,
  subtitle,
  children,
  action,
}: {
  icon: string;
  accent: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-base ${accent}`}>
            {icon}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function useSettingsForm() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["app-settings"], queryFn: getAppSettings });
  const [draft, setDraft] = useState<AppSettings>({});

  useEffect(() => {
    if (data?.settings) setDraft(data.settings);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: AppSettings) => updateAppSettings(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["app-settings"] }),
  });

  const dirty = JSON.stringify(draft) !== JSON.stringify(data?.settings ?? {});
  return { data, isLoading, draft, setDraft, saveMutation, dirty };
}

/** Sticky footer so the save action is always reachable on long forms. */
function SaveBar({ dirty, pending, onSave }: { dirty: boolean; pending: boolean; onSave: () => void }) {
  return (
    <div className="sticky bottom-0 z-10 flex items-center gap-3 rounded-lg border border-slate-200 bg-white/90 px-5 py-3 shadow-sm backdrop-blur">
      <button
        onClick={onSave}
        disabled={!dirty || pending}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
      >
        {pending ? "Saving..." : "Save changes"}
      </button>
      {dirty && !pending ? (
        <span className="flex items-center gap-1.5 text-xs text-amber-600">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Unsaved changes
        </span>
      ) : (
        !pending && <span className="text-xs text-slate-400">Everything saved</span>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  options,
  type = "text",
  suffix,
}: {
  label: string;
  value: string | number | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  type?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="relative mt-1.5">
        {options ? (
          <select
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              type={type}
              value={value ?? ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 ${suffix ? "pr-14" : ""}`}
            />
            {suffix && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
                {suffix}
              </span>
            )}
          </>
        )}
      </div>
      {hint && <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

function DispositionsEditor() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const [rows, setRows] = useState<Disposition[]>([]);

  useEffect(() => {
    setRows(data ?? []);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () => setDispositions(rows),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dispositions"] }),
  });

  const updateRow = (idx: number, field: keyof Disposition, value: string) => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };
  const removeRow = (idx: number) => setRows(rows.filter((_, i) => i !== idx));
  const addRow = () => setRows([...rows, { value: "", color: COLOR_OPTIONS[0], label: "" }]);

  return (
    <Card
      icon=""
      accent="bg-purple-50 text-purple-600"
      title="Disposition codes"
      subtitle="Call outcomes returned by the analysis step; also colour the campaign badges."
      action={
        <button
          onClick={addRow}
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Add
        </button>
      }
    >
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/60 p-2 transition hover:border-slate-200 hover:bg-white"
          >
            <span className={`h-7 w-7 shrink-0 rounded-lg ${row.color}`} />
            <input
              value={row.value}
              onChange={(e) => updateRow(idx, "value", e.target.value.toUpperCase())}
              placeholder="PTP"
              className="w-44 rounded-lg border border-slate-300 px-2.5 py-1.5 font-mono text-xs"
            />
            <input
              value={row.label}
              onChange={(e) => updateRow(idx, "label", e.target.value)}
              placeholder="Promise To Pay"
              className="flex-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
            />
            <select
              value={row.color}
              onChange={(e) => updateRow(idx, "color", e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
            >
              {COLOR_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {c.replace("bg-", "").replace("-500", "")}
                </option>
              ))}
            </select>
            <button
              onClick={() => removeRow(idx)}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-500"
            >
              
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-400">
            No dispositions configured yet.
          </p>
        )}
      </div>
      <button
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
        className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {saveMutation.isPending ? "Saving..." : "Save dispositions"}
      </button>
    </Card>
  );
}

function StatusRow({ label, description, ok }: { label: string; description: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-800">{label}</div>
        <div className="truncate text-xs text-slate-400">{description}</div>
      </div>
      <span
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
          ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-slate-400"}`} />
        {ok ? "Operational" : "Unavailable"}
      </span>
    </div>
  );
}

export function Settings() {
  const { apiUrl } = useAuth();
  const [tab, setTab] = useState<Tab>("Providers");
  const { data, draft, setDraft, saveMutation, dirty } = useSettingsForm();
  const { data: languages } = useQuery({ queryKey: ["languages"], queryFn: listSupportedLanguages });
  const { data: providers } = useQuery({ queryKey: ["providers"], queryFn: listProviders });
  const { data: health } = useQuery({ queryKey: ["health"], queryFn: getHealth });
  const { data: logs } = useQuery({ queryKey: ["logs"], queryFn: getLogs, refetchInterval: 5_000 });

  const numbers = data?.numbers ?? {};
  const set = (k: keyof AppSettings, v: string | number) => setDraft({ ...draft, [k]: v });
  const doSave = () => saveMutation.mutate(draft);

  const activeNetwork = draft.telephony_provider ?? "exotel";

  return (
    <div className="space-y-5 pb-4">
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          How calls are placed and how the agent behaves. Prompts and languages live in Templates.
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Providers" && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Which engine powers each part of a call. Options appear here automatically as new
            providers are supported; credentials stay on the server.
          </p>
          {Object.entries(providers ?? {}).map(([key, capability]) => (
            <ProviderCard
              key={key}
              capabilityKey={key}
              capability={capability as ProviderCapability}
              draft={draft}
              set={set}
            />
          ))}
          {!providers && <p className="text-sm text-slate-400">Loading providers...</p>}
          <SaveBar dirty={dirty} pending={saveMutation.isPending} onSave={doSave} />
        </div>
      )}

      {tab === "Calling" && (
        <div className="space-y-4">
          <Card
            icon=""
            accent="bg-teal-50 text-teal-600"
            title="Outbound calling"
            subtitle="Applies to every campaign."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Caller ID"
                value={draft.from_number}
                onChange={(v) => set("from_number", v)}
                placeholder={numbers[activeNetwork] || "Use the configured number"}
                hint={
                  numbers[activeNetwork]
                    ? `Leave blank to use ${numbers[activeNetwork]}`
                    : "Leave blank to use the number configured on the server."
                }
              />
            </div>
          </Card>
          <SaveBar dirty={dirty} pending={saveMutation.isPending} onSave={doSave} />
        </div>
      )}

      {tab === "Voice & Timing" && (
        <div className="space-y-4">
          <Card
            icon=""
            accent="bg-orange-50 text-orange-600"
            title="Conversation timing"
            subtitle="How patient the agent is before re-prompting or hanging up."
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field
                label="Wait before re-prompting"
                type="number"
                suffix="sec"
                value={draft.silence_first_seconds}
                onChange={(v) => set("silence_first_seconds", Number(v))}
                hint="Silence before the agent nudges the caller."
              />
              <Field
                label="Wait before hanging up"
                type="number"
                suffix="sec"
                value={draft.silence_second_seconds}
                onChange={(v) => set("silence_second_seconds", Number(v))}
                hint="Further silence after the nudge ends the call."
              />
              <Field
                label="Maximum call length"
                type="number"
                suffix="sec"
                value={draft.max_call_seconds}
                onChange={(v) => set("max_call_seconds", Number(v))}
                hint="Hard cap on any single call."
              />
            </div>
          </Card>

          <Card
            icon=""
            accent="bg-blue-50 text-blue-600"
            title="Language fallback"
            subtitle="Used when a campaign runs on Auto and a row has no language of its own."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2">
              <Field
                label="Fallback language"
                value={draft.default_language}
                onChange={(v) => set("default_language", v)}
                options={(languages ?? []).map((l) => ({ value: l.key, label: l.label }))}
              />
            </div>
          </Card>

          <Card
            icon=""
            accent="bg-amber-50 text-amber-600"
            title="Default voice"
            subtitle="Used when a language in Templates does not specify its own voice."
          >
            <div className="grid grid-cols-1 sm:grid-cols-2">
              <Field
                label="Voice ID"
                value={draft.tts_voice_id}
                onChange={(v) => set("tts_voice_id", v)}
                placeholder="Voice identifier"
              />
            </div>
          </Card>

          <SaveBar dirty={dirty} pending={saveMutation.isPending} onSave={doSave} />
        </div>
      )}

      {tab === "Dispositions" && <DispositionsEditor />}

      {tab === "System" && (
        <div className="space-y-4">
          <Card
            icon=""
            accent="bg-emerald-50 text-emerald-600"
            title="System health"
            subtitle="Capabilities powering every call."
          >
            <div className="space-y-2">
              <StatusRow label="Data store" description="Sessions, campaigns and transcripts" ok={health?.mongo_ready} />
              <StatusRow label="Speech recognition" description="Transcribes the caller" ok={health?.stt_ready} />
              <StatusRow label="Conversation engine" description="Decides the agent's replies" ok={health?.llm_ready} />
              <StatusRow label="Voice synthesis" description="Speaks replies to the caller" ok={health?.tts_ready} />
            </div>
            <p className="mt-3 text-xs text-slate-400">
              Anything unavailable is missing server-side configuration and needs a server restart
              once corrected.
            </p>
          </Card>

          <Card icon="" accent="bg-slate-100 text-slate-600" title="Connection">
            <p className="font-mono text-sm text-slate-600">{apiUrl}</p>
          </Card>

          <Card icon="" accent="bg-slate-100 text-slate-600" title="Recent activity">
            <pre className="max-h-96 overflow-auto rounded-xl bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
              {logs || "No activity recorded yet."}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
}
