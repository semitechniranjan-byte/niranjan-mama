import { createContext, useContext, useState, type ReactNode } from "react";
import {
  canAccess,
  clearCredentials,
  getApiKey,
  getApiUrl,
  getEmail,
  getPages,
  getRole,
  setSession,
  type Role,
} from "../api/client";

interface AuthContextValue {
  apiUrl: string;
  apiKey: string;
  role: Role | "";
  email: string;
  pages: string[];
  isAuthed: boolean;
  isAdmin: boolean;
  can: (path: string) => boolean;
  login: (token: string, role: Role, email: string, pages: string[]) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [apiKey, setApiKey] = useState(getApiKey());
  const [role, setRole] = useState<Role | "">(getRole());
  const [email, setEmail] = useState(getEmail());
  const [pages, setPages] = useState<string[]>(getPages());

  const login = (token: string, nextRole: Role, nextEmail: string, nextPages: string[]) => {
    setSession(token, nextRole, nextEmail, nextPages);
    setApiKey(token);
    setRole(nextRole);
    setEmail(nextEmail);
    setPages(nextPages);
  };

  const logout = () => {
    clearCredentials();
    setApiKey("");
    setRole("");
    setEmail("");
    setPages([]);
  };

  return (
    <AuthContext.Provider
      value={{
        apiUrl: getApiUrl(),
        apiKey,
        role,
        email,
        pages,
        isAuthed: Boolean(apiKey && role),
        isAdmin: role === "admin",
        can: canAccess,
        login,
        logout,
      }}
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
