import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Sessions } from "./pages/Sessions";
import { SessionDetail } from "./pages/SessionDetail";
import { Calls } from "./pages/Calls";
import { Templates } from "./pages/Templates";
import { DatasheetTemplates } from "./pages/DatasheetTemplates";
import { Campaigns } from "./pages/Campaigns";
import { Agents } from "./pages/Agents";
import { CampaignDetail } from "./pages/CampaignDetail";
import { Analytics } from "./pages/Analytics";
import { Settings } from "./pages/Settings";

function Protected({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>{children}</Layout>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Dashboard />
          </Protected>
        }
      />
      <Route
        path="/sessions"
        element={
          <Protected>
            <Sessions />
          </Protected>
        }
      />
      <Route
        path="/sessions/:id"
        element={
          <Protected>
            <SessionDetail />
          </Protected>
        }
      />
      <Route
        path="/calls"
        element={
          <Protected>
            <Calls />
          </Protected>
        }
      />
      <Route
        path="/templates"
        element={
          <Protected>
            <Templates />
          </Protected>
        }
      />
      <Route
        path="/datasheets"
        element={
          <Protected>
            <DatasheetTemplates />
          </Protected>
        }
      />
      <Route path="/datasheet-templates" element={<Navigate to="/datasheets" replace />} />
      <Route
        path="/campaigns"
        element={
          <Protected>
            <Campaigns />
          </Protected>
        }
      />
      <Route
        path="/campaigns/:id"
        element={
          <Protected>
            <CampaignDetail />
          </Protected>
        }
      />
      <Route
        path="/agents"
        element={
          <Protected>
            <Agents />
          </Protected>
        }
      />
      <Route
        path="/analytics"
        element={
          <Protected>
            <Analytics />
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <Settings />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
