import { api, getApiKey } from "./client";
import type {
  Agent,
  AgentsResponse,
  AnalyzeJob,
  AppConfig,
  AppSettings,
  AppSettingsResponse,
  BackgroundJob,
  ProvidersResponse,
  SupportedLanguage,
  Campaign,
  ConversationMessage,
  Datasheet,
  DatasheetRow,
  DatasheetTemplate,
  Disposition,
  HealthStatus,
  MappingKeyCategories,
  QueueCall,
  Session,
  Template,
} from "./types";

// These endpoints take the key as a query parameter rather than a header. Reuse the
// key the user signed in with instead of a second hardcoded one — a constant compiled
// into the bundle is readable by anyone who opens devtools, so it was never a secret.
const analyzeKey = () => getApiKey();

export const getHealth = () => api.get<HealthStatus>("/health").then((r) => r.data);
export const getConfig = () => api.get<AppConfig>("/config").then((r) => r.data);
export const getLogs = () =>
  api.get<string>("/logs", { responseType: "text" }).then((r) => r.data);

export type SessionPage = { sessions: Session[]; total: number; limit: number; skip: number };

/**
 * One page of sessions. The unpaged version pulled the entire collection into the
 * browser, which stops being viable well before a client's real call volume.
 */
export const listSessionPage = (params: {
  limit?: number;
  skip?: number;
  status?: string;
  direction?: string;
  search?: string;
}) => api.get<SessionPage>("/sessions", { params }).then((r) => r.data);

/** Small recent slice, for dashboard summaries that do not need the whole history. */
export const listSessions = () =>
  api.get<SessionPage>("/sessions", { params: { limit: 200 } }).then((r) => r.data.sessions);
export const getSession = (id: string) =>
  api.get<{ session: Session }>(`/sessions/${id}`).then((r) => r.data.session);
export const getSessionMessages = (id: string) =>
  api
    .get<{ messages: ConversationMessage[] }>(`/sessions/${id}/messages`)
    .then((r) => r.data.messages);
export const updateSessionConfig = (
  id: string,
  payload: {
    system_prompt?: string;
    format_values?: Record<string, unknown>;
    dynamic_fields?: Record<string, unknown>;
  },
) => api.post(`/sessions/${id}/config`, payload).then((r) => r.data);
export const sendSessionMessage = (id: string, user_text: string) =>
  api
    .post(`/sessions/${id}/message`, { session_id: id, user_text })
    .then((r) => r.data as { response_text: string });
export const endSession = (id: string) => api.post(`/sessions/${id}/end`).then((r) => r.data);

export interface CallPayload {
  to_number: string;
  from_number?: string;
  system_prompt?: string;
  greeting_text?: string;
  /** Resolve the script server-side from the template, like a campaign row does. */
  use_case?: string;
  language?: string;
  template_id?: string;
  format_values?: Record<string, string>;
}

export const createOutboundCall = (payload: CallPayload) =>
  api.post("/calls/outbound", payload).then((r) => r.data);
export const queueCall = (payload: CallPayload) =>
  api.post("/calls/queue", payload).then((r) => r.data);
export const listQueueCalls = () =>
  api.get<{ queue: QueueCall[] }>("/calls/queue").then((r) => r.data.queue);
export const processNextQueueCall = () =>
  api.post("/calls/queue/process").then((r) => r.data);

export const startAnalyzeJob = (execution_id: string, parallel_count: number) =>
  api
    .post(
      "/analyze-sessions/start",
      {},
      { params: { execution_id, parallel_count, api_key: analyzeKey() } },
    )
    .then((r) => r.data);
export const listAnalyzeJobs = () =>
  api
    .get<{ total_jobs: number; jobs: AnalyzeJob[] }>("/analyze-sessions/jobs", {
      params: { api_key: analyzeKey() },
    })
    .then((r) => r.data.jobs);
export const getAnalyzeJobStatus = (job_id: string) =>
  api
    .get("/analyze-sessions/status", { params: { job_id, api_key: analyzeKey() } })
    .then((r) => r.data);

export const listBackgroundJobs = () =>
  api
    .get<{ jobs: BackgroundJob[] }>("/datasheet-update/jobs")
    .then((r) => r.data.jobs);

export type TemplatePayload = Omit<Template, "_id" | "created_at" | "updated_at">;

