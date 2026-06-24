/**
 * Argus — Monitoring Platform
 * Author: Brijesh Dave <https://github.com/brijeshdave>
 *
 * Settings: application-wide configuration, grouped into purpose-built tabs
 * (Security, Displays, Retention) with structured forms — no raw key/value
 * editing. Each tab gates on its own permission; tabs the user can't read are
 * hidden. Domain logic lives in the per-tab components under components/settings.
 */
import { Tabs } from "@/components/Tabs";
import { useAuth } from "@/auth/AuthContext";
import { SecuritySettings } from "@/components/settings/SecuritySettings";
import { AgentSettings } from "@/components/settings/AgentSettings";
import { DisplaySettings } from "@/components/settings/DisplaySettings";
import { RetentionSettings } from "@/components/settings/RetentionSettings";

export function SettingsPage() {
  const { has } = useAuth();
  const canSettings = has("settings:read");
  const canRetention = has("retention:read");

  const items = [
    ...(canSettings
      ? [
          { key: "security", label: "Security", node: <SecuritySettings /> },
          { key: "agents", label: "Agents", node: <AgentSettings /> },
          { key: "displays", label: "Displays", node: <DisplaySettings /> },
        ]
      : []),
    ...(canRetention ? [{ key: "retention", label: "Retention", node: <RetentionSettings /> }] : []),
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-100">Settings</h1>
      {items.length === 0 ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          You do not have permission to view any settings.
        </div>
      ) : (
        <Tabs items={items} />
      )}
    </div>
  );
}
