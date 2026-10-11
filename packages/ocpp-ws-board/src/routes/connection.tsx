import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowLeft,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconDatabase,
  IconDotsVertical,
  IconExternalLink,
  IconMessage,
  IconNetwork,
  IconPower,
  IconSend,
  IconStar,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { TrafficTable } from "@/components/traffic-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  Export,
  Feedback,
  JsonView,
  Pagination,
  Refresh,
  Search,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { api } from "@/lib/api";
import { time } from "@/lib/export";
import type {
  ConnectionRecord,
  JsonObject,
  JsonValue,
  StoredMessage,
} from "@/types";
import type { CommandRecord } from "@/types/operations";
import { COMMAND_PRESETS } from "@/types/presets";

const SECURITY_PROFILES: Record<number, string> = {
  0: "None (Unsecured)",
  1: "Basic authentication",
  2: "TLS + Basic authentication",
  3: "Mutual TLS",
};

const DIRECTION_OPTIONS: Record<string, string> = {
  all: "Both directions",
  IN: "Received",
  OUT: "Sent",
};

export default function ConnectionPage() {
  const { identity = "" } = useParams();
  const [query, setQuery] = useSearchParams();
  const resource = useResource<
    ConnectionRecord & { messages: StoredMessage[] }
  >(`/connections/${encodeURIComponent(identity)}`, 5000);
  const navigate = useNavigate();

  // Navigation tab
  const activeTab = query.get("tab") ?? "overview";
  const setTab = (tab: string) => {
    const next = new URLSearchParams(query);
    if (tab === "overview") next.delete("tab");
    else next.set("tab", tab);
    setQuery(next);
  };

  // Confirmation & Feedback
  const [confirmation, setConfirmation] = useState<
    "disconnect" | "purge" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  // Copy state
  const [copiedId, setCopiedId] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);

  // Favorites
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const data: string[] = JSON.parse(
        localStorage.getItem("board:favorites") ?? "[]",
      );
      return Array.isArray(data)
        ? data.filter((val) => typeof val === "string")
        : [];
    } catch {
      return [];
    }
  });
  const isFavorite = favorites.includes(identity);
  const toggleFavorite = () => {
    const next = isFavorite
      ? favorites.filter((id) => id !== identity)
      : [...favorites, identity];
    setFavorites(next);
    try {
      localStorage.setItem("board:favorites", JSON.stringify(next));
    } catch {
      /* Session storage fallback */
    }
  };

  // Messages tab filter & pagination
  const [msgSearch, setMsgSearch] = useState("");
  const [msgDirection, setMsgDirection] = useState("");
  const [msgPage, setMsgPage] = useState(0);
  const [msgPageSize, setMsgPageSize] = useState(6);

  // Quick Command tab state
  const [commandPresetIndex, setCommandPresetIndex] = useState<string>("");
  const [commandMethod, setCommandMethod] = useState("TriggerMessage");
  const [commandPayload, setCommandPayload] = useState(
    '{\n  "requestedMessage": "Heartbeat"\n}',
  );
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandResult, setCommandResult] = useState<CommandRecord | null>(
    null,
  );
  const [commandError, setCommandError] = useState("");

  const connection = resource.data;

  // Presets available for this charger's protocol
  const presets = COMMAND_PRESETS.filter(
    (preset) => connection && preset.protocols.includes(connection.protocol),
  );
  const presetItems: Record<string, string> = Object.fromEntries(
    presets.map((preset, index) => [String(index), preset.name]),
  );

  const handleSelectPreset = (value: string | null) => {
    if (value === null) return;
    setCommandPresetIndex(value);
    const preset = presets[Number(value)];
    if (preset) {
      setCommandMethod(preset.method);
      setCommandPayload(JSON.stringify(preset.params, null, 2));
      setCommandError("");
      setCommandResult(null);
    }
  };

  const copyIdentity = async () => {
    try {
      await navigator.clipboard.writeText(identity);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      /* Ignore */
    }
  };

  const copySessionData = async () => {
    if (!connection?.sessionData) return;
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(connection.sessionData, null, 2),
      );
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    } catch {
      /* Ignore */
    }
  };

  async function act() {
    if (!confirmation) return;
    setBusy(true);
    setError("");
    setActionFeedback(null);
    try {
      await api.post(
        `/connections/${encodeURIComponent(identity)}/${confirmation}`,
      );
      if (confirmation === "purge") {
        navigate("/connections");
      } else {
        setActionFeedback({
          type: "success",
          message: `Charger ${identity} disconnected successfully.`,
        });
        resource.refresh();
      }
      setConfirmation(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function executeQuickCommand() {
    if (!connection) return;
    if (!commandMethod.trim()) {
      setCommandError("Specify an OCPP action.");
      return;
    }
    let parsedParams: JsonObject;
    try {
      const parsed = JSON.parse(commandPayload) as JsonValue;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setCommandError("Payload must be a JSON object.");
        return;
      }
      parsedParams = parsed as JsonObject;
    } catch {
      setCommandError("Payload is not valid JSON. Check syntax.");
      return;
    }

    setCommandBusy(true);
    setCommandError("");
    setCommandResult(null);
    try {
      const res = await api.post<CommandRecord>("/commands", {
        identity,
        method: commandMethod.trim(),
        params: parsedParams,
        protocol: connection.protocol,
        timeoutMs: 30000,
      });
      setCommandResult(res);
      resource.refresh();
    } catch (failure) {
      setCommandError(
        failure instanceof Error ? failure.message : "Command failed",
      );
    } finally {
      setCommandBusy(false);
    }
  }

  // Filter messages
  const filteredMessages = (connection?.messages ?? []).filter((msg) => {
    if (msgDirection && msg.direction !== msgDirection) return false;
    if (!msgSearch) return true;
    const term = msgSearch.toLowerCase();
    return (
      msg.method.toLowerCase().includes(term) ||
      msg.messageId.toLowerCase().includes(term) ||
      JSON.stringify(msg.params ?? msg.payload ?? "")
        .toLowerCase()
        .includes(term)
    );
  });
  const currentMsgPage = Math.min(
    msgPage,
    Math.max(0, Math.ceil(filteredMessages.length / msgPageSize) - 1),
  );

  return (
    <>
      {/* Breadcrumb Navigation */}
      <nav
        aria-label="Breadcrumb"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "13px",
          color: "var(--muted-foreground)",
          marginBottom: "14px",
        }}
      >
        <Link
          to="/connections"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            color: "var(--muted-foreground)",
            textDecoration: "none",
          }}
        >
          <IconArrowLeft size={16} />
          <span>Chargers</span>
        </Link>
        <IconChevronRight size={14} style={{ opacity: 0.6 }} />
        <span
          style={{
            color: "var(--foreground)",
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
          }}
        >
          {identity}
        </span>
      </nav>

      {/* Main Page Header */}
      <div
        className="page-heading"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          marginBottom: "18px",
        }}
      >
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>
              {identity}
            </h1>
            <button
              className="button icon-button"
              style={{
                width: "30px",
                height: "30px",
                padding: 0,
                color: copiedId ? "var(--mint)" : "var(--muted-foreground)",
              }}
              title="Copy charger identity"
              onClick={() => void copyIdentity()}
            >
              {copiedId ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </button>
            <button
              className="button icon-button"
              style={{
                width: "30px",
                height: "30px",
                padding: 0,
                color: isFavorite
                  ? "var(--amber, #f59e0b)"
                  : "var(--muted-foreground)",
              }}
              title={isFavorite ? "Remove from favorites" : "Add to favorites"}
              onClick={toggleFavorite}
            >
              <IconStar size={16} fill={isFavorite ? "currentColor" : "none"} />
            </button>
            {connection && (
              <>
                <Status
                  tone={
                    connection.status === "online"
                      ? "mint"
                      : connection.status === "offline"
                        ? "yellow"
                        : "rose"
                  }
                >
                  {connection.status}
                </Status>
                <span
                  style={{
                    fontSize: "12px",
                    padding: "3px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    fontFamily: "var(--font-mono)",
                    color: "var(--muted-foreground)",
                  }}
                >
                  {connection.protocol.toUpperCase()}
                </span>
              </>
            )}
          </div>
          <p
            style={{
              margin: "6px 0 0",
              color: "var(--muted-foreground)",
              fontSize: "13px",
            }}
          >
            Connection details, session parameters, frame exchanges, and remote
            operations.
          </p>
        </div>

        {/* Header Action Buttons */}
        <div
          className="heading-actions"
          style={{ display: "flex", gap: "8px" }}
        >
          <Refresh onClick={resource.refresh} />
          <Export data={connection} name={`charger-${identity}`} />
          <Link
            className="button primary"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            to={`/commands?identity=${encodeURIComponent(identity)}`}
          >
            <IconSend size={15} />
            <span>Command center</span>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="button icon-button"
              aria-label="Charger actions menu"
            >
              <IconDotsVertical size={17} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Charger operations</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setTab("commands")}>
                <IconTerminal2
                  size={15}
                  style={{ marginRight: 8, color: "var(--blue)" }}
                />
                Execute quick command
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  navigate(`/messages?identity=${encodeURIComponent(identity)}`)
                }
              >
                <IconMessage size={15} style={{ marginRight: 8 }} />
                Open live message traffic
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  navigate(
                    `/diagnostics?identity=${encodeURIComponent(identity)}`,
                  )
                }
              >
                <IconAlertTriangle size={15} style={{ marginRight: 8 }} />
                Inspect diagnostics & errors
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={connection?.status !== "online" || busy}
                onClick={() => setConfirmation("disconnect")}
              >
                <IconPower
                  size={15}
                  style={{ marginRight: 8, color: "var(--amber, #f59e0b)" }}
                />
                Disconnect charger
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={busy}
                onClick={() => setConfirmation("purge")}
                style={{ color: "var(--rose)" }}
              >
                <IconTrash size={15} style={{ marginRight: 8 }} />
                Remove charger records
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Feedback {...resource} retry={resource.refresh} />

      {/* Action Notification Banner */}
      {actionFeedback && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            borderRadius: "8px",
            marginBottom: "16px",
            fontSize: "13px",
            background:
              actionFeedback.type === "success"
                ? "color-mix(in srgb, var(--mint) 12%, transparent)"
                : "color-mix(in srgb, var(--rose) 12%, transparent)",
            border: `1px solid ${actionFeedback.type === "success" ? "var(--mint)" : "var(--rose)"}`,
            color: "var(--foreground)",
          }}
        >
          <span>{actionFeedback.message}</span>
          <button
            className="button icon-button"
            style={{ width: 22, height: 22, padding: 0, border: 0 }}
            onClick={() => setActionFeedback(null)}
          >
            <IconX size={14} />
          </button>
        </div>
      )}

      {/* Confirmation Dialog / Panel */}
      {confirmation && (
        <section
          className="confirm-panel"
          role="region"
          aria-label="Confirm charger action"
          style={{
            margin: "0 0 20px",
            background: "color-mix(in srgb, var(--card) 95%, var(--rose) 5%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <IconAlertCircle size={22} style={{ color: "var(--rose)" }} />
            <h3 style={{ margin: 0 }}>
              {confirmation === "purge"
                ? `Remove records for ${identity}?`
                : `Disconnect charger ${identity}?`}
            </h3>
          </div>
          <p>
            {confirmation === "purge"
              ? "Removing this charger permanently purges its retained sessions, exchanges, and telemetry records from the board store. This action cannot be undone."
              : "Disconnecting will immediately terminate the active WebSocket connection. The physical charging station will control reconnection according to its retry interval."}
          </p>
          <div
            className="inline-actions"
            style={{ display: "flex", gap: "8px" }}
          >
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
        <p
          className="error-banner"
          role="alert"
          style={{ marginBottom: "20px" }}
        >
          {error}
        </p>
      )}

      {connection && (
        <>
          {/* KPI Metric Strip */}
          <div className="metric-strip" style={{ margin: "14px 0 24px" }}>
            <div className="metric">
              <span>Connection status</span>
              <strong
                style={{
                  color:
                    connection.status === "online"
                      ? "var(--mint)"
                      : connection.status === "offline"
                        ? "var(--yellow)"
                        : "var(--rose)",
                }}
              >
                {connection.status.toUpperCase()}
              </strong>
              <small>
                {connection.status === "online"
                  ? "Active socket stream"
                  : connection.disconnectedAt
                    ? `Left ${time(connection.disconnectedAt)}`
                    : "No active connection"}
              </small>
            </div>
            <div className="metric">
              <span>Protocol & security</span>
              <strong>{connection.protocol}</strong>
              <small>
                {SECURITY_PROFILES[connection.securityProfile] ??
                  `Profile ${connection.securityProfile}`}
              </small>
            </div>
            <div className="metric">
              <span>Connected timestamp</span>
              <strong style={{ fontSize: "20px" }}>
                {time(connection.connectedAt)}
              </strong>
              <small>
                Remote address: {connection.remoteAddress || "Unknown"}
              </small>
            </div>
            <div className="metric">
              <span>Observed errors</span>
              <strong
                style={{
                  color:
                    (connection.errorCount ?? 0) > 0
                      ? "var(--rose)"
                      : "var(--foreground)",
                }}
              >
                {connection.errorCount ?? 0}
              </strong>
              <small>
                {(connection.errorCount ?? 0) > 0
                  ? "Anomalies or rejects detected"
                  : "Clean protocol session"}
              </small>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div
            className="tab-row"
            role="tablist"
            aria-label="Charger details tabs"
          >
            <button
              role="tab"
              aria-selected={activeTab === "overview"}
              onClick={() => setTab("overview")}
            >
              Overview & Specs
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "messages"}
              onClick={() => setTab("messages")}
            >
              Message Traffic ({connection.messages?.length ?? 0})
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "session"}
              onClick={() => setTab("session")}
            >
              Session Context
            </button>
            <button
              role="tab"
              aria-selected={activeTab === "commands"}
              onClick={() => setTab("commands")}
            >
              Quick Commands
            </button>
          </div>

          {/* Tab 1: Overview & Specs */}
          {activeTab === "overview" && (
            <div className="split-layout">
              {/* Left Column: Network & Specifications Card */}
              <div
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "14px",
                  }}
                >
                  <IconNetwork size={18} style={{ color: "var(--blue)" }} />
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 650 }}>
                    Network & Session Specifications
                  </h3>
                </div>
                <dl className="detail-list" style={{ marginTop: 0 }}>
                  <div>
                    <dt>Charger identity</dt>
                    <dd
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontWeight: 600,
                      }}
                    >
                      {connection.identity}
                    </dd>
                  </div>
                  <div>
                    <dt>Remote socket address</dt>
                    <dd style={{ fontFamily: "var(--font-mono)" }}>
                      {connection.remoteAddress || "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>WebSocket subprotocol</dt>
                    <dd>
                      <span
                        style={{
                          fontSize: "12px",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background:
                            "color-mix(in srgb, var(--blue) 12%, transparent)",
                          color: "var(--blue)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {connection.protocol}
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Security profile level</dt>
                    <dd>
                      {SECURITY_PROFILES[connection.securityProfile] ??
                        connection.securityProfile}
                    </dd>
                  </div>
                  <div>
                    <dt>Connection established</dt>
                    <dd>{time(connection.connectedAt)}</dd>
                  </div>
                  <div>
                    <dt>Disconnected timestamp</dt>
                    <dd>
                      {connection.disconnectedAt
                        ? time(connection.disconnectedAt)
                        : "\u2014 Active"}
                    </dd>
                  </div>
                  <div>
                    <dt>Observed protocol errors</dt>
                    <dd
                      style={{
                        color:
                          (connection.errorCount ?? 0) > 0
                            ? "var(--rose)"
                            : "inherit",
                        fontWeight:
                          (connection.errorCount ?? 0) > 0 ? 600 : 400,
                      }}
                    >
                      {connection.errorCount ?? 0}
                    </dd>
                  </div>
                  <div>
                    <dt>Retained message frames</dt>
                    <dd>{connection.messages?.length ?? 0} frames</dd>
                  </div>
                </dl>
              </div>

              {/* Right Column: Quick Operations & Controls Card */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "16px",
                }}
              >
                <div
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      marginBottom: "14px",
                    }}
                  >
                    <IconPower
                      size={18}
                      style={{ color: "var(--amber, #f59e0b)" }}
                    />
                    <h3
                      style={{ margin: 0, fontSize: "16px", fontWeight: 650 }}
                    >
                      Charger Controls
                    </h3>
                  </div>

                  <p
                    style={{
                      fontSize: "13px",
                      color: "var(--muted-foreground)",
                      margin: "0 0 16px",
                      lineHeight: 1.5,
                    }}
                  >
                    Disconnect safely terminates the local socket connection.
                    Physical chargers automatically initiate reconnect according
                    to internal timers.
                  </p>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <button
                      className="button"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                      }}
                      disabled={connection.status !== "online" || busy}
                      onClick={() => setConfirmation("disconnect")}
                    >
                      <IconPower size={16} />
                      <span>Disconnect active socket</span>
                    </button>

                    <button
                      className="button danger"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                      }}
                      disabled={busy}
                      onClick={() => setConfirmation("purge")}
                    >
                      <IconTrash size={16} />
                      <span>Remove charger records</span>
                    </button>

                    <Link
                      className="button"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        textAlign: "center",
                      }}
                      to={`/diagnostics?identity=${encodeURIComponent(identity)}`}
                    >
                      <IconAlertTriangle size={16} />
                      <span>Inspect diagnostics log</span>
                    </Link>
                  </div>
                </div>

                {/* Quick Presets Trigger Box */}
                <div
                  style={{
                    background: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "12px",
                    }}
                  >
                    <span style={{ fontSize: "14px", fontWeight: 600 }}>
                      Quick Operations
                    </span>
                    <button
                      onClick={() => setTab("commands")}
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--blue)",
                        fontSize: "12px",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Full composer &rarr;
                    </button>
                  </div>

                  <div
                    style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
                  >
                    {presets.slice(0, 4).map((preset, idx) => (
                      <button
                        key={preset.name}
                        className="button"
                        style={{ fontSize: "12px", padding: "6px 10px" }}
                        disabled={connection.status !== "online"}
                        onClick={() => {
                          handleSelectPreset(String(idx));
                          setTab("commands");
                        }}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Message Traffic */}
          {activeTab === "messages" && (
            <div>
              <div
                className="toolbar"
                style={{
                  margin: "0 0 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "9px",
                    flex: 1,
                    minWidth: "260px",
                  }}
                >
                  <Search
                    value={msgSearch}
                    onChange={setMsgSearch}
                    placeholder="Search method, payload, message ID..."
                  />
                  <Select
                    items={DIRECTION_OPTIONS}
                    value={msgDirection || "all"}
                    onValueChange={(val) =>
                      setMsgDirection(val === "all" ? "" : (val ?? ""))
                    }
                  >
                    <SelectTrigger
                      className="w-37.5"
                      aria-label="Filter direction"
                    >
                      <SelectValue className={"capitalize"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Both directions</SelectItem>
                      <SelectItem value="IN">Received</SelectItem>
                      <SelectItem value="OUT">Sent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <Link
                    className="button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                    to={`/messages?identity=${encodeURIComponent(identity)}`}
                  >
                    <IconExternalLink size={15} />
                    <span>Open in live inspector</span>
                  </Link>
                </div>
              </div>

              <TrafficTable
                messages={filteredMessages.slice(
                  currentMsgPage * msgPageSize,
                  currentMsgPage * msgPageSize + msgPageSize,
                )}
              />
              <Pagination
                page={currentMsgPage}
                count={filteredMessages.length}
                size={msgPageSize}
                onChange={setMsgPage}
                onPageSizeChange={setMsgPageSize}
              />
            </div>
          )}

          {/* Tab 3: Session Context */}
          {activeTab === "session" && (
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "10px",
                padding: "20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                >
                  <IconDatabase size={18} style={{ color: "var(--blue)" }} />
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 650 }}>
                    Session Data & Environment
                  </h3>
                </div>
                <button
                  className="button"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                  onClick={() => void copySessionData()}
                >
                  {copiedJson ? (
                    <IconCheck size={16} style={{ color: "var(--mint)" }} />
                  ) : (
                    <IconCopy size={16} />
                  )}
                  <span>{copiedJson ? "Copied" : "Copy JSON"}</span>
                </button>
              </div>

              <p
                style={{
                  fontSize: "13px",
                  color: "var(--muted-foreground)",
                  margin: "0 0 16px",
                }}
              >
                Captures headers, query credentials, handshake metadata, and
                station parameters negotiated at WebSocket connection time.
              </p>

              {connection.sessionData &&
              Object.keys(connection.sessionData).length > 0 ? (
                <JsonView value={connection.sessionData} />
              ) : (
                <Empty title="No session data recorded">
                  This station did not attach auxiliary query or header session
                  parameters at handshake.
                </Empty>
              )}
            </div>
          )}

          {/* Tab 4: Quick Commands */}
          {activeTab === "commands" && (
            <div className="split-layout">
              {/* Left Column: Command Execution Form */}
              <div
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "20px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "16px",
                  }}
                >
                  <IconTerminal2 size={18} style={{ color: "var(--blue)" }} />
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 650 }}>
                    Execute Remote OCPP Command
                  </h3>
                </div>

                {connection.status !== "online" && (
                  <p
                    className="error-banner"
                    style={{ margin: "0 0 16px", fontSize: "13px" }}
                  >
                    Station is currently offline. Remote RPC commands require an
                    active WebSocket connection.
                  </p>
                )}

                <div className="field">
                  <span>Start from a preset</span>
                  <Select
                    items={presetItems}
                    value={commandPresetIndex || null}
                    onValueChange={handleSelectPreset}
                  >
                    <SelectTrigger
                      className="w-full"
                      disabled={
                        connection.status !== "online" || presets.length === 0
                      }
                      aria-label="Command preset"
                    >
                      <SelectValue
                        placeholder={
                          presets.length === 0
                            ? "No compatible presets for protocol"
                            : "Choose a protocol-compatible preset"
                        }
                        className={"capitalize"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {presets.map((preset, index) => (
                        <SelectItem key={preset.name} value={String(index)}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="field">
                  <span>OCPP action method</span>
                  <input
                    className="text-input"
                    value={commandMethod}
                    disabled={connection.status !== "online" || commandBusy}
                    onChange={(e) => setCommandMethod(e.target.value)}
                    placeholder="e.g. TriggerMessage, Reset, UnlockConnector"
                  />
                </div>

                <div className="field">
                  <span>JSON payload arguments</span>
                  <textarea
                    className="text-input"
                    rows={8}
                    style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
                    value={commandPayload}
                    disabled={connection.status !== "online" || commandBusy}
                    onChange={(e) => setCommandPayload(e.target.value)}
                  />
                </div>

                {commandError && (
                  <p
                    className="error-banner"
                    role="alert"
                    style={{ margin: "0 0 16px" }}
                  >
                    {commandError}
                  </p>
                )}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginTop: "8px",
                  }}
                >
                  <button
                    className="button primary"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                    disabled={connection.status !== "online" || commandBusy}
                    onClick={() => void executeQuickCommand()}
                  >
                    <IconSend size={15} />
                    <span>
                      {commandBusy ? "Executing..." : "Send command to charger"}
                    </span>
                  </button>
                  <Link
                    className="button"
                    to={`/commands?identity=${encodeURIComponent(identity)}`}
                  >
                    Open in full composer
                  </Link>
                </div>
              </div>

              {/* Right Column: Execution Response Card */}
              <div
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "10px",
                  padding: "20px",
                }}
              >
                <h3
                  style={{
                    margin: "0 0 14px",
                    fontSize: "16px",
                    fontWeight: 650,
                  }}
                >
                  Response & Results
                </h3>

                {commandResult ? (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "12px",
                      }}
                    >
                      <Status
                        tone={
                          commandResult.status === "succeeded" ? "mint" : "rose"
                        }
                      >
                        {commandResult.status.toUpperCase()}
                      </Status>
                      {commandResult.durationMs != null && (
                        <span
                          style={{
                            fontSize: "12px",
                            color: "var(--muted-foreground)",
                          }}
                        >
                          Latency: {commandResult.durationMs}ms
                        </span>
                      )}
                    </div>

                    <dl className="detail-list" style={{ marginTop: 0 }}>
                      <div>
                        <dt>Method</dt>
                        <dd style={{ fontFamily: "var(--font-mono)" }}>
                          {commandResult.method}
                        </dd>
                      </div>
                      <div>
                        <dt>Timestamp</dt>
                        <dd>{time(commandResult.timestamp)}</dd>
                      </div>
                    </dl>

                    {commandResult.error && (
                      <p className="error-banner" style={{ margin: "14px 0" }}>
                        {commandResult.error}
                      </p>
                    )}

                    <div style={{ marginTop: "14px" }}>
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 600,
                          display: "block",
                          marginBottom: "6px",
                        }}
                      >
                        Response Payload:
                      </span>
                      <JsonView
                        value={commandResult.result ?? { status: "Empty" }}
                      />
                    </div>
                  </div>
                ) : (
                  <Empty title="No command executed yet">
                    Choose a preset or enter parameters and send a request to
                    inspect live response frames.
                  </Empty>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