export const listTemplates = () =>
  api.get<{ templates: Template[] }>("/templates").then((r) => r.data.templates);
export interface InspectedColumn {
  column: string;
  /** The column name in the shape a prompt would use it: "Customer Name" -> CUSTOMER_NAME. */
  placeholder: string;
  example: string;
  filled: number;
  coverage: number;
  looks_like_phone: boolean;
}

/** Read a sheet's header row without importing it. */
export const inspectDatasheetFile = (file: File) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .post<{
      filename: string;
      rows: number;
      columns: InspectedColumn[];
      phone_column: string | null;
    }>("/datasheets/inspect", form)
    .then((r) => r.data);
};

export interface DiscoveredKey {
  key: string;
  calls: number;
  /** Share of sampled calls that actually carry this key. */
  coverage: number;
  listed: boolean;
}

export interface DiscoveredCategory {
  category: string;
  keys: DiscoveredKey[];
  new: string[];
  listed_but_unseen: string[];
}

/** What keys real calls carry, next to what the catalog claims. */
export const discoverMappingKeys = (sample = 200) =>
  api
    .get<{ sampled: number; categories: DiscoveredCategory[] }>("/mapping-keys/discover", {
      params: { sample },
    })
    .then((r) => r.data);

/** Add every key the sampled calls carry; leaves everything already listed alone. */
export const adoptMappingKeys = (sample = 200) =>
  api
    .post<{ added: Record<string, string[]>; sampled: number }>(
      "/mapping-keys/adopt",
      null,
      { params: { sample } },
    )
    .then((r) => r.data);

/** Who the stored key belongs to, and what that role may open right now. */
export const getMe = () =>
  api.get<{ role: "admin" | "user"; email: string; pages: string[] }>("/auth/me").then((r) => r.data);

export interface AnalyticsSummary {
  total: number;
  scored: number;
  promises: number;
  promise_rate: number;
  by_disposition: { code: string; count: number }[];
  by_day: { date: string; calls: number; promises: number }[];
  by_language: { language: string; count: number }[];
}

export type ReportFilters = {
  date_from?: string;
  date_to?: string;
  disposition?: string;
  direction?: string;
  search?: string;
  /** One campaign: every call it placed carries its execution. */
  execution_id?: string;
  /** A single call. */
  session_id?: string;
};

export const getAnalyticsSummary = (params: { date_from?: string; date_to?: string }) =>
  api.get<AnalyticsSummary>("/analytics/summary", { params }).then((r) => r.data);

/**
 * Pull the report as a blob and hand it to the browser.
 *
 * A plain link would skip the API key the interceptor adds, and would give no way to
 * report a failure - the user would just get an empty file.
 */
export async function downloadCallsCsv(filters: ReportFilters): Promise<number> {
  const response = await api.get("/reports/calls.csv", {
    params: filters,
    responseType: "blob",
  });
  const blob = response.data as Blob;
  const disposition = String(response.headers["content-disposition"] || "");
  const named = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = named?.[1] || "qsilon-calls.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return blob.size;
}

/** The {PLACEHOLDER} names a chosen script uses, so a form can offer a box for each. */
export const getTemplatePlaceholders = (params: {
  template_id?: string;
  use_case?: string;
  language?: string;
}) =>
  api
    .get<{ placeholders: string[]; use_case?: string; language?: string }>(
      "/template-placeholders",
      { params },
    )
    .then((r) => r.data);
export const getTemplate = (id: string) =>
  api.get<{ template: Template }>(`/templates/${id}`).then((r) => r.data.template);
export const createTemplate = (payload: TemplatePayload) =>
  api.post<{ template_id: string }>("/templates", payload).then((r) => r.data);
export const updateTemplate = (id: string, payload: Partial<TemplatePayload>) =>
  api.put<{ template: Template }>(`/templates/${id}`, payload).then((r) => r.data.template);
export const deleteTemplate = (id: string) =>
  api.delete(`/templates/${id}`).then((r) => r.data);

