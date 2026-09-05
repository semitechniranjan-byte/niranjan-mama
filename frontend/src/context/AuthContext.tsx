import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  clearCredentials,
  getApiKey,
  getApiUrl,
  getEmail,
  getPages,
  getRole,
  setPages as persistPages,
  setSession,
  type Role,
} from "../api/client";
import { getMe } from "../api/endpoints";

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

  // The page list is written once at sign-in, so a page added to the product later stayed
  // hidden until the operator signed out and back in. Ask the server what this role may
  // open now, every time the console loads.
  useEffect(() => {
    if (!apiKey) return;
    getMe()
      .then((me) => {
        persistPages(me.pages);
        setPages(me.pages);
      })
      .catch(() => {
        /* An offline or rejected check leaves the stored list in place. */
      });
  }, [apiKey]);

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
        // Derived from state, not from storage, so a refreshed list redraws the menu.
        can: (path: string) =>
          pages.length > 0 &&
          (pages.includes(path) || pages.some((p) => p !== "/" && path.startsWith(p + "/"))),
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
