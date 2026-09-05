import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTemplate,
  listDatasheets,
  listSupportedLanguages,
  listTemplates,
  updateTemplate,
} from "../api/endpoints";
import type { LanguageConfig, Template, UseCase } from "../api/types";
import { getApiUrl } from "../api/client";
import { useDialog } from "../components/Dialog";

function useSingleTemplate() {
  const queryClient = useQueryClient();
  const { data: templates, isLoading, error } = useQuery({ queryKey: ["templates"], queryFn: listTemplates });

  const ensureMutation = useMutation({
    mutationFn: () => createTemplate({ name: "app-template", prompts: { default: "" } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] }),
  });

  useEffect(() => {
    if (templates && templates.length === 0 && !ensureMutation.isPending) {
      ensureMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  const template = templates?.[0] ?? null;
  const loadError = error as Error | null;

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<Template>) => {
      if (!template) throw new Error("No template loaded yet");
      return updateTemplate(template._id, payload);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["templates"] }),
  });

  return {
    template,
    isLoading: isLoading || (templates?.length === 0 && ensureMutation.isPending),
    saveMutation,
    loadError,
  };
}

const LANGUAGE_TABS = [
  { key: "prompt", label: "Prompt", multiline: true, hint: "System prompt the LLM follows for this language." },
  { key: "greeting", label: "Greeting", multiline: true, hint: "Opening line. Placeholders like {CUSTOMER_NAME} are filled from the datasheet row." },
  { key: "analysis_prompt", label: "Analysis Prompt", multiline: true, hint: "Post-call prompt that returns JSON into model_data. Use {conversation_text}." },
] as const;

const VOICE_FIELDS = [
  { key: "stt_lan_code", label: "Recognition language code", placeholder: "hi" },
  { key: "tts_lan_code", label: "Speech language code", placeholder: "hi" },
  { key: "tts_voice_id", label: "Voice ID", placeholder: "Voice identifier" },
  { key: "tts_model_id", label: "Voice model", placeholder: "Default model" },
] as const;

