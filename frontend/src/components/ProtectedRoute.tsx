import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthed, can } = useAuth();
  const { pathname } = useLocation();

  if (!isAuthed) return <Navigate to="/login" replace />;

  // Every screen renders through here, so one check covers the whole app: typing a URL
  // the role is not entitled to lands back on the dashboard instead of a page whose API
  // calls would all fail with 403.
  if (!can(pathname)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
