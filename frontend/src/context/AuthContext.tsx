import { createContext, useContext, useState, type ReactNode } from "react";
import { clearCredentials, getApiKey, getApiUrl, setCredentials } from "../api/client";

interface AuthContextValue {
  apiUrl: string;
  apiKey: string;
  isAuthed: boolean;
  login: (apiUrl: string, apiKey: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiUrl, setApiUrl] = useState(getApiUrl());
  const [apiKey, setApiKey] = useState(getApiKey());

  const login = (url: string, key: string) => {
    setCredentials(url, key);
    setApiUrl(url);
    setApiKey(key);
  };

  const logout = () => {
    clearCredentials();
    setApiUrl(getApiUrl());
    setApiKey("");
  };

  return (
    <AuthContext.Provider
      value={{ apiUrl, apiKey, isAuthed: Boolean(apiUrl && apiKey), login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
