export interface HealthStatus {
  status: string;
  mongo_ready: boolean;
  tts_ready: boolean;
  stt_ready: boolean;
  llm_ready: boolean;
}

export interface AppConfig {
  mongo_ready: boolean;
  llm_ready: boolean;
  tts_ready: boolean;
  stt_ready: boolean;
  dynamic_fields: Record<string, unknown>;
}

export interface Session {
  _id?: string;
  session_id: string;
  phone_number?: string;
  from_number?: string;
  direction: string;
  created_at?: string;
  started_at?: string;
  last_activity_at?: string;
  ended_at?: string;
  status: string;
  active: boolean;
  system_prompt?: string | null;
  format_values?: Record<string, unknown>;
  dynamic_fields?: Record<string, unknown>;
  model_data?: Record<string, unknown>;
  reason?: string;
  recording_url?: string | null;
  campaign_id?: string;
}

export interface ConversationMessage {
  _id?: string;
  session_id: string;
  role: string;
  content: string;
  timestamp?: string;
}

export interface QueueCall {
  _id: string;
  status: string;
  created_at?: string;
  processed_at?: string;
  to_number?: string;
  from_number?: string | null;
  payload?: Record<string, unknown>;
}

export interface AnalyzeJob {
  job_id: string;
  execution_id?: string;
  status: string;
  total: number;
  processed: number;
  percentage: number;
}

export interface BackgroundJob {
  _id: string;
  job_type: string;
  status: string;
  created_at?: string;
  payload?: Record<string, unknown>;
}

export interface DynamicFieldSpec {
  description?: string;
}

export interface DynamicVariantConfig {
  active: boolean;
  column?: string | null;
  mapping?: Record<string, string>;
}

export interface FormatValueTransform {
  method: string;
  param?: string;
}

/** A variant key like "default" or "hindi" selects which prompt/greeting/voice a call uses. */
export interface Template {
  _id: string;
  name: string;
  from_number?: string;
  phone_column?: string;
  input_fields?: string[];
  format_values?: Record<string, string>;
  dynamic_fields?: Record<string, DynamicFieldSpec>;
  prompts?: Record<string, string>;
  analysis_prompts?: Record<string, string>;
  greetings?: Record<string, string>;
  stt_lan_codes?: Record<string, string>;
  tts_lan_codes?: Record<string, string>;
  tts_model_ids?: Record<string, string>;
  tts_voice_ids?: Record<string, string>;
  format_values_mapping_methods?: Record<string, FormatValueTransform>;
  dynamic?: DynamicVariantConfig;
  telephony_provider?: string;
  use_cases?: Record<string, UseCase>;
  default_use_case?: string;
  default_language?: string;
  language_column?: string;
  language_column_mapping?: Record<string, string>;
  created_at?: string;
  updated_at?: string;
}

/** One language's full config inside a use case. */
export interface LanguageConfig {
  prompt?: string;
  greeting?: string;
  analysis_prompt?: string;
  stt_lan_code?: string;
  tts_lan_code?: string;
  tts_voice_id?: string;
  tts_model_id?: string;
}

/** A use case (EMI collection, sales, survey…) holding one config per language. */
export interface UseCase {
  label?: string;
  languages: Record<string, LanguageConfig>;
}

export interface SupportedLanguage {
  key: string;
  label: string;
  stt: string;
  tts: string;
}

export interface AppSettings {
  telephony_provider?: string;
  from_number?: string;
  stt_provider?: string;
  stt_model?: string;
  llm_provider?: string;
  llm_model?: string;
  tts_provider?: string;
  tts_model_id?: string;
  tts_voice_id?: string;
  default_language?: string;
  silence_first_seconds?: number;
  silence_second_seconds?: number;
  max_call_seconds?: number;
}

export interface AppSettingsResponse {
  settings: AppSettings;
  credentials: Record<string, boolean>;
  numbers: Record<string, string>;
}

export interface DatasheetTemplate {
  _id: string;
  name: string;
  required_columns: string[];
  required_columns_mapping?: Record<string, string>;
  update_columns_mapping: Record<string, string>;
  attempt_columns?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface Disposition {
  value: string;
  color: string;
  label: string;
}

export type MappingKeyCategories = Record<string, string[]>;

export interface DatasheetRow {
  row_index: number;
  data: Record<string, unknown>;
  status: string;
  disposition_code?: string | null;
  model_data?: Record<string, unknown>;
  session_id?: string | null;
}

export interface Datasheet {
  _id: string;
  name: string;
  datasheet_template_id: string;
  columns: string[];
  row_count: number;
  rows?: DatasheetRow[];
  created_at?: string;
  updated_at?: string;
}

export interface CampaignStats {
  total: number;
  queued: number;
  calling: number;
  completed: number;
  no_answer: number;
  failed: number;
}

export interface Campaign {
  _id: string;
  name: string;
  mode: string;
  datasheet_id: string;
  prompt_template_id: string;
  template_variant?: string;
  use_case?: string;
  language?: string;
  agent_id?: string;
  concurrency?: number;
  execution_id?: string;
  status: string;
  stats: CampaignStats;
  created_at?: string;
  updated_at?: string;
}

/** A named worker pool: how many calls it runs at once and how long each may last. */
export interface Agent {
  _id: string;
  name: string;
  description?: string;
  max_concurrent_calls: number;
  max_call_seconds: number;
  status?: string;
  active_calls?: number;
  created_at?: string;
}

export interface AgentsResponse {
  agents: Agent[];
  total_active_calls: number;
}

/** One selectable vendor for a capability (STT/LLM/TTS/telephony). */
export interface ProviderOption {
  key: string;
  label: string;
  implemented: boolean;
  configured: boolean;
  available: boolean;
  models: string[];
  default_model: string;
  missing_env: string[];
}

export interface ProviderCapability {
  label: string;
  providers: ProviderOption[];
}

export type ProvidersResponse = Record<string, ProviderCapability>;
