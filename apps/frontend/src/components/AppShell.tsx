/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Authenticated app chrome: an icon sidebar nav + top bar (user + logout) around an
 * <Outlet/> for routed pages. SCADA/HMI styling. Responsive: the sidebar is a
 * fixed rail on md+ and a toggle-able drawer on small screens.
 */
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Activity, BarChart3, Bell, BookOpen, ChevronUp, CircleUser, Code2, Database, Globe, KeyRound, LayoutDashboard,
  LogOut, Megaphone, Menu, MonitorSmartphone, ScrollText, Server, Settings as SettingsIcon,
  ShieldCheck, Tv, Users, UsersRound, KeySquare, Network, type LucideIcon,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import { useAuth } from "@/auth/AuthContext";
import { TickerBar } from "@/components/TickerBar";
import { useEscape } from "@/hooks/useEscape";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  perm?: string; // hide unless the user holds this permission (owner sees all)
  newTab?: boolean; // open in a new browser tab (documentation links)
}

interface NavSection {
  title?: string;
  items: readonly NavItem[];
}

// Grouped sidebar nav. Profile / user / logout live in the pinned footer, not here.
const SECTIONS: readonly NavSection[] = [
  {
    items: [{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true }],
  },
  {
    title: "Monitoring",
    items: [
      { to: "/agents", label: "Agents", icon: Server, perm: "agents:read" },
      { to: "/devices", label: "Devices", icon: MonitorSmartphone, perm: "devices:read" },
      { to: "/snmp-profiles", label: "SNMP profiles", icon: Network, perm: "monitors:read" },
      { to: "/uptime", label: "Uptime", icon: Activity, perm: "uptime:read" },
    ],
  },
  {
    title: "Displays",
    items: [
      { to: "/wallboards", label: "Wallboards", icon: Tv, perm: "wallboards:read" },
      { to: "/admin/public", label: "Public Status", icon: Globe, perm: "public:read" },
      { to: "/ticker", label: "Ticker", icon: Megaphone, perm: "ticker:read" },
    ],
  },
  {
    title: "Insights",
    items: [
      { to: "/reports", label: "Reports", icon: BarChart3, perm: "reports:read" },
      { to: "/notifications", label: "Notifications", icon: Bell, perm: "notifications:read" },
      { to: "/logs", label: "Logs", icon: ScrollText, perm: "logs:read" },
      { to: "/audit", label: "Audit", icon: ShieldCheck, perm: "audit:read" },
    ],
  },
  {
    title: "Administration",
    items: [
      { to: "/admin/users", label: "Users", icon: Users, perm: "users:read" },
      { to: "/admin/groups", label: "Groups", icon: UsersRound, perm: "groups:read" },
      { to: "/admin/roles", label: "Roles", icon: KeyRound, perm: "roles:read" },
      { to: "/settings", label: "Settings", icon: SettingsIcon, perm: "settings:read" },
      { to: "/admin/sso", label: "SSO (OIDC)", icon: KeySquare, perm: "settings:read" },
      { to: "/admin/backups", label: "Backups", icon: Database, perm: "backups:read" },
    ],
  },
  {
    title: "Help",
    items: [
      { to: "/docs", label: "Documentation", icon: BookOpen, newTab: true },
      { to: "/developers", label: "Developers", icon: Code2, perm: "developer:read", newTab: true },
    ],
  },
];

export function AppShell() {
  const { user, logout, has } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  useEscape(() => setUserMenuOpen(false), userMenuOpen);
  useEscape(() => setDrawerOpen(false), drawerOpen);

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  const displayName = user?.displayName || user?.username || "User";

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
      isActive ? "bg-sky-500/15 text-sky-200" : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-100"
    }`;

  // Visible sections: drop items the user can't see, then drop empty sections.
  const sections = SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.perm || has(i.perm)) }))
    .filter((s) => s.items.length > 0);

  const Sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-md bg-sky-500/20 text-sky-300">
          <Activity size={18} />
        </span>
        <div className="leading-tight">
          <div className="text-base font-semibold tracking-wide">{BRAND.name}</div>
          <div className="text-[11px] uppercase tracking-widest text-slate-500">{BRAND.tagline}</div>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
        {sections.map((section, i) => (
          <div key={section.title ?? `s${i}`} className="space-y-1">
            {section.title ? (
              <div className="px-3 pb-1 text-[0.6rem] font-semibold uppercase tracking-widest text-slate-600">{section.title}</div>
            ) : null}
            {section.items.map((item) => {
              const Icon = item.icon;
              // Documentation links open in a new tab so operators don't lose their place.
              if (item.newTab) {
                return (
                  <a key={item.to} href={item.to} target="_blank" rel="noopener noreferrer" onClick={() => setDrawerOpen(false)} className={linkClass({ isActive: false })}>
                    <Icon size={16} className="shrink-0" />
                    {item.label}
                  </a>
                );
              }
              return (
                <NavLink key={item.to} to={item.to} end={item.end ?? false} onClick={() => setDrawerOpen(false)} className={linkClass}>
                  <Icon size={16} className="shrink-0" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Pinned footer: a single user menu (profile + logout) that opens upward */}
      <div className="relative shrink-0 border-t border-slate-800 p-3">
        {userMenuOpen ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
            <div className="absolute bottom-full left-3 right-3 z-20 mb-1 overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-lg shadow-black/40">
              <NavLink
                to="/profile"
                onClick={() => { setUserMenuOpen(false); setDrawerOpen(false); }}
                className={({ isActive }) => `flex items-center gap-2 px-3 py-2 text-sm ${isActive ? "text-sky-200" : "text-slate-300"} hover:bg-slate-800`}
              >
                <CircleUser size={15} /> Profile &amp; security
              </NavLink>
              <button
                type="button"
                onClick={handleLogout}
                className="flex w-full items-center gap-2 border-t border-slate-800 px-3 py-2 text-sm text-rose-300 hover:bg-rose-500/10"
              >
                <LogOut size={15} /> Logout
              </button>
            </div>
          </>
        ) : null}
        <button
          type="button"
          onClick={() => setUserMenuOpen((o) => !o)}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-slate-800/60"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-800 text-slate-300">
            <CircleUser size={17} />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm text-slate-200">{displayName}</span>
            <span className="block truncate text-[11px] text-slate-500">Account</span>
          </span>
          <ChevronUp size={15} className={`shrink-0 text-slate-500 transition-transform ${userMenuOpen ? "" : "rotate-180"}`} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-100">
      {/* Desktop rail — fixed full height; only its nav scrolls */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-800 bg-slate-900/40 md:flex">{Sidebar}</aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-slate-950/70" />
          <aside
            className="absolute left-0 top-0 flex h-full w-60 flex-col overflow-y-auto border-r border-slate-800 bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            {Sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/40 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 md:hidden"
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <div className="text-sm text-slate-500">Operations Console</div>
          </div>
          <div className="text-sm text-slate-400">{displayName}</div>
        </header>
        <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
        <TickerBar />
      </div>
    </div>
  );
}
