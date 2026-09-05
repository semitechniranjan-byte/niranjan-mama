import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { IconEye, IconHistory, IconPhone, IconTrash, IconUser } from "../components/Icons";
import { DispositionBadge, maskPhone } from "../components/Disposition";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOutboundCall,
  getDispositions,
  getTemplatePlaceholders,
  listSessions,
  listTemplates,
} from "../api/endpoints";
import type { Template } from "../api/types";

const HISTORY_KEY = "testCallHistory";
const HISTORY_LIMIT = 200;

type HistoryEntry = {
  id: string;
  phone: string;
  status: "success" | "error";
  at: string;
  useCase?: string;
  language?: string;
  sessionId?: string | null;
  response: unknown;
};

type Field = {
  key: string;
  value: string;
  /** "script" fields belong to the selected prompt; "custom" ones the operator added. */
  source: "script" | "custom";
};

/** CUSTOMER_NAME -> "Customer name", so the form reads as a form and not as a variable list. */
function prettyKey(key: string): string {
  const words = key.toLowerCase().split("_").filter(Boolean);
  if (!words.length) return key;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? " " + words.slice(1).join(" ") : "");
}

const KEY_EXAMPLES: Record<string, string> = {
  CUSTOMER_NAME: "Niranjan Kumar",
  COMPANY_NAME: "Qsilon",
  ORDER_ID: "ORD-4471",
  PROJECT_NAME: "Green Acres",
  AGENT_CALLBACK_NUMBER: "9876543210",
};

function placeholderFor(key: string): string {
  return KEY_EXAMPLES[key] ?? "";
}

