import {
  IconAlertTriangle,
  IconCheck,
  IconDatabase,
  IconDeviceDesktop,
  IconMoon,
  IconServer,
  IconSun,
  IconTrash,
  IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTheme } from "@/components/theme-provider";
import {
  Export,
  Feedback,
  PageHeading,
  Refresh,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { useAuth } from "@/lib/auth";
import type { ServerInfo } from "@/types/operations";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { session } = useAuth();
  const server = useResource<ServerInfo>("/server", 10000);

  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [cacheCleared, setCacheCleared] = useState(false);

  const handleClearLocalStorage = () => {
    try {
      // Clear workspace-specific stored keys while preserving theme
      const currentTheme = localStorage.getItem("vite-ui-theme");
      localStorage.clear();
      if (currentTheme) {
        localStorage.setItem("vite-ui-theme", currentTheme);
      }
      setCacheCleared(true);
      setConfirmClearCache(false);
      setTimeout(() => setCacheCleared(false), 3000);
    } catch {
      // Ignore storage errors in restricted iframe environments
    }
  };

  const THEME_OPTIONS = [
    {
      id: "dark" as const,
      name: "Dark mode",
      icon: IconMoon,
      description: "Deep obsidian canvas with high-contrast glowing accents.",
      previewClass: "theme-preview-dark",
    },
    {
      id: "light" as const,
      name: "Light mode",
      icon: IconSun,
      description: "Clean paper canvas with sharp borders and dark typography.",
      previewClass: "theme-preview-light",
    },
    {
      id: "system" as const,
      name: "System default",
      icon: IconDeviceDesktop,
      description:
        "Automatically synchronizes with your OS appearance preference.",
      previewClass: "theme-preview-system",
    },
  ];

  return (
    <>
      <PageHeading
        title="Workspace Preferences"
        description="Visual appearance, operator session status, host runtime environment, and in-memory retention policies."
      >
        <Refresh onClick={() => server.refresh()} />
        <Export
          name="workspace-settings"
          data={{
            session: {
              user: session?.user,
              authMode: session?.authMode,
            },
            server: server.data,
            theme,
          }}
        />
      </PageHeading>

      {/* ── Section 1: Visual Theme Studio ───────────────────────── */}
      <section className="settings-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconSun size={20} className="text-primary" />
            <h2>Appearance & Theme</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Saved locally in your browser
          </span>
        </div>

        <div className="workspace-theme-grid">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isSelected = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={`workspace-theme-card ${isSelected ? "selected" : ""}`}
                onClick={() => setTheme(opt.id)}
                aria-pressed={isSelected}
              >
                <div className={`workspace-theme-preview ${opt.previewClass}`}>
                  <div className="preview-top-bar">
                    <span className="preview-dot" />
                    <span className="preview-dot" />
                    <span className="preview-dot" />
                  </div>
                  <div className="preview-body">
                    <div className="preview-sidebar" />
                    <div className="preview-content">
                      <div className="preview-line w-3/4" />
                      <div className="preview-line w-1/2" />
                    </div>
                  </div>
                </div>

                <div className="workspace-theme-info">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon size={18} className="text-primary" />
                      <strong>{opt.name}</strong>
                    </div>
                    {isSelected && (
                      <span className="workspace-theme-badge">
                        <IconCheck size={12} /> Active
                      </span>
                    )}
                  </div>
                  <p>{opt.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Section 2: Operator Session ──────────────────────────── */}
      <section className="settings-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconUser size={20} className="text-lavender" />
            <h2>Current Operator Session</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Authentication mode and privileges
          </span>
        </div>

        <div className="workspace-session-card">
          <div className="workspace-session-header">
            <div className="avatar tone-lavender font-bold text-base">
              {(session?.user?.name ?? "O").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong className="text-base">
                {session?.user?.name ?? "Operator"}
              </strong>
              <p className="text-xs text-muted-foreground">
                Active operator session context
              </p>
            </div>
            <div className="ml-auto">
              <Status tone="mint">Authenticated</Status>
            </div>
          </div>

          <div className="workspace-session-grid">
            <div className="session-field-item">
              <span className="field-label">Authentication Mode</span>
              <strong className="field-val capitalize">
                {session?.authMode ?? "Session"}
              </strong>
            </div>
            <div className="session-field-item">
              <span className="field-label">Operator Privileges</span>
              <strong className="field-val text-mint">
                Administrative & Diagnostic
              </strong>
            </div>
            <div className="session-field-item">
              <span className="field-label">RPC Command Execution</span>
              <strong className="field-val">
                {server.data?.commandsEnabled ? "Allowed" : "Read-only"}
              </strong>
            </div>
            <div className="session-field-item">
              <span className="field-label">User Identifier</span>
              <strong className="field-val font-mono text-xs">
                {session?.user?.id ?? "local-session"}
              </strong>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: Host Runtime Environment ──────────────────── */}
      <section className="settings-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconServer size={20} className="text-blue" />
            <h2>Host Runtime & Environment</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Underlying ocpp-ws-io daemon status
          </span>
        </div>

        <Feedback {...server} retry={server.refresh} />

        <div className="workspace-env-grid">
          <div className="workspace-env-card">
            <span className="env-label">OCPP Server Core</span>
            <strong className="env-val">
              {server.data?.attached ? "Attached Plugin" : "Standalone Node"}
            </strong>
            <span className="env-sub text-muted-foreground">
              {server.data?.attached
                ? "Directly bound to live OCPP connections"
                : "Monitoring interface not attached"}
            </span>
          </div>

          <div className="workspace-env-card">
            <span className="env-label">Negotiated Protocols</span>
            <strong className="env-val">
              {server.data?.protocols && server.data.protocols.length > 0
                ? server.data.protocols.join(", ")
                : "ocpp1.6, ocpp2.0.1"}
            </strong>
            <span className="env-sub text-muted-foreground">
              Dual-protocol compatibility active
            </span>
          </div>

          <div className="workspace-env-card">
            <span className="env-label">Command Dispatch Engine</span>
            <strong
              className={`env-val ${server.data?.commandsEnabled ? "text-mint" : "text-yellow"}`}
            >
              {server.data?.commandsEnabled
                ? "Enabled"
                : "Disabled (Read-only)"}
            </strong>
            <span className="env-sub text-muted-foreground">
              {server.data?.commandsEnabled
                ? "Operators may issue remote RPC actions"
                : "Running in read-only observation mode"}
            </span>
          </div>

          <div className="workspace-env-card">
            <span className="env-label">Live Connection Nodes</span>
            <strong className="env-val text-teal">
              {server.data?.stats?.connectedClients ?? 0} Chargers
            </strong>
            <span className="env-sub text-muted-foreground">
              {server.data?.stats?.activeSessions ?? 0} active charging sessions
            </span>
          </div>
        </div>
      </section>

      {/* ── Section 4: In-Memory Retention & Storage ──────────────── */}
      <section className="settings-section">
        <div className="section-heading">
          <div className="flex items-center gap-2">
            <IconDatabase size={20} className="text-mint" />
            <h2>In-Memory Retention & Storage Policies</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Bounded FIFO buffer limits and client cache
          </span>
        </div>

        <div className="workspace-retention-panel">
          <div className="retention-policies-list">
            <div className="retention-item">
              <div className="retention-item-info">
                <strong>Live Messages Buffer</strong>
                <p>
                  Stores recent inbound and outbound OCPP CALL, CALLRESULT, and
                  CALLERROR frames.
                </p>
              </div>
              <div className="retention-badge">
                <span className="font-mono text-xs">1,000 frames</span>
              </div>
            </div>

            <div className="retention-item">
              <div className="retention-item-info">
                <strong>RPC Command Execution Audit Log</strong>
                <p>
                  Records operator-dispatched commands with latency and response
                  payloads.
                </p>
              </div>
              <div className="retention-badge">
                <span className="font-mono text-xs">200 executions</span>
              </div>
            </div>

            <div className="retention-item">
              <div className="retention-item-info">
                <strong>Security & Diagnostic Ring Buffer</strong>
                <p>
                  Logs authentication challenges, protocol errors, and lifecycle
                  events.
                </p>
              </div>
              <div className="retention-badge">
                <span className="font-mono text-xs">500 events</span>
              </div>
            </div>
          </div>

          <div className="retention-cache-footer">
            <div>
              <strong>Local Workspace Preferences</strong>
              <p className="text-xs text-muted-foreground">
                Clears starred charger bookmarks, local column filters, and
                cached search terms.
              </p>
            </div>
            {!confirmClearCache ? (
              <button
                type="button"
                className="button secondary sm"
                onClick={() => setConfirmClearCache(true)}
              >
                <IconTrash size={14} className="text-rose" />
                Reset local workspace cache
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="button primary sm"
                  style={{
                    background: "var(--rose)",
                    borderColor: "var(--rose)",
                  }}
                  onClick={handleClearLocalStorage}
                >
                  <IconAlertTriangle size={14} /> Confirm reset
                </button>
                <button
                  type="button"
                  className="button secondary sm"
                  onClick={() => setConfirmClearCache(false)}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          {cacheCleared && (
            <div className="notice mt-3 text-mint flex items-center gap-1.5 text-xs">
              <IconCheck size={14} /> Local workspace preferences reset
              successfully.
            </div>
          )}
        </div>
      </section>
    </>
  );
}
