import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TrafficTable } from "@/components/traffic-table";
import {
  Export,
  Feedback,
  JsonView,
  PageHeading,
  Refresh,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { api } from "@/lib/api";
import { time } from "@/lib/export";
import type { ConnectionRecord, StoredMessage } from "@/types";
export default function ConnectionPage() {
  const { identity = "" } = useParams();
  const resource = useResource<
    ConnectionRecord & { messages: StoredMessage[] }
  >(`/connections/${encodeURIComponent(identity)}`, 5000);
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState<
    "disconnect" | "purge" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connection = resource.data;
  async function act() {
    if (!confirmation) return;
    setBusy(true);
    setError("");
    try {
      await api.post(
        `/connections/${encodeURIComponent(identity)}/${confirmation}`,
      );
      if (confirmation === "purge") navigate("/connections");
      else resource.refresh();
      setConfirmation(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title={identity}
        description="Station connection, session context, and recent exchanges."
      >
        <Refresh onClick={resource.refresh} />
        <Export data={connection} name="station" />
        <Link
          className="button primary"
          to={`/commands?identity=${encodeURIComponent(identity)}`}
        >
          Send command
        </Link>
      </PageHeading>
      <Feedback {...resource} retry={resource.refresh} />
      {connection && (
        <>
          <Status tone={connection.status === "online" ? "mint" : "yellow"}>
            {connection.status}
          </Status>
          <dl className="detail-list">
            <div>
              <dt>Protocol</dt>
              <dd>{connection.protocol}</dd>
            </div>
            <div>
              <dt>Remote address</dt>
              <dd>{connection.remoteAddress || "Unavailable"}</dd>
            </div>
            <div>
              <dt>Connected at</dt>
              <dd>{time(connection.connectedAt)}</dd>
            </div>
            <div>
              <dt>Disconnected at</dt>
              <dd>
                {connection.disconnectedAt
                  ? time(connection.disconnectedAt)
                  : "\u2014"}
              </dd>
            </div>
            <div>
              <dt>Security profile</dt>
              <dd>
                {[
                  "None",
                  "Basic authentication",
                  "TLS + Basic authentication",
                  "Mutual TLS",
                ][connection.securityProfile] ?? connection.securityProfile}
              </dd>
            </div>
            <div>
              <dt>Observed errors</dt>
              <dd>{connection.errorCount ?? 0}</dd>
            </div>
          </dl>
          <div className="section-heading">
            <h2>Connection controls</h2>
          </div>
          <div className="inline-actions">
            <button
              className="button"
              disabled={connection.status !== "online" || busy}
              onClick={() => setConfirmation("disconnect")}
            >
              Disconnect station
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={() => setConfirmation("purge")}
            >
              Remove station records
            </button>
            <Link
              className="button"
              to={`/diagnostics?identity=${encodeURIComponent(identity)}`}
            >
              Inspect errors
            </Link>
          </div>
          <p className="notice">
            Disconnect closes the local socket. The physical station controls
            reconnection. Removing records also deletes its retained messages
            and events.
          </p>
          {confirmation && (
            <section
              className="confirm-panel"
              role="region"
              aria-label="Confirm station action"
            >
              <h3>
                {confirmation === "purge"
                  ? "Remove station and retained history?"
                  : "Disconnect this station?"}
              </h3>
              <p>
                This affects {identity}.
                {confirmation === "purge"
                  ? " This cannot be undone."
                  : " Active OCPP calls may fail."}
              </p>
              <div className="inline-actions">
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => void act()}
                >
                  {busy ? "Working..." : "Confirm action"}
                </button>
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => setConfirmation(null)}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          <div className="section-heading">
            <h2>Session data</h2>
          </div>
          <JsonView value={connection.sessionData} />
          <div className="section-heading">
            <h2>Recent exchanges</h2>
            <Link to={`/messages?identity=${encodeURIComponent(identity)}`}>
              Open traffic inspector
            </Link>
          </div>
          <TrafficTable messages={connection.messages.slice(0, 12)} />
        </>
      )}
    </>
  );
}
