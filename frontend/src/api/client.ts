import axios from "axios";

const API_URL_KEY = "vc_api_url";
const API_KEY_KEY = "vc_api_key";
// In the deployed image the API is served from the same origin as this bundle, so the
// default is simply "here". Only the Vite dev server (port 5173) needs to be pointed at
// the separate backend. Either way the login screen can still override it.
const DEFAULT_API_URL =
  typeof window !== "undefined" && window.location.port !== "5173"
    ? window.location.origin
    : "http://localhost:8000";

export function getApiUrl(): string {
  return localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
}

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_KEY) || "";
}

export function setCredentials(apiUrl: string, apiKey: string): void {
  localStorage.setItem(API_URL_KEY, apiUrl);
  localStorage.setItem(API_KEY_KEY, apiKey);
}

export function clearCredentials(): void {
  localStorage.removeItem(API_URL_KEY);
  localStorage.removeItem(API_KEY_KEY);
}

export const api = axios.create();

api.interceptors.request.use((config) => {
  config.baseURL = getApiUrl();
  config.headers.set("X-API-Key", getApiKey());
  return config;
});
