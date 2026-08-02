import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createDatasheetTemplate,
  deleteDatasheet,
  deleteDatasheetTemplate,
  getDatasheet,
  getMappingKeys,
  listDatasheetTemplates,
  listDatasheets,
  renameDatasheet,
  setMappingKeys,
  updateDatasheetTemplate,
  uploadDatasheet,
} from "../api/endpoints";
import type { Datasheet, DatasheetTemplate, MappingKeyCategories } from "../api/types";
import { IconX } from "../components/Icons";

const DEFAULT_MAPPING_KEY_CATEGORIES: MappingKeyCategories = {
  model_data: [
    "language_detected",
    "disposition_code",
    "ptp_date",
    "promise_reminder_flag",
    "promise_reminder_method",
    "ptp_days",
    "ptp_flag",
    "paid_flag",
    "status_reason_code",
    "voicemail_detected",
    "ptp_time",
  ],
  call_info: [
    "Duration",
    "Language",
    "language",
    "AnswerTime",
    "StartTime",
    "CallStartTime",
    "CallStatus",
    "call_status",
    "Disposition",
    "disposition",
    "EndTime",
    "CallEndTime",
    "EndTimeUtc",
    "CallDuration",
    "BillDuration",
  ],
  root: [
    "created_at",
    "call_status",
    "attempt_count",
    "session_id",
    "execution_id",
    "phone_number",
    "call_uuid",
    "recording_url",
    "recording_id",
  ],
};

function pathsFromCategories(categories: MappingKeyCategories): string[] {
  const paths: string[] = [];
  for (const [category, keys] of Object.entries(categories)) {
    for (const key of keys) {
      paths.push(category === "root" ? key : `${category}.${key}`);
    }
  }
  return paths.sort();
}

function useMappingKeys() {
  const queryClient = useQueryClient();
  const { data: categories, isLoading } = useQuery({
    queryKey: ["mapping-keys"],
    queryFn: getMappingKeys,
  });

  const saveMutation = useMutation({
    mutationFn: (next: MappingKeyCategories) => setMappingKeys(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mapping-keys"] }),
  });

  useEffect(() => {
    if (categories && Object.keys(categories).length === 0 && !saveMutation.isPending) {
      saveMutation.mutate(DEFAULT_MAPPING_KEY_CATEGORIES);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  return { categories: categories ?? {}, isLoading, save: saveMutation.mutate };
}

function useDatasheetTemplates() {
  const queryClient = useQueryClient();
  const { data: templates, isLoading } = useQuery({
    queryKey: ["datasheet-templates"],
    queryFn: listDatasheetTemplates,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["datasheet-templates"] });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; required_columns: string[]; update_columns_mapping: Record<string, string> }) =>
      createDatasheetTemplate(payload),
    onSuccess: invalidate,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<DatasheetTemplate> }) =>
      updateDatasheetTemplate(id, payload),
    onSuccess: invalidate,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDatasheetTemplate(id),
    onSuccess: invalidate,
  });

  return {
    templates: templates ?? [],
    isLoading,
    createMutation,
    updateMutation,
    deleteMutation,
  };
}

