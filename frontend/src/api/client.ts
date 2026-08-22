import axios from "axios";

const API_URL_KEY = "vc_api_url";
const API_KEY_KEY = "vc_api_key";
const ROLE_KEY = "vc_role";
const EMAIL_KEY = "vc_email";
const PAGES_KEY = "vc_pages";

// In the deployed image the API is served from the same origin as this bundle, so the
// default is simply "here". Only the Vite dev server (port 5173) needs to be pointed at
// the separate backend.
const DEFAULT_API_URL =
  typeof window !== "undefined" && window.location.port !== "5173"
    ? window.location.origin
    : "http://localhost:8000";

export type Role = "admin" | "user";

export function getApiUrl(): string {
  return localStorage.getItem(API_URL_KEY) || DEFAULT_API_URL;
}

export function getApiKey(): string {
  return localStorage.getItem(API_KEY_KEY) || "";
}

export function getRole(): Role | "" {
  return (localStorage.getItem(ROLE_KEY) as Role) || "";
}

export function getEmail(): string {
  return localStorage.getItem(EMAIL_KEY) || "";
}

/** Pages this role may open, as returned by the backend at sign-in. */
export function getPages(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PAGES_KEY) || "[]");
  } catch {
    return [];
  }
}

export function setSession(token: string, role: Role, email: string, pages: string[]): void {
  localStorage.setItem(API_URL_KEY, getApiUrl());
  localStorage.setItem(API_KEY_KEY, token);
  localStorage.setItem(ROLE_KEY, role);
  localStorage.setItem(EMAIL_KEY, email);
  localStorage.setItem(PAGES_KEY, JSON.stringify(pages));
}

export function clearCredentials(): void {
  [API_KEY_KEY, ROLE_KEY, EMAIL_KEY, PAGES_KEY].forEach((k) => localStorage.removeItem(k));
}

/** True when the signed-in role may open `path` (deep links map to their parent page). */
export function canAccess(path: string): boolean {
  const pages = getPages();
  if (!pages.length) return false;
  if (pages.includes(path)) return true;
  return pages.some((p) => p !== "/" && path.startsWith(p + "/"));
}

export const api = axios.create();

api.interceptors.request.use((config) => {
  config.baseURL = getApiUrl();
  config.headers.set("X-API-Key", getApiKey());
  return config;
});

// A rejected token means the session is no longer valid — drop it and return to sign-in
// rather than leaving the user on a page that silently fails every request.
api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error?.response?.status === 401 && !window.location.pathname.startsWith("/login")) {
      clearCredentials();
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);
