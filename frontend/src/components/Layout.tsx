import { type ComponentType, type ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getHealth } from "../api/endpoints";
import { useAuth } from "../context/AuthContext";
import {
  IconChart,
  IconCampaign,
  IconDashboard,
  IconDatabase,
  IconHeadset,
  IconMessage,
  IconPhone,
  IconSettings,
  IconTemplate,
  IconUsers,
} from "./Icons";

type NavItem = { to: string; label: string; Icon: ComponentType<{ size?: number }>; end?: boolean };

const NAV_SECTIONS: { heading: string; items: NavItem[] }[] = [
  { heading: "Overview", items: [{ to: "/", label: "Dashboard", Icon: IconDashboard, end: true }] },
  {
    heading: "Operations",
    items: [
      { to: "/campaigns", label: "Campaigns", Icon: IconCampaign },
      { to: "/sessions", label: "Conversations", Icon: IconMessage },
      { to: "/calls", label: "Test Call", Icon: IconPhone },
      { to: "/agents", label: "Agents", Icon: IconUsers },
      { to: "/analytics", label: "Analytics", Icon: IconChart },
    ],
  },
  {
    heading: "Configuration",
    items: [
      { to: "/templates", label: "Templates", Icon: IconTemplate },
      { to: "/datasheets", label: "Datasheets", Icon: IconDatabase },
      { to: "/settings", label: "Settings", Icon: IconSettings },
    ],
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const { apiUrl, logout } = useAuth();
  const navigate = useNavigate();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: getHealth,
    refetchInterval: 15_000,
    retry: false,
  });

  // One rolled-up state rather than naming each underlying service.
  const checks = [health?.mongo_ready, health?.llm_ready, health?.tts_ready, health?.stt_ready];
  const online = checks.every(Boolean);
  const partial = !online && checks.some(Boolean);
  const statusLabel = online ? "Operational" : partial ? "Degraded" : "Offline";
  const statusDot = online ? "bg-emerald-500" : partial ? "bg-amber-500" : "bg-rose-500";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    // h-screen + overflow-hidden keeps the sidebar fixed while only the main pane scrolls.
    <div className="flex h-screen overflow-hidden bg-slate-100 text-slate-900">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-800/60 bg-slate-900">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <IconHeadset size={18} />
          </span>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">Voice Agent</div>
            <div className="text-[11px] text-slate-400">Admin console</div>
          </div>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.heading}>
              <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {section.heading}
              </div>
              <div className="space-y-0.5">
                {section.items.map(({ to, label, Icon, end }) => (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                        isActive
                          ? "bg-indigo-600 font-medium text-white"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                      }`
                    }
                  >
                    <Icon size={17} />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            <span className="truncate">{statusLabel}</span>
          </div>
          <button
            onClick={handleLogout}
            className="mt-2 w-full rounded-md border border-slate-700 px-2 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 hover:text-white"
          >
            Disconnect
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <span className="truncate font-mono text-xs text-slate-400">{apiUrl}</span>
          <span className="flex shrink-0 items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600">
            <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