export const uploadDatasheet = (name: string, datasheetTemplateId: string, file: File) => {
  const form = new FormData();
  form.append("name", name);
  form.append("datasheet_template_id", datasheetTemplateId);
  form.append("file", file);
  return api
    .post<{ datasheet_id: string; row_count: number; columns: string[] }>("/datasheets/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    })
    .then((r) => r.data);
};
export const listDatasheets = () =>
  api.get<{ datasheets: Datasheet[] }>("/datasheets").then((r) => r.data.datasheets);
export const getDatasheet = (id: string) =>
  api.get<{ datasheet: Datasheet }>(`/datasheets/${id}`).then((r) => r.data.datasheet);
export const deleteDatasheet = (id: string) =>
  api.delete(`/datasheets/${id}`).then((r) => r.data);
export const renameDatasheet = (id: string, name: string) =>
  api.put<{ datasheet: Datasheet }>(`/datasheets/${id}`, { name }).then((r) => r.data.datasheet);

export type DatasheetTemplatePayload = Omit<DatasheetTemplate, "_id" | "created_at" | "updated_at">;

export const listDatasheetTemplates = () =>
  api
    .get<{ datasheet_templates: DatasheetTemplate[] }>("/datasheet-templates")
    .then((r) => r.data.datasheet_templates);
export const getDatasheetTemplate = (id: string) =>
  api
    .get<{ datasheet_template: DatasheetTemplate }>(`/datasheet-templates/${id}`)
    .then((r) => r.data.datasheet_template);
export const createDatasheetTemplate = (payload: DatasheetTemplatePayload) =>
  api.post<{ datasheet_template_id: string }>("/datasheet-templates", payload).then((r) => r.data);
export const updateDatasheetTemplate = (id: string, payload: Partial<DatasheetTemplatePayload>) =>
  api
    .put<{ datasheet_template: DatasheetTemplate }>(`/datasheet-templates/${id}`, payload)
    .then((r) => r.data.datasheet_template);
export const deleteDatasheetTemplate = (id: string) =>
  api.delete(`/datasheet-templates/${id}`).then((r) => r.data);

export const getDispositions = () =>
  api.get<{ dispositions: Disposition[] }>("/dispositions").then((r) => r.data.dispositions);
export const setDispositions = (data: Disposition[]) =>
  api.put<{ dispositions: Disposition[] }>("/dispositions", { data }).then((r) => r.data.dispositions);

export const listProviders = () =>
  api.get<{ capabilities: ProvidersResponse }>("/providers").then((r) => r.data.capabilities);

export const listAgents = () => api.get<AgentsResponse>("/agents").then((r) => r.data);
export const createAgent = (payload: {
  name: string;
  description?: string;
  max_concurrent_calls: number;
  max_call_seconds: number;
}) => api.post<{ agent_id: string }>("/agents", payload).then((r) => r.data);
export const updateAgent = (id: string, payload: Partial<Agent>) =>
  api.put<{ agent: Agent }>(`/agents/${id}`, payload).then((r) => r.data.agent);
export const deleteAgent = (id: string) => api.delete(`/agents/${id}`).then((r) => r.data);

export const getAppSettings = () =>
  api.get<AppSettingsResponse>("/settings").then((r) => r.data);
export const updateAppSettings = (payload: AppSettings) =>
  api.put<AppSettingsResponse>("/settings", payload).then((r) => r.data);
export const listSupportedLanguages = () =>
  api.get<{ languages: SupportedLanguage[] }>("/languages").then((r) => r.data.languages);

export const getMappingKeys = () =>
  api.get<{ categories: MappingKeyCategories }>("/mapping-keys").then((r) => r.data.categories);
export const setMappingKeys = (categories: MappingKeyCategories) =>
  api
    .put<{ categories: MappingKeyCategories }>("/mapping-keys", { categories })
    .then((r) => r.data.categories);

export const createCampaign = (payload: {
  name: string;
  mode: string;
  datasheet_id: string;
  prompt_template_id: string;
  template_variant?: string;
  use_case?: string;
  language?: string;
  agent_id?: string;
  agent_ids?: string[];
}) => api.post<{ campaign_id: string }>("/campaigns", payload).then((r) => r.data);
export const launchCampaign = (id: string) =>
  api.post(`/campaigns/${id}/launch`).then((r) => r.data);
export const listCampaigns = () =>
  api.get<{ campaigns: Campaign[] }>("/campaigns").then((r) => r.data.campaigns);
export const getCampaign = (id: string) =>
  api
    .get<{ campaign: Campaign; rows: DatasheetRow[] }>(`/campaigns/${id}`)
    .then((r) => r.data);
