/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Route table + the ProtectedRoute gate. Uses react-router v7 declarative
 * <Routes>/<Route> (BrowserRouter is provided in App.tsx).
 */
import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { AppShell } from "@/components/AppShell";
import { Spinner } from "@/components/Spinner";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { AgentsPage } from "@/pages/AgentsPage";
import { AgentDetailPage } from "@/pages/AgentDetailPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { LogsPage } from "@/pages/LogsPage";
import { AuditPage } from "@/pages/AuditPage";
import { NotificationsPage } from "@/pages/NotificationsPage";
import { UsersPage } from "@/pages/UsersPage";
import { UserEditorPage } from "@/pages/UserEditorPage";
import { UserSessionsPage } from "@/pages/UserSessionsPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { GroupsPage } from "@/pages/GroupsPage";
import { GroupEditorPage } from "@/pages/GroupEditorPage";
import { RolesPage } from "@/pages/RolesPage";
import { RoleEditorPage } from "@/pages/RoleEditorPage";
import { DevicesPage } from "@/pages/DevicesPage";
import { TickerAdminPage } from "@/pages/TickerAdminPage";
import { TickerEditorPage } from "@/pages/TickerEditorPage";
import { PublicAdminPage } from "@/pages/PublicAdminPage";
import { BackupsPage } from "@/pages/BackupsPage";
import { OidcProvidersPage } from "@/pages/OidcProvidersPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SnmpProfilesPage } from "@/pages/SnmpProfilesPage";
import { PublicStatusPage } from "@/pages/PublicStatusPage";
import { DocsPage } from "@/pages/DocsPage";
import { DevelopersPage } from "@/pages/DevelopersPage";

// Heavy routes (recharts / dnd-kit) are code-split so they don't bloat the
// initial bundle. `lazy` needs a default export, so map the named one.
const UptimePage = lazy(() => import("@/pages/UptimePage").then((m) => ({ default: m.UptimePage })));
const WallboardsPage = lazy(() => import("@/pages/WallboardsPage").then((m) => ({ default: m.WallboardsPage })));
const WallboardBuilder = lazy(() => import("@/pages/WallboardBuilder").then((m) => ({ default: m.WallboardBuilder })));
const WallboardDisplayPage = lazy(() => import("@/pages/WallboardDisplayPage").then((m) => ({ default: m.WallboardDisplayPage })));
const WallboardKiosk = lazy(() => import("@/pages/WallboardKiosk").then((m) => ({ default: m.WallboardKiosk })));
const DeviceDisplay = lazy(() => import("@/pages/DeviceDisplay").then((m) => ({ default: m.DeviceDisplay })));

/**
 * Gate for authenticated OPERATOR areas: wait while loading, bounce anon to /login.
 * A paired display device is not an operator — it may only render its wallboard, so
 * it is redirected to /wall no matter which app URL it lands on. (The backend denies
 * device tokens on operator routes too; this just keeps the UI honest.)
 */
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, isDevice } = useAuth();
  if (status === "loading") return <Spinner label="Loading…" />;
  if (status === "anon") return <Navigate to="/login" replace />;
  if (isDevice || isPairedDevice()) return <Navigate to="/wall" replace />;
  return <>{children}</>;
}

/** A browser paired as a display stores a device token locally. */
function isPairedDevice(): boolean {
  return Boolean(localStorage.getItem("argus.device.token"));
}

/**
 * /wall entry:
 *  - A browser paired as a display (has a device token) is ALWAYS the device display,
 *    even if an operator session also exists — so a dedicated TV keeps heartbeating its
 *    assigned board regardless of any lingering login.
 *  - Otherwise a logged-in operator sees the board (default / :id), and anyone not
 *    logged in gets the device display inline to pair (6-digit code). No redirect.
 */
function WallEntry() {
  const { status, isDevice } = useAuth();
  if (isPairedDevice() || isDevice) return <DeviceDisplay />;
  if (status === "loading") return <Spinner label="Loading…" />;
  if (status === "anon") return <DeviceDisplay />;
  return <WallboardKiosk />;
}

/** Unknown URL: devices go back to their board, everyone else to the dashboard. */
function CatchAll() {
  return <Navigate to={isPairedDevice() ? "/wall" : "/"} replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="agents/:id" element={<AgentDetailPage />} />
        <Route path="logs" element={<LogsPage />} />
        <Route path="uptime" element={<UptimePage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="admin/users" element={<UsersPage />} />
        <Route path="admin/users/new" element={<UserEditorPage />} />
        <Route path="admin/users/:id/edit" element={<UserEditorPage />} />
        <Route path="admin/users/:id/sessions" element={<UserSessionsPage />} />
        <Route path="admin/groups" element={<GroupsPage />} />
        <Route path="admin/groups/new" element={<GroupEditorPage />} />
        <Route path="admin/groups/:id/edit" element={<GroupEditorPage />} />
        <Route path="admin/roles" element={<RolesPage />} />
        <Route path="admin/roles/new" element={<RoleEditorPage />} />
        <Route path="admin/roles/:id/edit" element={<RoleEditorPage />} />
        <Route path="wallboards" element={<WallboardsPage />} />
        <Route path="wallboards/:id" element={<WallboardBuilder />} />
        <Route path="wallboards/:id/display" element={<WallboardDisplayPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="ticker" element={<TickerAdminPage />} />
        <Route path="ticker/new" element={<TickerEditorPage />} />
        <Route path="ticker/:id/edit" element={<TickerEditorPage />} />
        <Route path="admin/public" element={<PublicAdminPage />} />
        <Route path="admin/backups" element={<BackupsPage />} />
        {/* Retention moved into Settings → Retention tab; redirect old deep links. */}
        <Route path="admin/retention" element={<Navigate to="/settings" replace />} />
        <Route path="admin/sso" element={<OidcProvidersPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="snmp-profiles" element={<SnmpProfilesPage />} />
        <Route path="developers" element={<DevelopersPage />} />
      </Route>
      {/* Chrome-less kiosk. /wall = default board for operators; pairing/assigned board
          for unattended screens (no app shell). */}
      <Route path="/wall" element={<WallEntry />} />
      <Route path="/wall/:id" element={<WallEntry />} />
      {/* Unattended display: self-pairs with a 6-digit code, then renders its assigned
          board. No operator login — auth is the device token it stores after pairing. */}
      <Route path="/display" element={<DeviceDisplay />} />
      {/* Fully public status page — no auth, no app shell */}
      <Route path="/status" element={<PublicStatusPage />} />
      {/* Fully public help centre — no auth, no app shell */}
      <Route path="/docs" element={<DocsPage />} />
      <Route path="*" element={<CatchAll />} />
    </Routes>
    </Suspense>
  );
}
