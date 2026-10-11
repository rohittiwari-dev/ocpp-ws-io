import { useTheme } from "@/components/theme-provider";
import { PageHeading } from "@/components/workspace";
import { useAuth } from "@/lib/auth";
export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const { session } = useAuth();
  return (
    <>
      <PageHeading
        title="Workspace"
        description="Appearance, session information, and operating guidance."
      />
      <section className="integration-section">
        <h2>Appearance</h2>
        <p className="notice">
          Choose the workspace theme. The preference is saved in this browser.
        </p>
        <div className="inline-actions">
          {(["dark", "light", "system"] as const).map((value) => (
            <button
              key={value}
              className={`button ${theme === value ? "primary" : ""}`}
              aria-pressed={theme === value}
              onClick={() => setTheme(value)}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <section className="integration-section">
        <h2>Current session</h2>
        <dl className="detail-list">
          <div>
            <dt>Operator</dt>
            <dd>{session?.user?.name}</dd>
          </div>
          <div>
            <dt>Authentication</dt>
            <dd>{session?.authMode}</dd>
          </div>
        </dl>
      </section>
      <section className="integration-section" id="help">
        <h2>Working with the board</h2>
        <dl className="detail-list">
          <div>
            <dt>Stations</dt>
            <dd>
              Search by identity or IP, filter by status and protocol, and star
              stations for quick access.
            </dd>
          </div>
          <div>
            <dt>Messages</dt>
            <dd>
              Pause live updates before inspecting payloads. Correlate exchange
              filters by station and message ID.
            </dd>
          </div>
          <div>
            <dt>Commands</dt>
            <dd>
              Choose an online station and a compatible preset, review the JSON,
              and confirm before sending. Read the returned OCPP status.
            </dd>
          </div>
          <div>
            <dt>Keyboard navigation</dt>
            <dd>
              Use Tab and Shift+Tab to navigate, Enter to follow links, and
              Space to activate buttons. The skip link opens the main content.
            </dd>
          </div>
          <div>
            <dt>Exports</dt>
            <dd>
              Export JSON downloads the currently loaded, filtered records. It
              is not an export of the complete storage history.
            </dd>
          </div>
          <div>
            <dt>Retention</dt>
            <dd>
              Default storage is bounded and in memory. Command history retains
              200 requests per process. Restarting clears this history.
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