function CardHeader({
  icon,
  accent,
  title,
  action,
}: {
  icon: string;
  accent: string;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg text-base ${accent}`}
        >
          {icon}
        </span>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      </div>
      {action}
    </div>
  );
}

function RequiredColumnsCard({
  template,
  save,
}: {
  template: DatasheetTemplate;
  save: (payload: Partial<DatasheetTemplate>) => void;
}) {
  const addColumn = () => {
    const name = window.prompt("New required column name")?.trim();
    if (!name || template.required_columns.includes(name)) return;
    save({ required_columns: [...template.required_columns, name] });
  };
  const removeColumn = (col: string) => {
    save({ required_columns: template.required_columns.filter((c) => c !== col) });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <CardHeader
        icon=""
        accent="bg-blue-50 text-blue-600"
        title="Required Columns"
        action={
          <button
            onClick={addColumn}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Add Column
          </button>
        }
      />
      <div className="space-y-2 p-3">
        {template.required_columns.map((col) => (
          <div
            key={col}
            className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-2 transition hover:border-blue-200 hover:bg-blue-50/50"
          >
            <span className="text-sm font-medium text-slate-800">{col}</span>
            <button
              onClick={() => removeColumn(col)}
              className="text-red-400 hover:text-red-600"
              title="Remove"
            >
              
            </button>
          </div>
        ))}
        {template.required_columns.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">No required columns yet.</p>
        )}
      </div>
    </div>
  );
}

function AddMappingModal({
  availablePaths,
  initialOutputCol,
  initialPath,
  onSave,
  onClose,
}: {
  availablePaths: string[];
  initialOutputCol?: string;
  initialPath?: string;
  onSave: (outputCol: string, path: string) => void;
  onClose: () => void;
}) {
  const [outputCol, setOutputCol] = useState(initialOutputCol ?? "");
  const [selected, setSelected] = useState<string[]>(
    initialPath
      ? initialPath
          .split("|")
          .map((p) => p.trim())
          .filter(Boolean)
      : [],
  );
  const [search, setSearch] = useState("");
  const filtered = availablePaths.filter(
    (p) => p.toLowerCase().includes(search.trim().toLowerCase()) && !selected.includes(p),
  );

  const addPath = (p: string) => {
    const trimmed = p.trim();
    if (!trimmed || selected.includes(trimmed)) return;
    setSelected([...selected, trimmed]);
    setSearch("");
  };
  const removePath = (p: string) => setSelected(selected.filter((s) => s !== p));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            {initialOutputCol ? "Edit Mapping" : "Add Mapping"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <IconX size={16} />
          </button>
        </div>

        <label className="mt-3 block text-xs font-medium text-slate-600">
          Output column name (e.g. DISPOSITION)
          <input
            value={outputCol}
            onChange={(e) => setOutputCol(e.target.value.toUpperCase())}
            disabled={!!initialOutputCol}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
          />
        </label>

        <div className="mt-3 text-xs font-medium text-slate-600">
          Session field(s) to write back — first match wins, add more as fallbacks
        </div>
        {selected.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {selected.map((p, idx) => (
              <span
                key={p}
                className="flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-xs font-mono text-indigo-700"
              >
                {idx > 0 && <span className="text-violet-300"></span>}
                {p}
                <button onClick={() => removePath(p)} className="text-slate-400 hover:text-red-500">
                  
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative mt-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPath(search);
              }
            }}
            placeholder="Search a field, or type a custom path and press Enter..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            
          </span>
        </div>
        <div className="mt-2 max-h-40 overflow-y-auto rounded-md border border-slate-100">
          {filtered.map((p) => (
            <button
              key={p}
              onClick={() => addPath(p)}
              className="block w-full px-3 py-2 text-left font-mono text-xs text-slate-700 hover:bg-slate-50"
            >
              + {p}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              {availablePaths.length === 0
                ? "No mapping keys configured yet — add some in the Mapping Keys tab."
                : "No matching fields — you can still type a custom path and press Enter."}
            </p>
          )}
        </div>

        <button
          onClick={() => {
            if (outputCol.trim() && selected.length > 0) onSave(outputCol.trim(), selected.join("|"));
          }}
          disabled={!outputCol.trim() || selected.length === 0}
          className="mt-3 w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Save Mapping
        </button>
      </div>
    </div>
  );
}

function ColumnMappingsCard({
  template,
  save,
  availablePaths,
}: {
  template: DatasheetTemplate;
  save: (payload: Partial<DatasheetTemplate>) => void;
  availablePaths: string[];
}) {
  const attempt = template.attempt_columns ?? [];
  const [modalState, setModalState] = useState<{ mode: "add" } | { mode: "edit"; outputCol: string } | null>(
    null,
  );

  const saveMapping = (outputCol: string, path: string) => {
    save({ update_columns_mapping: { ...template.update_columns_mapping, [outputCol]: path } });
    setModalState(null);
  };
  const removeMapping = (outputCol: string) => {
    const next = { ...template.update_columns_mapping };
    delete next[outputCol];
    save({
      update_columns_mapping: next,
      attempt_columns: attempt.filter((c) => c !== outputCol),
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <CardHeader
        icon=""
        accent="bg-slate-50 text-indigo-600"
        title="Column Mappings"
        action={
          <button
            onClick={() => setModalState({ mode: "add" })}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            Add Mapping
          </button>
        }
      />
      <div className="space-y-2 p-3">
        {Object.entries(template.update_columns_mapping).map(([outputCol, path]) => (
          <div
            key={outputCol}
            className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 transition hover:border-violet-200 hover:bg-slate-50/50"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">{outputCol}</span>
                {attempt.includes(outputCol) && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    Attempt
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setModalState({ mode: "edit", outputCol })}
                  className="text-slate-400 hover:text-slate-700"
                  title="Edit"
                >
            <IconX size={16} />
          </button>
                <button onClick={() => removeMapping(outputCol)} className="text-red-400 hover:text-red-600" title="Delete">
                  
                </button>
              </div>
            </div>
            <div className="mt-0.5 font-mono text-xs text-slate-500">{path}</div>
          </div>
        ))}
        {Object.keys(template.update_columns_mapping).length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">No column mappings yet.</p>
        )}
      </div>

      {modalState && (
        <AddMappingModal
          availablePaths={availablePaths}
          initialOutputCol={modalState.mode === "edit" ? modalState.outputCol : undefined}
          initialPath={modalState.mode === "edit" ? template.update_columns_mapping[modalState.outputCol] : undefined}
          onSave={saveMapping}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  );
}

function AttemptColumnsCard({
  template,
  save,
}: {
  template: DatasheetTemplate;
  save: (payload: Partial<DatasheetTemplate>) => void;
}) {
  const attempt = template.attempt_columns ?? [];
  const mappingKeys = Object.keys(template.update_columns_mapping);

  const toggle = (col: string) => {
    if (attempt.includes(col)) {
      save({ attempt_columns: attempt.filter((c) => c !== col) });
    } else {
      save({ attempt_columns: [...attempt, col] });
    }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
      <CardHeader
        icon=""
        accent="bg-emerald-50 text-emerald-600"
        title="Attempt Columns"
        action={<span className="text-xs text-slate-400">Click to toggle</span>}
      />
      <div className="space-y-2 p-3">
        {mappingKeys.map((col) => {
          const on = attempt.includes(col);
          return (
            <button
              key={col}
              onClick={() => toggle(col)}
              className={`block w-full rounded-md border px-3 py-2 text-left text-sm font-medium transition ${
                on
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-100 bg-slate-50 text-slate-400 hover:border-slate-200"
              }`}
            >
              {col}
              <div className="mt-0.5 font-mono text-xs opacity-70">
                {template.update_columns_mapping[col]}
              </div>
            </button>
          );
        })}
        {mappingKeys.length === 0 && (
          <p className="px-1 py-2 text-xs text-slate-400">Add column mappings first.</p>
        )}
      </div>
    </div>
  );
}

type UploadedTemplateJson = {
  name?: string;
  required_columns?: string[];
  required_columns_mapping?: Record<string, string>;
  update_columns_mapping?: Record<string, string>;
  attempt_columns?: string[];
};

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}
function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v as Record<string, unknown>).every((x) => typeof x === "string")
  );
}

const EXPORT_KIND = "wordworks.datasheet_template";

function UploadJsonButton({ onImport }: { onImport: (payload: UploadedTemplateJson) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setSuccess(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Accept either the flat shape or the wrapped export shape (kind/version/template).
      const source = parsed.kind === EXPORT_KIND && parsed.template ? parsed.template : parsed;

      const payload: UploadedTemplateJson = {};
      if (typeof source.name === "string") payload.name = source.name;
      if (isStringArray(source.required_columns)) payload.required_columns = source.required_columns;
      if (isStringRecord(source.required_columns_mapping)) {
        payload.required_columns_mapping = source.required_columns_mapping;
      }
      if (isStringRecord(source.update_columns_mapping)) payload.update_columns_mapping = source.update_columns_mapping;
      if (isStringArray(source.attempt_columns)) payload.attempt_columns = source.attempt_columns;

      if (Object.keys(payload).length === 0) {
        setError(
          'No recognized fields found. Expected "required_columns" (array), "update_columns_mapping" (object), and/or "attempt_columns" (array) — either at the top level or under a "template" key.',
        );
        return;
      }
      onImport(payload);
      setSuccess(`Imported ${Object.keys(payload).join(", ")} from ${file.name}.`);
    } catch (e) {
      setError(e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON file.");
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
      >
        Upload JSON
      </button>
      {error && <p className="max-w-xs text-right text-xs text-red-600">{error}</p>}
      {success && <p className="max-w-xs text-right text-xs text-emerald-600">{success}</p>}
    </div>
  );
}

function downloadTemplateJson(template: DatasheetTemplate) {
  const payload = {
    kind: EXPORT_KIND,
    version: 1,
    exported_at: new Date().toISOString(),
    source: { template_id: template._id },
    template: {
      name: template.name,
      required_columns: template.required_columns,
      required_columns_mapping: template.required_columns_mapping ?? {},
      update_columns_mapping: template.update_columns_mapping,
      attempt_columns: template.attempt_columns ?? [],
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${template.name || "datasheet-template"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function DownloadJsonButton({ template }: { template: DatasheetTemplate }) {
  return (
    <button
      onClick={() => downloadTemplateJson(template)}
      className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
    >
      Download JSON
    </button>
  );
}

function CategoryCard({
  category,
  keys,
  onAddKey,
  onRemoveKey,
  onDeleteCategory,
}: {
  category: string;
  keys: string[];
  onAddKey: (category: string) => void;
  onRemoveKey: (category: string, key: string) => void;
  onDeleteCategory: (category: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 text-left"
        >
          <span className={`text-slate-400 transition-transform ${collapsed ? "-rotate-90" : ""}`}></span>
          <span className="text-sm font-semibold text-slate-900">{category}</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
            {keys.length} keys
          </span>
        </button>
        <button
          onClick={() => onDeleteCategory(category)}
          className="text-slate-400 hover:text-red-500"
          title="Delete category"
        >
          
        </button>
      </div>
      {!collapsed && (
        <div className="p-4">
          <div className="flex flex-wrap gap-2">
            {keys.map((k) => (
              <span
                key={k}
                className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
              >
                {k}
                <button onClick={() => onRemoveKey(category, k)} className="text-blue-400 hover:text-red-500">
                  
                </button>
              </span>
            ))}
            {keys.length === 0 && <p className="text-xs text-slate-400">No keys yet.</p>}
          </div>
          <button
            onClick={() => onAddKey(category)}
            className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Add Key
          </button>
        </div>
      )}
    </div>
  );
}

function MappingKeysTab() {
  const { categories, isLoading, save } = useMappingKeys();

  const addKey = (category: string) => {
    const key = window.prompt(`New key for "${category}"`)?.trim();
    if (!key || (categories[category] ?? []).includes(key)) return;
    save({ ...categories, [category]: [...(categories[category] ?? []), key] });
  };
  const removeKey = (category: string, key: string) => {
    save({ ...categories, [category]: (categories[category] ?? []).filter((k) => k !== key) });
  };
  const deleteCategory = (category: string) => {
    if (!window.confirm(`Delete category "${category}" and all its keys?`)) return;
    const next = { ...categories };
    delete next[category];
    save(next);
  };
  const createCategory = () => {
    const name = window.prompt("New category name (e.g. model_data, call_info)")?.trim();
    if (!name || categories[name]) return;
    save({ ...categories, [name]: [] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          These keys power the field picker when adding a Column Mapping, grouped by where they
          live in the session document. "root" keys map directly (e.g. <code>session_id</code>);
          other categories are dotted paths (e.g. <code>model_data.disposition_code</code>).
        </p>
        <button
          onClick={createCategory}
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create Category
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      <div className="space-y-4">
        {Object.entries(categories).map(([category, keys]) => (
          <CategoryCard
            key={category}
            category={category}
            keys={keys}
            onAddKey={addKey}
            onRemoveKey={removeKey}
            onDeleteCategory={deleteCategory}
          />
        ))}
        {!isLoading && Object.keys(categories).length === 0 && (
          <p className="text-sm text-slate-400">No categories yet.</p>
        )}
      </div>
    </div>
  );
}

function TemplatesTab({ availablePaths }: { availablePaths: string[] }) {
  const { templates, isLoading, createMutation, updateMutation, deleteMutation } = useDatasheetTemplates();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const editingTemplate = templates.find((t) => t._id === editingId) ?? null;

  const handleCreate = () => {
    const name = window.prompt("New template name")?.trim();
    if (!name) return;
    createMutation.mutate(
      { name, required_columns: [], update_columns_mapping: {} },
      { onSuccess: (data) => setEditingId(data.datasheet_template_id) },
    );
  };

  const handleDelete = (t: DatasheetTemplate) => {
    if (!window.confirm(`Delete template "${t.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate(t._id);
    if (editingId === t._id) setEditingId(null);
  };

  if (editingTemplate) {
    const save = (payload: Partial<DatasheetTemplate>) =>
      updateMutation.mutate({ id: editingTemplate._id, payload });

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setEditingId(null)} className="text-sm text-slate-500 hover:underline">
            Back to templates
          </button>
          <div className="flex gap-2">
            <DownloadJsonButton template={editingTemplate} />
            <UploadJsonButton onImport={(payload) => save(payload)} />
          </div>
        </div>
        <h2 className="text-lg font-semibold text-slate-900">{editingTemplate.name}</h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <RequiredColumnsCard template={editingTemplate} save={save} />
          <ColumnMappingsCard template={editingTemplate} save={save} availablePaths={availablePaths} />
          <AttemptColumnsCard template={editingTemplate} save={save} />
        </div>
      </div>
    );
  }

  const filtered = templates.filter((t) => t.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72 max-w-full">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="w-full rounded-md border border-slate-300 px-3 py-2 pr-8 text-sm"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400">
            
          </span>
        </div>
        <button
          onClick={handleCreate}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Create Template
        </button>
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
            <tr>
              <th className="px-4 py-2">Template Name</th>
              <th className="px-4 py-2">Required Columns</th>
              <th className="px-4 py-2">Mappings</th>
              <th className="px-4 py-2">Attempt Tracking</th>
              <th className="px-4 py-2">Created</th>
              <th className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <tr key={t._id} className="border-t border-slate-100">
                <td className="px-4 py-2 font-medium text-slate-900">{t.name}</td>
                <td className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {t.required_columns.slice(0, 3).map((c) => (
                      <span
                        key={c}
                        className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
                      >
                        {c}
                      </span>
                    ))}
                    {t.required_columns.length > 3 && (
                      <span className="text-xs text-slate-400">+{t.required_columns.length - 3} more</span>
                    )}
                    {t.required_columns.length === 0 && <span className="text-xs text-slate-400">-</span>}
                  </div>
                </td>
                <td className="px-4 py-2 text-emerald-600">
                  {Object.keys(t.update_columns_mapping ?? {}).length} configured
                </td>
                <td className="px-4 py-2 text-slate-600">{(t.attempt_columns ?? []).length} columns</td>
                <td className="px-4 py-2 text-slate-500">
                  {t.created_at ? new Date(t.created_at).toLocaleDateString() : "-"}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEditingId(t._id)} title="Edit" className="text-slate-400 hover:text-slate-700">
            <IconX size={16} />
          </button>
                    <button onClick={() => handleDelete(t)} title="Delete" className="text-slate-400 hover:text-red-500">
                      
                    </button>
                    <button
                      onClick={() => downloadTemplateJson(t)}
                      title="Download"
                      className="text-slate-400 hover:text-slate-700"
                    >
            <IconX size={16} />
          </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  {templates.length === 0 ? "No templates yet." : "No templates match your search."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DatasheetsSection({ templates }: { templates: DatasheetTemplate[] }) {
  const queryClient = useQueryClient();
  const { data: datasheets, isLoading } = useQuery({ queryKey: ["datasheets"], queryFn: listDatasheets });

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datasheetTemplateId, setDatasheetTemplateId] = useState("");

  const datasheetTemplateName = (id: string) => templates.find((t) => t._id === id)?.name || id;

  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const uploadMutation = useMutation({
    mutationFn: () => uploadDatasheet(name, datasheetTemplateId, file as File),
    onSuccess: () => {
      setName("");
      setFile(null);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["datasheets"] });
      setIsUploadOpen(false);
    },
    onError: (err: unknown) => {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Upload failed.";
      setError(detail);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDatasheet(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["datasheets"] }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name: newName }: { id: string; name: string }) => renameDatasheet(id, newName),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["datasheets"] }),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !datasheetTemplateId || !file) return;
    setError(null);
    uploadMutation.mutate();
  };

  const handleRename = (ds: Datasheet) => {
    const next = window.prompt("Rename datasheet", ds.name)?.trim();
    if (!next || next === ds.name) return;
    renameMutation.mutate({ id: ds._id, name: next });
  };

  const handleDownload = async (ds: Datasheet) => {
    const full = await getDatasheet(ds._id);
    const rows = full.rows ?? [];
    if (rows.length === 0) return;
    const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r.data ?? {}))));
    const header = [...cols, "STATUS", "DISPOSITION"];
    const lines = [header.join(",")];
    for (const row of rows) {
      const vals = cols.map((c) => JSON.stringify(String(row.data?.[c] ?? "")));
      vals.push(JSON.stringify(row.status));
      vals.push(JSON.stringify(row.disposition_code ?? ""));
      lines.push(vals.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ds.name}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Datasheets</h2>
        <button
          onClick={() => setIsUploadOpen(true)}
          className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
        >
          Upload Datasheet
        </button>
      </div>

      {isUploadOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setIsUploadOpen(false)}
        >
          <form
            onSubmit={handleSubmit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <CardHeader
              icon=""
              accent="bg-blue-50 text-blue-600"
              title="Upload a datasheet"
              action={
                <button
                  type="button"
                  onClick={() => setIsUploadOpen(false)}
                  className="text-slate-400 hover:text-slate-700"
                >
            <IconX size={16} />
          </button>
              }
            />
            <div className="space-y-4 p-4">
              <p className="text-xs text-slate-400">
                The file's columns must include all of the Required Columns from the selected
                template, or the upload will be rejected.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600">
                  Template
                  <select
                    value={datasheetTemplateId}
                    onChange={(e) => setDatasheetTemplateId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select a template...</option>
                    {templates.map((t) => (
                      <option key={t._id} value={t._id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-xs font-medium text-slate-600">
                  Datasheet name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="July leads batch 1"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div>
                <span className="block text-xs font-medium text-slate-600">CSV or Excel file</span>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`mt-1 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${
                    isDragging
                      ? "border-blue-400 bg-blue-50"
                      : file
                        ? "border-emerald-300 bg-emerald-50/50"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-100"
                  }`}
                >
                  <span className="text-2xl">{file ? "" : ""}</span>
                  {file ? (
                    <>
                      <span className="text-sm font-medium text-slate-800">{file.name}</span>
                      <span className="text-xs text-slate-400">
                        {(file.size / 1024).toFixed(1)} KB — click or drop to replace
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium text-slate-700">
                        Click to upload or drag and drop
                      </span>
                      <span className="text-xs text-slate-400">CSV, XLSX, or XLSM</span>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xlsm"
                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="hidden"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={uploadMutation.isPending || !name.trim() || !datasheetTemplateId || !file}
                className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {uploadMutation.isPending ? "Uploading..." : "Upload"}
              </button>
            </div>
          </form>
        </div>
      )}

      {isLoading && <p className="text-sm text-slate-500">Loading datasheets...</p>}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-wide text-indigo-700/70">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Template</th>
              <th className="px-4 py-2">Rows</th>
              <th className="px-4 py-2">Uploaded</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(datasheets ?? []).map((ds) => (
              <tr key={ds._id} className="border-t border-slate-100">
                <td className="px-4 py-2 text-slate-900">{ds.name}</td>
                <td className="px-4 py-2 text-slate-600">{datasheetTemplateName(ds.datasheet_template_id)}</td>
                <td className="px-4 py-2 text-slate-600">{ds.row_count}</td>
                <td className="px-4 py-2 text-slate-500">
                  {ds.created_at ? new Date(ds.created_at).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleRename(ds)}
                      disabled={renameMutation.isPending}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDownload(ds)}
                      className="rounded-md border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => deleteMutation.mutate(ds._id)}
                      disabled={deleteMutation.isPending}
                      className="rounded-md border border-red-200 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {(datasheets ?? []).length === 0 && !isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  No datasheets uploaded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const PAGE_TABS = ["Uploaded Datasheets", "Templates", "Mapping Keys"] as const;
type PageTab = (typeof PAGE_TABS)[number];

export function DatasheetTemplates() {
  const { templates, isLoading } = useDatasheetTemplates();
  const { categories: mappingKeyCategories } = useMappingKeys();
  const availablePaths = useMemo(() => pathsFromCategories(mappingKeyCategories), [mappingKeyCategories]);
  const [activeTab, setActiveTab] = useState<PageTab>("Uploaded Datasheets");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Datasheets</h1>
          <p className="mt-1 text-sm text-slate-500">
            Upload and manage datasheets, manage multiple templates (required columns / column
            mappings / attempt columns), and maintain the mapping-key catalog — all in one place.
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {PAGE_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`whitespace-nowrap rounded-t-md px-4 py-2 text-sm font-medium ${
              activeTab === tab
                ? "border-b-2 border-indigo-600 text-indigo-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-sm text-slate-500">Loading...</p>}

      {activeTab === "Uploaded Datasheets" && <DatasheetsSection templates={templates} />}

      {activeTab === "Templates" && <TemplatesTab availablePaths={availablePaths} />}

      {activeTab === "Mapping Keys" && <MappingKeysTab />}
    </div>
  );
}