function LanguageEditor({
  config,
  onSave,
}: {
  config: LanguageConfig;
  onSave: (next: LanguageConfig) => void;
}) {
  const [draft, setDraft] = useState<LanguageConfig>(config);
  const [tab, setTab] = useState<string>("prompt");

  useEffect(() => setDraft(config), [config]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);
  const set = (k: keyof LanguageConfig, v: string) => setDraft({ ...draft, [k]: v });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-slate-100">
        {LANGUAGE_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-t-md px-3 py-2 text-sm font-medium ${
              tab === t.key ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
            {(draft[t.key as keyof LanguageConfig] || "").toString().trim() ? (
              <span className="ml-1.5 text-emerald-500"></span>
            ) : (
              <span className="ml-1.5 text-slate-300"></span>
            )}
          </button>
        ))}
        <button
          onClick={() => setTab("voice")}
          className={`rounded-t-md px-3 py-2 text-sm font-medium ${
            tab === "voice" ? "border-b-2 border-indigo-600 text-indigo-700" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          Voice &amp; Codes
        </button>
      </div>

      {LANGUAGE_TABS.filter((t) => t.key === tab).map((t) => (
        <div key={t.key}>
          <p className="mb-2 text-xs text-slate-400">{t.hint}</p>
          <textarea
            value={(draft[t.key as keyof LanguageConfig] as string) ?? ""}
            onChange={(e) => set(t.key as keyof LanguageConfig, e.target.value)}
            rows={14}
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            placeholder={`No ${t.label.toLowerCase()} set for this language yet.`}
          />
        </div>
      ))}

      {tab === "voice" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {VOICE_FIELDS.map((f) => (
            <label key={f.key} className="block text-xs font-medium text-slate-600">
              {f.label}
              <input
                value={(draft[f.key as keyof LanguageConfig] as string) ?? ""}
                onChange={(e) => set(f.key as keyof LanguageConfig, e.target.value)}
                placeholder={f.placeholder}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => onSave(draft)}
          disabled={!dirty}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
        >
          Save language
        </button>
        {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
      </div>
    </div>
  );
}

/** Every use case × language voice ID in one editable grid.
 *  The per-language editor above covers one cell at a time; this is for reviewing and
 *  updating them all together, e.g. after switching voice provider. */
function VoiceMatrixCard({
  template,
  save,
  labelFor,
}: {
  template: Template;
  save: (payload: Partial<Template>) => void;
  labelFor: (k: string) => string;
}) {
  const dialog = useDialog();
  const useCases = template.use_cases ?? {};
  const useCaseKeys = Object.keys(useCases);
  const languageKeys = Array.from(
    new Set(useCaseKeys.flatMap((uc) => Object.keys(useCases[uc]?.languages ?? {}))),
  );

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const cellKey = (uc: string, lang: string) => `${uc}::${lang}`;

  const valueOf = (uc: string, lang: string) => {
    const k = cellKey(uc, lang);
    if (k in drafts) return drafts[k];
    return useCases[uc]?.languages?.[lang]?.tts_voice_id ?? "";
  };

  const dirty = Object.keys(drafts).length > 0;

  const saveAll = () => {
    const next = JSON.parse(JSON.stringify(useCases)) as Record<string, UseCase>;
    for (const [k, v] of Object.entries(drafts)) {
      const [uc, lang] = k.split("::");
      if (next[uc]?.languages?.[lang]) next[uc].languages[lang].tts_voice_id = v;
    }
    save({ use_cases: next });
    setDrafts({});
  };

  const applyToRow = async (uc: string) => {
    const source = await dialog.prompt(
      `Set one voice ID for every language in "${useCases[uc]?.label || uc}"`,
      { placeholder: "Cartesia voice ID" },
    );
    if (source === null) return;
    const next = { ...drafts };
    for (const lang of Object.keys(useCases[uc]?.languages ?? {})) next[cellKey(uc, lang)] = source.trim();
    setDrafts(next);
  };

  if (useCaseKeys.length === 0 || languageKeys.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Voices by use case &amp; language</h3>
          <p className="text-xs text-slate-400">
            Every voice ID in one place. Blank cells fall back to the default voice in Settings.
          </p>
        </div>
        {dirty && (
          <button
            onClick={saveAll}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Save {Object.keys(drafts).length} change(s)
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
            <tr>
              <th className="px-4 py-2">Use case</th>
              {languageKeys.map((lang) => (
                <th key={lang} className="px-3 py-2 font-medium">
                  {labelFor(lang)}
                </th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {useCaseKeys.map((uc) => (
              <tr key={uc} className="border-t border-slate-100">
                <td className="whitespace-nowrap px-4 py-2 font-medium text-slate-800">
                  {useCases[uc]?.label || uc}
                </td>
                {languageKeys.map((lang) => {
                  const exists = !!useCases[uc]?.languages?.[lang];
                  return (
                    <td key={lang} className="px-3 py-2">
                      {exists ? (
                        <input
                          value={valueOf(uc, lang)}
                          onChange={(e) =>
                            setDrafts({ ...drafts, [cellKey(uc, lang)]: e.target.value })
                          }
                          placeholder="default"
                          className={`w-40 rounded-md border px-2 py-1 font-mono text-xs ${
                            cellKey(uc, lang) in drafts
                              ? "border-amber-300 bg-amber-50"
                              : "border-slate-200"
                          }`}
                        />
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="px-3 py-2">
                  <button
                    onClick={() => applyToRow(uc)}
                    title="Use one voice for every language in this use case"
                    className="whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50"
                  >
                    Set all
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LanguageRoutingCard({
  template,
  save,
  languageKeys,
}: {
  template: Template;
  save: (payload: Partial<Template>) => void;
  languageKeys: string[];
}) {
  const dialog = useDialog();
  const [column, setColumn] = useState(template.language_column ?? "");
  const { data: datasheets } = useQuery({ queryKey: ["datasheets"], queryFn: listDatasheets });

  useEffect(() => setColumn(template.language_column ?? ""), [template.language_column]);

  const columns = useMemo(() => {
    const s = new Set<string>();
    for (const d of datasheets ?? []) for (const c of d.columns ?? []) s.add(c);
    return Array.from(s).sort();
  }, [datasheets]);

  const mapping = template.language_column_mapping ?? {};

  const addMapping = async () => {
    const value = (await dialog.prompt("Column value in the datasheet", {
      placeholder: "TAMIL",
    }))?.trim().toUpperCase();
    if (!value) return;
    save({ language_column_mapping: { ...mapping, [value]: languageKeys[0] ?? "hindi" } });
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Automatic language routing</h3>
      <p className="mt-1 text-xs text-slate-400">
        Used only when a campaign is launched with language = <strong>Auto</strong>. Each row's
        language is read from this datasheet column. When you launch with a specific language
        instead, this is ignored and the whole campaign runs in that one language.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600">
          Language column
          <div className="mt-1 flex gap-2">
            <input
              list="ds-columns"
              value={column}
              onChange={(e) => setColumn(e.target.value)}
              placeholder="PREF_LANG"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <datalist id="ds-columns">
              {columns.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button
              onClick={() => save({ language_column: column })}
              className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-700"
            >
              Save
            </button>
          </div>
        </label>

        <label className="block text-xs font-medium text-slate-600">
          Fallback language
          <select
            value={template.default_language ?? ""}
            onChange={(e) => save({ default_language: e.target.value })}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {languageKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-700">Column value language</h4>
          <button onClick={addMapping} className="text-xs font-medium text-slate-600 hover:underline">
            Add mapping
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {Object.entries(mapping).map(([value, lang]) => (
            <div key={value} className="flex items-center gap-2">
              <span className="w-1/2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm">
                {value}
              </span>
              <select
                value={lang}
                onChange={(e) => save({ language_column_mapping: { ...mapping, [value]: e.target.value } })}
                className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              >
                {languageKeys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const next = { ...mapping };
                  delete next[value];
                  save({ language_column_mapping: next });
                }}
                className="rounded-md border border-slate-200 px-2 text-xs text-slate-400 hover:bg-slate-50 hover:text-red-500"
              >
                
              </button>
            </div>
          ))}
          {Object.keys(mapping).length === 0 && (
            <p className="text-xs text-slate-400">
              No mappings yet — rows fall back to the language above.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function Templates() {
  const dialog = useDialog();
  const { template, isLoading, saveMutation, loadError } = useSingleTemplate();
  const { data: supported } = useQuery({ queryKey: ["languages"], queryFn: listSupportedLanguages });

  const [useCaseKey, setUseCaseKey] = useState<string>("");
  const [languageKey, setLanguageKey] = useState<string>("");

  const useCases = template?.use_cases ?? {};
  const useCaseKeys = Object.keys(useCases);

  useEffect(() => {
    if (!useCaseKey && useCaseKeys.length) setUseCaseKey(template?.default_use_case || useCaseKeys[0]);
  }, [useCaseKeys.join(","), template?.default_use_case]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeUseCase: UseCase | undefined = useCases[useCaseKey];
  const languageKeys = Object.keys(activeUseCase?.languages ?? {});

  useEffect(() => {
    if (languageKeys.length && !languageKeys.includes(languageKey)) {
      setLanguageKey(template?.default_language && languageKeys.includes(template.default_language)
        ? template.default_language
        : languageKeys[0]);
    }
  }, [languageKeys.join(","), useCaseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (payload: Partial<Template>) => saveMutation.mutate(payload);

  const writeUseCases = (next: Record<string, UseCase>) => save({ use_cases: next });

  const addUseCase = async () => {
    const label = (await dialog.prompt("New use case name", {
      placeholder: "Sales Bot",
    }))?.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (!key || useCases[key]) return;
    // Seed with the same language set as the current use case so the matrix stays square.
    const seedLanguages: Record<string, LanguageConfig> = {};
    for (const lang of languageKeys.length ? languageKeys : ["hindi"]) seedLanguages[lang] = {};
    writeUseCases({ ...useCases, [key]: { label, languages: seedLanguages } });
    setUseCaseKey(key);
  };

  const deleteUseCase = async (key: string) => {
    const ok = await dialog.confirm(`Delete use case "${useCases[key]?.label || key}"?`, {
      body: "Every language configured under it goes too.",
      danger: true,
    });
    if (!ok) return;
    const next = { ...useCases };
    delete next[key];
    writeUseCases(next);
    setUseCaseKey(Object.keys(next)[0] ?? "");
  };

  const addLanguage = (langKey: string) => {
    if (!activeUseCase || !langKey || activeUseCase.languages[langKey]) return;
    const meta = supported?.find((l) => l.key === langKey);
    writeUseCases({
      ...useCases,
      [useCaseKey]: {
        ...activeUseCase,
        languages: {
          ...activeUseCase.languages,
          [langKey]: { stt_lan_code: meta?.stt ?? "", tts_lan_code: meta?.tts ?? "", tts_model_id: "sonic-3" },
        },
      },
    });
    setLanguageKey(langKey);
  };

  const removeLanguage = async (langKey: string) => {
    if (!activeUseCase) return;
    if (!(await dialog.confirm(`Remove "${langKey}" from this use case?`, { danger: true }))) return;
    const languages = { ...activeUseCase.languages };
    delete languages[langKey];
    writeUseCases({ ...useCases, [useCaseKey]: { ...activeUseCase, languages } });
  };

  const saveLanguage = (cfg: LanguageConfig) => {
    if (!activeUseCase) return;
    writeUseCases({
      ...useCases,
      [useCaseKey]: {
        ...activeUseCase,
        languages: { ...activeUseCase.languages, [languageKey]: cfg },
      },
    });
  };

  const unusedLanguages = (supported ?? []).filter((l) => !languageKeys.includes(l.key));
  const labelFor = (k: string) => supported?.find((l) => l.key === k)?.label ?? k;
  const isFilled = (k: string) => (activeUseCase?.languages[k]?.prompt || "").trim().length > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each <strong>use case</strong> holds one prompt/greeting/analysis set per{" "}
          <strong>language</strong>. Launch a campaign in a single language, or set it to Auto to
          pick each row's language from the datasheet.
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      {/* Without this the page rendered an empty shell whenever the request failed,
          which looks identical to "no data" and hides the real cause. */}
      {!isLoading && loadError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 shadow-sm">
          <p className="text-sm font-semibold text-red-800">Could not load templates</p>
          <p className="mt-1 text-sm text-red-700">{loadError.message}</p>
          <p className="mt-2 text-xs text-red-600">
            API: {getApiUrl()} - check that this is the address you expect, then reload.
          </p>
        </div>
      )}

      {!isLoading && !loadError && !template && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <p className="text-sm text-amber-800">
            The server returned no template. API: {getApiUrl()}
          </p>
        </div>
      )}

      {template && useCaseKeys.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm text-slate-500">No use cases yet.</p>
          <button
            onClick={addUseCase}
            className="mt-3 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            + Create Use Case
          </button>
        </div>
      )}

      {template && useCaseKeys.length > 0 && (
        <>
          {/* Use case selector */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Use Cases</h2>
              <button
                onClick={addUseCase}
                className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
              >
                Add Use Case
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {useCaseKeys.map((k) => {
                const active = k === useCaseKey;
                const langCount = Object.keys(useCases[k]?.languages ?? {}).length;
                return (
                  <button
                    key={k}
                    onClick={() => setUseCaseKey(k)}
                    className={`group flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition ${
                      active
                        ? "border-slate-900 bg-indigo-600 text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                    }`}
                  >
                    {useCases[k]?.label || k}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/20" : "bg-slate-100 text-slate-500"}`}>
                      {langCount} lang
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteUseCase(k);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          deleteUseCase(k);
                        }
                      }}
                      className={`opacity-0 transition group-hover:opacity-100 ${active ? "text-white/70 hover:text-white" : "text-slate-400 hover:text-red-500"}`}
                    >
                      
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Language matrix + editor */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
              <h3 className="text-sm font-semibold text-slate-900">Languages</h3>
              <p className="mt-1 text-xs text-slate-400">
                <span className="text-emerald-500"></span> has a prompt ·{" "}
                <span className="text-slate-300"></span> empty
              </p>
              <div className="mt-3 space-y-1.5">
                {languageKeys.map((k) => (
                  <div key={k} className="flex items-center gap-1">
                    <button
                      onClick={() => setLanguageKey(k)}
                      className={`flex flex-1 items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition ${
                        k === languageKey
                          ? "border-indigo-500 bg-indigo-50 font-medium text-slate-900"
                          : "border-slate-100 text-slate-600 hover:border-slate-200"
                      }`}
                    >
                      <span>{labelFor(k)}</span>
                      <span className={isFilled(k) ? "text-emerald-500" : "text-slate-300"}>
                        {isFilled(k) ? "" : ""}
                      </span>
                    </button>
                    <button
                      onClick={() => removeLanguage(k)}
                      className="px-1 text-slate-300 hover:text-red-500"
                      title="Remove language"
                    >
                      
                    </button>
                  </div>
                ))}
              </div>
              {unusedLanguages.length > 0 && (
                <select
                  value=""
                  onChange={(e) => addLanguage(e.target.value)}
                  className="mt-3 w-full rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  <option value="">Add language...</option>
                  {unusedLanguages.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-3">
              {languageKey && activeUseCase?.languages[languageKey] !== undefined ? (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900">
                      {useCases[useCaseKey]?.label || useCaseKey}
                    </h3>
                    <span className="text-slate-300">/</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      {labelFor(languageKey)}
                    </span>
                  </div>
                  <LanguageEditor
                    key={`${useCaseKey}:${languageKey}`}
                    config={activeUseCase.languages[languageKey]}
                    onSave={saveLanguage}
                  />
                </>
              ) : (
                <p className="text-sm text-slate-400">Add a language to start editing.</p>
              )}
            </div>
          </div>

          <VoiceMatrixCard template={template} save={save} labelFor={labelFor} />

          <LanguageRoutingCard template={template} save={save} languageKeys={languageKeys} />
        </>
      )}
    </div>
  );
}
