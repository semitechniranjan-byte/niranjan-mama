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

export const listSessions = () =>
  api.get<{ sessions: Session[] }>("/sessions").then((r) => r.data.sessions);
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