/** Keys that hold a sentence rather than a word, and so get a full row and a textarea. */
function isLongFormKey(key: string): boolean {
  return /INFO|DETAILS|ADDRESS|NOTES|DESCRIPTION|SUMMARY|MESSAGE/.test(key);
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function Card({
  Icon,
  title,
  subtitle,
  action,
  children,
}: {
  Icon: ComponentType<{ size?: number }>;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Icon size={16} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function languagesOf(template: Template | null | undefined, useCase: string) {
  const languages = template?.use_cases?.[useCase]?.languages ?? {};
  return Object.entries(languages).map(([key, cfg]) => ({
    key,
    ready: (cfg?.prompt ?? "").trim().length > 0,
  }));
}

export function Calls() {
  const queryClient = useQueryClient();
  const { data: templates } = useQuery({ queryKey: ["templates"], queryFn: listTemplates });
  const template = templates?.[0] ?? null;
  const useCaseKeys = Object.keys(template?.use_cases ?? {});

  const [localNumber, setLocalNumber] = useState("");
  const [showNumber, setShowNumber] = useState(false);
  // The API wants E.164; the field only ever holds the local ten digits.
  const phone = localNumber ? `+91${localNumber}` : "";
  const [useCase, setUseCase] = useState("");
  const [language, setLanguage] = useState("");
  const [fields, setFields] = useState<Field[]>([
    { key: "CUSTOMER_NAME", value: "", source: "script" },
  ]);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);

  // History is stored locally and only knows whether the call was accepted for dialling.
  // The outcome - promise to pay, refused, unreachable - is decided by the post-call
  // analysis, so it is looked up from the session and refreshed while a call is running.
  const { data: sessions } = useQuery({
    queryKey: ["sessions"],
    queryFn: listSessions,
    refetchInterval: 8_000,
  });
  const { data: dispositions } = useQuery({ queryKey: ["dispositions"], queryFn: getDispositions });
  const sessionById = useMemo(
    () => new Map((sessions ?? []).map((s) => [s.session_id, s])),
    [sessions],
  );
  const dispositionLabels = useMemo(
    () => Object.fromEntries((dispositions ?? []).map((d) => [d.value, d.label])),
    [dispositions],
  );
  const [error, setError] = useState<string | null>(null);

  const effectiveUseCase = useCase || template?.default_use_case || useCaseKeys[0] || "";
  const languages = languagesOf(template, effectiveUseCase);
  const effectiveLanguage =
    language || (languages.find((l) => l.ready)?.key ?? languages[0]?.key ?? "");
  const selectedReady = languages.find((l) => l.key === effectiveLanguage)?.ready !== false;

  // Which {PLACEHOLDER}s this particular script uses. Only the prompt knows - the EMI
  // script wants one, the real-estate script wants five - and anything left unfilled
  // reaches the caller as a blank in mid-sentence.
  const { data: placeholderInfo } = useQuery({
    queryKey: ["templatePlaceholders", template?._id, effectiveUseCase, effectiveLanguage],
    queryFn: () =>
      getTemplatePlaceholders({
        template_id: template?._id,
        use_case: effectiveUseCase,
        language: effectiveLanguage,
      }),
    enabled: Boolean(effectiveUseCase),
  });
  const required = useMemo(() => placeholderInfo?.placeholders ?? [], [placeholderInfo]);
  const requiredKey = required.join("|");
  const filledCount = required.filter(
    (k) => fields.find((f) => f.key.trim().toUpperCase() === k)?.value.trim(),
  ).length;

  // Give every placeholder its own box, keeping anything already typed and any extra key
  // the operator added by hand.
  useEffect(() => {
    if (!required.length) return;
    setFields((prev) => {
      const typed = new Map(prev.map((f) => [f.key.trim().toUpperCase(), f.value]));
      const fromScript: Field[] = required.map((key) => ({
        key,
        value: typed.get(key) ?? "",
        source: "script",
      }));
      // Only what the operator added by hand survives a change of use case. Keeping the
      // previous script's placeholders left Real Estate's five keys sitting under
      // E-commerce's three as empty rows that meant nothing to either.
      const kept = prev.filter(
        (f) => f.source === "custom" && !required.includes(f.key.trim().toUpperCase()),
      );
      return [...fromScript, ...kept];
    });
    // required is rebuilt on every fetch; compare by content so this does not loop.
  }, [requiredKey]);

  useEffect(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, HISTORY_LIMIT)));
  }, [history]);

  const pushHistory = (entry: HistoryEntry) => setHistory((h) => [entry, ...h].slice(0, HISTORY_LIMIT));

  const callMutation = useMutation({
    mutationFn: () => {
      const format_values: Record<string, string> = {};
      for (const f of fields) {
        // Placeholders in prompts are uppercase, so normalise keys on the way out.
        if (f.key.trim()) format_values[f.key.trim().toUpperCase()] = f.value;
      }
      return createOutboundCall({
        to_number: phone.trim(),
        use_case: effectiveUseCase,
        language: effectiveLanguage,
        format_values,
      });
    },
    onSuccess: (data) => {
      setError(null);
      const d = data as Record<string, unknown>;
      pushHistory({
        id: crypto.randomUUID(),
        phone: phone.trim(),
        status: "success",
        at: new Date().toISOString(),
        useCase: d.use_case as string,
        language: d.language as string,
        sessionId: (d.session_id as string) ?? null,
        response: data,
      });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
        (err as Error)?.message ||
        "Call failed.";
      setError(detail);
      pushHistory({
        id: crypto.randomUUID(),
        phone: phone.trim(),
        status: "error",
        at: new Date().toISOString(),
        useCase: effectiveUseCase,
        language: effectiveLanguage,
        response: { status: "error", message: detail },
      });
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // A partial number reaches the provider and fails there; catch it here.
    if (localNumber.length !== 10 || !effectiveUseCase || !effectiveLanguage) return;
    setError(null);
    callMutation.mutate();
  };

  const reset = () => {
    setLocalNumber("");
    setUseCase("");
    setLanguage("");
    setFields([{ key: "CUSTOMER_NAME", value: "", source: "script" }]);
    setError(null);
  };

  const setField = (idx: number, patch: Partial<Field>) =>
    setFields(fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">Test Call</h1>
        <p className="mt-0.5 text-sm text-slate-500">Initiate a single voice call to a customer</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card Icon={IconPhone} title="Call Configuration">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs font-medium text-slate-600 lg:col-span-2">
            Phone Number <span className="text-red-500">*</span>
            {/* +91 is fixed rather than typed: it was the commonest way to get a call
                rejected. Digits are hidden by default because this screen gets shown in
                meetings, with a toggle for when the operator needs to check the number. */}
            <div className="mt-1 flex h-9 items-stretch overflow-hidden rounded-lg border border-slate-300 transition focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100">
              <span className="flex select-none items-center gap-1 border-r border-slate-200 bg-slate-50 px-2.5 text-sm font-medium text-slate-600">
                <IconPhone size={13} />
                +91
              </span>
              <input
                value={localNumber}
                onChange={(e) => setLocalNumber(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                type={showNumber ? "text" : "password"}
                inputMode="numeric"
                autoComplete="off"
                placeholder="10 digit number"
                className="min-w-0 flex-1 px-2.5 font-mono text-sm tracking-wide outline-none"
              />
              <button
                type="button"
                onClick={() => setShowNumber((v) => !v)}
                title={showNumber ? "Hide number" : "Show number"}
                className="flex items-center px-2.5 text-slate-400 transition hover:text-indigo-600"
              >
                <IconEye size={15} />
              </button>
            </div>
            {localNumber.length > 0 && localNumber.length < 10 && (
              <p className="mt-1 text-[11px] text-amber-600">
                {10 - localNumber.length} digit{10 - localNumber.length === 1 ? "" : "s"} remaining
              </p>
            )}
          </label>

            <label className="block text-xs font-medium text-slate-600">
              Use case <span className="text-red-500">*</span>
              <select
                value={effectiveUseCase}
                onChange={(e) => {
                  setUseCase(e.target.value);
                  setLanguage("");
                }}
                className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
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
              Language <span className="text-red-500">*</span>
              <select
                value={effectiveLanguage}
                onChange={(e) => setLanguage(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              >
                {languages.length === 0 && <option value="">No languages configured</option>}
                {languages.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.key}
                    {l.ready ? "" : "  (no prompt yet)"}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!selectedReady && effectiveLanguage && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              "{effectiveLanguage}" has no prompt configured yet —{" "}
              <Link to="/templates" className="font-medium underline">
                add one in Templates
              </Link>
              .
            </p>
          )}
        </Card>

        <Card
          Icon={IconUser}
          title="Customer Details"
          action={
            <div className="flex items-center gap-3">
              {required.length > 0 && (
                <span className="text-[11px] text-slate-500">
                  <span
                    className={filledCount === required.length ? "text-emerald-600" : "text-amber-600"}
                  >
                    {filledCount}
                  </span>
                  <span className="text-slate-400"> / {required.length} filled</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => setFields([...fields, { key: "", value: "", source: "custom" }])}
                className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                Add Field
              </button>
            </div>
          }
        >
          {/* Two to a row: one placeholder per full-width line turned five short answers
              into a wall of identical boxes, and free text needs the room more than a name
              does. */}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            {fields.map((f, idx) => {
              const key = f.key.trim().toUpperCase();
              const fromScript = required.includes(key);
              const wide = fromScript && isLongFormKey(key);
              const empty = !f.value.trim();
              return (
                <div
                  key={`${key || "extra"}-${idx}`}
                  className={wide ? "sm:col-span-2" : undefined}
                >
                  {fromScript ? (
                    <label className="block">
                      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                        {empty && (
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                            title="Not filled in yet"
                          />
                        )}
                        {prettyKey(key)}
                        <span className="font-mono text-[9px] font-normal text-slate-400">
                          {key}
                        </span>
                      </span>
                      {wide ? (
                        <textarea
                          value={f.value}
                          onChange={(e) => setField(idx, { value: e.target.value })}
                          rows={2}
                          placeholder={placeholderFor(key)}
                          className="w-full resize-y rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                      ) : (
                        <input
                          value={f.value}
                          onChange={(e) => setField(idx, { value: e.target.value })}
                          placeholder={placeholderFor(key)}
                          className="h-9 w-full rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                      )}
                    </label>
                  ) : (
                    <div>
                      <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-500">
                        Extra field
                        {/* Only hand-added rows can go; the script's own are not optional and
                            carry no button to look at. */}
                        <button
                          type="button"
                          onClick={() => setFields(fields.filter((_, i) => i !== idx))}
                          className="ml-auto rounded p-0.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500"
                          title="Remove field"
                        >
                          <IconTrash size={13} />
                        </button>
                      </span>
                      <div className="flex gap-2">
                        <input
                          value={f.key}
                          onChange={(e) => setField(idx, { key: e.target.value })}
                          placeholder="KEY_NAME"
                          className="h-9 w-2/5 rounded-lg border border-slate-300 px-2.5 font-mono text-xs uppercase transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                        <input
                          value={f.value}
                          onChange={(e) => setField(idx, { value: e.target.value })}
                          placeholder="value"
                          className="h-9 flex-1 rounded-lg border border-slate-300 px-2.5 text-sm transition focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={callMutation.isPending || localNumber.length !== 10 || !effectiveUseCase || !effectiveLanguage}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-40"
          >
            {callMutation.isPending ? "Calling..." : "Make Call"}
          </button>
        </div>
      </form>

      <Card
        Icon={IconHistory}
        title={`Call History (${history.length})`}
        action={
          history.length > 0 ? (
            <button
              onClick={() => setHistory([])}
              className="text-xs font-medium text-red-500 transition hover:underline"
            >
              Clear All
            </button>
          ) : undefined
        }
      >
        {history.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">No test calls yet.</p>
        ) : (
          <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {history.map((h) => {
              const session = h.sessionId ? sessionById.get(h.sessionId) : undefined;
              const code = session?.disposition_code ?? null;
              const live = session?.active;
              return (
              <div key={h.id} className="rounded-xl border border-slate-200 p-3 transition hover:border-slate-300">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm text-slate-800" title="Number hidden on shared screens">{maskPhone(h.phone)}</span>
                    {h.status === "success" ? (
                      live ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                          On call
                        </span>
                      ) : (
                        <DispositionBadge code={code} label={code ? dispositionLabels[code] : undefined} />
                      )
                    ) : (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600">
                        {h.status}
                      </span>
                    )}
                    {h.language && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        {h.language}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">{fmtTime(h.at)}</span>
                    {h.sessionId && (
                      <Link
                        to={`/sessions/${h.sessionId}`}
                        className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-700"
                      >
                        View Call
                      </Link>
                    )}
                    <button
                      onClick={() => setHistory(history.filter((x) => x.id !== h.id))}
                      className="rounded-md px-1.5 py-1 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      title="Remove"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>

                {/* A raw JSON dump is fine for debugging and wrong for a demo. Show what
                    the call actually produced; the payload stays available on request. */}
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-slate-500">
                  {h.useCase && (
                    <span>
                      Use case <span className="font-medium text-slate-700">{h.useCase}</span>
                    </span>
                  )}
                  {session?.call_status && (
                    <span>
                      Call <span className="font-medium text-slate-700">{session.call_status}</span>
                    </span>
                  )}
                  {code && dispositionLabels[code] && (
                    <span className="text-slate-600">{dispositionLabels[code]}</span>
                  )}
                  {!session && h.status === "success" && (
                    <span className="text-slate-400">Waiting for the call to finish…</span>
                  )}
                </div>

                <details className="mt-2 group">
                  <summary className="cursor-pointer select-none text-[11px] text-slate-400 transition hover:text-slate-600">
                    Raw response
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-[11px] leading-relaxed text-emerald-300">
                    {JSON.stringify(h.response, null, 2)}
                  </pre>
                </details>
              </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
