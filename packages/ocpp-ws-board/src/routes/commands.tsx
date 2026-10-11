import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowBackUp,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconCode,
  IconCopy,
  IconDotsVertical,
  IconLoader2,
  IconPlug,
  IconSend,
  IconSparkles,
  IconTerminal2,
} from "@tabler/icons-react";
import { Fragment, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
  PageHeading,
  Pagination,
  Refresh,
  Search,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { api } from "@/lib/api";
import { time } from "@/lib/export";
import { cn } from "@/lib/utils";
import type { ConnectionRecord, JsonValue } from "@/types";
import type { CommandRecord, ServerInfo } from "@/types/operations";
import { COMMAND_PRESETS } from "@/types/presets";

const TIMEOUT_OPTIONS = [
  { label: "10s", value: 10000 },
  { label: "30s", value: 30000 },
  { label: "60s", value: 60000 },
  { label: "120s", value: 120000 },
] as const;

const QUICK_PRESETS = [
  {
    label: "Heartbeat",
    method: "TriggerMessage",
    requestedMessage: "Heartbeat",
  },
  {
    label: "Status",
    method: "TriggerMessage",
    requestedMessage: "StatusNotification",
  },
  { label: "Soft Reset", method: "Reset", type: "Soft" },
  { label: "Unlock", method: "UnlockConnector", connectorId: 1 },
  { label: "Clear Cache", method: "ClearCache" },
] as const;

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

function validateJson(text: string): {
  valid: boolean;
  error?: string;
  count?: number;
} {
  try {
    const parsed: JsonValue = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { valid: false, error: "Must be a JSON object" };
    }
    const count = Object.keys(parsed).length;
    return { valid: true, count };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Invalid JSON",
    };
  }
}

export default function CommandsPage() {
  const [query] = useSearchParams();
  const stations = useResource<ConnectionRecord[]>("/connections", 5000);
  const server = useResource<ServerInfo>("/server", 10000);
  const history = useResource<CommandRecord[]>("/commands", 5000);

  const [identity, setIdentity] = useState(query.get("identity") ?? "");
  const [method, setMethod] = useState("TriggerMessage");
  const [payload, setPayload] = useState(
    '{\n  "requestedMessage": "Heartbeat"\n}',
  );
  const [timeout, setTimeoutMs] = useState(30000);
  const [description, setDescription] = useState(
    "Ask the charger to report its heartbeat.",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [result, setResult] = useState<CommandRecord | null>(null);

  // Command History State
  const [historyPage, setHistoryPage] = useState(0);
  const [historyPageSize, setHistoryPageSize] = useState(6);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState("all");
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(
    new Set(),
  );
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [copiedHistoryId, setCopiedHistoryId] = useState<string | null>(null);

  const station = stations.data?.find((item) => item.identity === identity);
  const onlineChargers = (stations.data ?? []).filter(
    (item) => item.status === "online",
  );

  const presets = COMMAND_PRESETS.filter(
    (preset) => !station || preset.protocols.includes(station.protocol),
  );

  const jsonStatus = validateJson(payload);

  const toggleHistoryExpand = (id: string) => {
    setExpandedHistoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleFormatJson = () => {
    try {
      const parsed: JsonValue = JSON.parse(payload);
      setPayload(JSON.stringify(parsed, null, 2));
      setError("");
    } catch {
      setError("Cannot format: payload is not valid JSON.");
    }
  };

  const handleCopyPayload = () => {
    void copyToClipboard(payload);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  const handleCopyResponse = () => {
    if (!result) return;
    const data = result.result ?? result.error ?? {};
    void copyToClipboard(JSON.stringify(data, null, 2));
    setCopiedResponse(true);
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  const handleCopyHistory = (entry: CommandRecord) => {
    const data = entry.result ?? entry.error ?? entry.params ?? {};
    void copyToClipboard(JSON.stringify(data, null, 2));
    setCopiedHistoryId(entry.id);
    setTimeout(() => setCopiedHistoryId(null), 2000);
  };

  const handleLoadIntoComposer = (record: CommandRecord) => {
    setIdentity(record.identity);
    setMethod(record.method);
    setPayload(JSON.stringify(record.params, null, 2));
    setTimeoutMs(record.timeoutMs);
    setDescription(`Prefilled from previous execution of ${record.method}`);
    setAcknowledged(false);
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleQuickPreset = (presetName: string) => {
    const matched = COMMAND_PRESETS.find((p) => {
      if (presetName === "Heartbeat")
        return (
          p.method === "TriggerMessage" &&
          p.params?.requestedMessage === "Heartbeat"
        );
      if (presetName === "Status")
        return (
          p.method === "TriggerMessage" &&
          p.params?.requestedMessage === "StatusNotification"
        );
      if (presetName === "Soft Reset") return p.method === "Reset";
      if (presetName === "Unlock") return p.method === "UnlockConnector";
      if (presetName === "Clear Cache") return p.method === "ClearCache";
      return false;
    });

    if (matched) {
      setMethod(matched.method);
      setPayload(JSON.stringify(matched.params, null, 2));
      setDescription(matched.description);
      setAcknowledged(false);
      setError("");
    }
  };

  async function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!station || station.status !== "online") {
      setError("Choose an online charger to send commands.");
      return;
    }

    let params: JsonValue;
    try {
      params = JSON.parse(payload) as JsonValue;
    } catch {
      setError("Payload is not valid JSON. Check syntax, quotes, and commas.");
      return;
    }

    if (!params || typeof params !== "object" || Array.isArray(params)) {
      setError("Payload must be a JSON object.");
      return;
    }

    setBusy(true);
    setResult(null);

    try {
      const response = await api.post<CommandRecord>("/commands", {
        identity,
        method,
        params,
        protocol: station.protocol,
        timeoutMs: timeout,
      });
      setResult(response);
      history.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Command failed");
    } finally {
      setBusy(false);
      setAcknowledged(false);
    }
  }

  const filteredHistory = (history.data ?? []).filter((entry) => {
    const term = historySearch.toLowerCase();
    const matchesSearch =
      !term ||
      entry.identity.toLowerCase().includes(term) ||
      entry.method.toLowerCase().includes(term) ||
      entry.operator.toLowerCase().includes(term) ||
      JSON.stringify(entry.params).toLowerCase().includes(term);

    const matchesStatus =
      !historyStatus ||
      historyStatus === "all" ||
      entry.status === historyStatus;

    return matchesSearch && matchesStatus;
  });

  return (
    <>
      <PageHeading
        title="Command center"
        description="Compose requests, choose online chargers, and inspect real-time RPC responses."
      >
        <Refresh onClick={history.refresh} />
        <Export data={history.data ?? []} name="command-history" />
      </PageHeading>

      <Feedback {...stations} retry={stations.refresh} />
      <Feedback {...server} retry={server.refresh} />

      {server.data && !server.data.commandsEnabled && (
        <div className="action-banner error" role="alert">
          <IconAlertTriangle size={18} />
          <span>
            {server.data.attached
              ? "Commands are disabled in this deployment."
              : "Attach the board plugin to an OCPP server to enable commands."}
          </span>
        </div>
      )}

      {/* Main Command Studio Grid (Composer & Live Response) */}
      <div className="command-studio-grid">
        {/* Left Column: Command Composer */}
        <form className="command-panel" onSubmit={(event) => void send(event)}>
          <div className="command-panel-header">
            <div className="command-panel-title">
              <IconTerminal2 size={18} className="text-primary" />
              <span>Command Composer</span>
            </div>
            {station ? (
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <Status tone="mint">
                  <IconPlug size={13} /> {station.identity}
                </Status>
                <span className="badge-tag protocol-tag">
                  {station.protocol}
                </span>
              </div>
            ) : (
              <span className="muted" style={{ fontSize: "12px" }}>
                No charger selected
              </span>
            )}
          </div>

          <div className="command-panel-body">
            {/* Quick Action Chips */}
            <div>
              <span
                className="field-label"
                style={{ display: "block", marginBottom: "6px" }}
              >
                Quick Presets
              </span>
              <div className="preset-chips-strip">
                {QUICK_PRESETS.map((qp) => (
                  <button
                    key={qp.label}
                    type="button"
                    className={cn(
                      "preset-chip-btn",
                      method === qp.method && "active",
                    )}
                    onClick={() => handleQuickPreset(qp.label)}
                  >
                    <IconSparkles size={13} />
                    <span>{qp.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Target Charger & Preset Selection Subgrid */}
            <div className="form-subgrid-2">
              <div className="field">
                <span>Target Charger</span>
                <Select
                  value={identity || null}
                  onValueChange={(val) => {
                    setIdentity(val ?? "");
                    setAcknowledged(false);
                    setError("");
                  }}
                >
                  <SelectTrigger className="w-full" aria-label="Target charger">
                    <SelectValue placeholder="Choose an online charger" />
                  </SelectTrigger>
                  <SelectContent>
                    {onlineChargers.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        No online chargers available
                      </div>
                    ) : (
                      onlineChargers.map((item) => (
                        <SelectItem key={item.identity} value={item.identity}>
                          {item.identity} ({item.protocol})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="field">
                <span>Protocol Presets</span>
                <Select
                  key={station?.protocol ?? "none"}
                  value={null}
                  onValueChange={(val) => {
                    if (val === null) return;
                    const preset = presets[Number(val)];
                    if (preset) {
                      setMethod(preset.method);
                      setPayload(JSON.stringify(preset.params, null, 2));
                      setDescription(preset.description);
                      setAcknowledged(false);
                      setError("");
                    }
                  }}
                >
                  <SelectTrigger
                    className="w-full"
                    disabled={presets.length === 0}
                    aria-label="Start from a preset"
                  >
                    <SelectValue
                      placeholder={
                        !station
                          ? "Select charger for presets"
                          : presets.length === 0
                            ? "No compatible presets"
                            : "Choose compatible preset"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {presets.map((preset, index) => (
                      <SelectItem key={preset.name} value={String(index)}>
                        {preset.name} ({preset.method})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {description && (
              <small className="muted" style={{ marginTop: "-8px" }}>
                {description}
              </small>
            )}

            {/* OCPP Action & Timeout Subgrid */}
            <div className="form-subgrid-2">
              <label className="field">
                <span>OCPP Action</span>
                <input
                  className="text-input"
                  required
                  placeholder="e.g. TriggerMessage, Reset"
                  pattern="[A-Za-z][A-Za-z0-9_.:-]{0,127}"
                  value={method}
                  onChange={(event) => {
                    setMethod(event.target.value);
                    setAcknowledged(false);
                  }}
                />
              </label>

              <div className="field">
                <span>Timeout</span>
                <div className="timeout-pills">
                  {TIMEOUT_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={cn(
                        "timeout-pill-btn",
                        timeout === opt.value && "active",
                      )}
                      onClick={() => setTimeoutMs(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Code Editor for Payload */}
            <div className="field">
              <div className="code-editor-card">
                <div className="code-editor-header">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <IconCode size={15} />
                    <span>Parameters (JSON)</span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        color: jsonStatus.valid ? "var(--mint)" : "var(--rose)",
                      }}
                    >
                      {jsonStatus.valid
                        ? `Valid (${jsonStatus.count} ${jsonStatus.count === 1 ? "field" : "fields"})`
                        : "Invalid JSON"}
                    </span>
                  </div>
                  <div className="code-editor-actions">
                    <button
                      type="button"
                      className="code-editor-btn"
                      title="Format JSON indentation"
                      onClick={handleFormatJson}
                    >
                      <IconSparkles size={13} />
                      <span>Format</span>
                    </button>
                    <button
                      type="button"
                      className="code-editor-btn"
                      title="Copy payload"
                      onClick={handleCopyPayload}
                    >
                      {copiedPayload ? (
                        <IconCheck size={13} className="text-mint" />
                      ) : (
                        <IconCopy size={13} />
                      )}
                      <span>{copiedPayload ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>
                <textarea
                  className="code-editor-textarea"
                  aria-label="Request payload"
                  required
                  spellCheck={false}
                  value={payload}
                  onChange={(event) => {
                    setPayload(event.target.value);
                    setAcknowledged(false);
                  }}
                  onKeyDown={(event) => {
                    if (
                      (event.ctrlKey || event.metaKey) &&
                      event.key === "Enter"
                    ) {
                      event.preventDefault();
                      if (
                        acknowledged &&
                        !busy &&
                        station?.status === "online"
                      ) {
                        const form = event.currentTarget.form;
                        if (form) form.requestSubmit();
                      }
                    }
                  }}
                />
              </div>
            </div>

            {/* Safety Review Callout */}
            <label className="safety-review-banner">
              <input
                type="checkbox"
                required
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <div>
                <strong>Safety Confirmation</strong>
                <p style={{ margin: 0, color: "var(--muted-foreground)" }}>
                  I reviewed the target charger and parameters. This sends an
                  immediate RPC frame to the charger.
                </p>
              </div>
            </label>

            {/* Error Banner */}
            {error && (
              <div className="message-error-callout" role="alert">
                <IconAlertCircle size={18} className="text-rose" />
                <div>
                  <strong>Command Error</strong>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {/* Submit Action */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                justifyContent: "space-between",
              }}
            >
              <button
                type="submit"
                className="button primary"
                disabled={
                  !acknowledged ||
                  busy ||
                  !server.data?.commandsEnabled ||
                  station?.status !== "online" ||
                  !jsonStatus.valid
                }
                style={{
                  padding: "10px 22px",
                  fontSize: "14px",
                  height: "40px",
                }}
              >
                {busy ? (
                  <>
                    <IconLoader2 size={17} className="animate-spin" />
                    <span>Awaiting charger response...</span>
                  </>
                ) : (
                  <>
                    <IconSend size={17} />
                    <span>Send command</span>
                  </>
                )}
              </button>
              <small className="muted">
                Tip: Press <strong>Ctrl+Enter</strong> to send
              </small>
            </div>
          </div>
        </form>

        {/* Right Column: Live Response Inspector */}
        <div className="response-inspector-card">
          <div className="response-inspector-header">
            <div className="command-panel-title">
              <IconCode size={18} className="text-primary" />
              <span>Response Inspector</span>
            </div>
            {result && (
              <div
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <Status tone={result.status === "succeeded" ? "mint" : "rose"}>
                  {result.status}
                </Status>
                {result.durationMs != null && (
                  <span className="badge-tag flex items-center justify-center gap-1 latency-tag">
                    <IconClock size={12} />
                    {result.durationMs} ms
                  </span>
                )}
                <button
                  type="button"
                  className="action-toolbar-btn"
                  title="Copy response JSON"
                  onClick={handleCopyResponse}
                >
                  {copiedResponse ? (
                    <IconCheck size={14} className="text-mint" />
                  ) : (
                    <IconCopy size={14} />
                  )}
                  <span>{copiedResponse ? "Copied" : "Copy"}</span>
                </button>
              </div>
            )}
          </div>

          {busy ? (
            <div
              style={{
                padding: "60px 20px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "14px",
                textAlign: "center",
              }}
            >
              <IconLoader2 size={36} className="animate-spin text-primary" />
              <div>
                <strong style={{ fontSize: "15px", display: "block" }}>
                  Waiting for response from {identity}...
                </strong>
                <p
                  className="muted"
                  style={{ margin: "4px 0 0", fontSize: "13px" }}
                >
                  Sent action <strong>{method}</strong>. Timeout in{" "}
                  {timeout / 1000}s.
                </p>
              </div>
            </div>
          ) : result ? (
            <>
              {/* Summary Strip */}
              <div className="response-summary-strip">
                <div className="response-summary-item">
                  <span className="response-summary-label">Target Charger</span>
                  <Link
                    to={`/connection/view/${encodeURIComponent(result.identity)}`}
                    className="station-link"
                    style={{ fontSize: "13px" }}
                  >
                    {result.identity}
                  </Link>
                </div>
                <div className="response-summary-item">
                  <span className="response-summary-label">Action</span>
                  <strong style={{ fontSize: "13px" }}>{result.method}</strong>
                </div>
                <div className="response-summary-item">
                  <span className="response-summary-label">Round Trip</span>
                  <span
                    style={{ fontSize: "13px", fontFamily: "var(--font-mono)" }}
                  >
                    {result.durationMs ?? 0} ms
                  </span>
                </div>
                <div className="response-summary-item">
                  <span className="response-summary-label">Operator</span>
                  <span className="muted" style={{ fontSize: "13px" }}>
                    {result.operator}
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="response-body-panel">
                {result.error && (
                  <div className="message-error-callout" role="alert">
                    <IconAlertCircle size={18} className="text-rose" />
                    <div>
                      <strong>RPC Execution Error</strong>
                      <p>{result.error}</p>
                    </div>
                  </div>
                )}

                <div className="message-payload-card">
                  <JsonView
                    value={
                      result.result ??
                      (result.error ? { error: result.error } : null)
                    }
                  />
                </div>

                <p
                  className="table-note"
                  style={{ margin: 0, fontSize: "12px" }}
                >
                  A succeeded status indicates the OCPP remote frame arrived and
                  answered. Inspect the inner payload to verify if the charger
                  accepted or rejected the operation.
                </p>
              </div>
            </>
          ) : (
            <div style={{ padding: "40px 20px" }}>
              <Empty title="Ready to send">
                Choose a charger, compose parameters, and send. Live execution
                details and returned JSON payloads will appear here.
              </Empty>
            </div>
          )}
        </div>
      </div>

      {/* Command History Section */}
      <div className="section-heading" style={{ marginTop: "16px" }}>
        <div>
          <h2>Command history</h2>
          <span className="muted">
            Recent RPC requests sent in this session
          </span>
        </div>
      </div>

      {/* Toolbar for History */}
      <div className="toolbar">
        <Search
          value={historySearch}
          onChange={(val) => {
            setHistorySearch(val);
            setHistoryPage(0);
          }}
          placeholder="Filter by charger, action, or operator..."
        />
        <Select
          value={historyStatus}
          onValueChange={(val) => {
            setHistoryStatus(val ?? "all");
            setHistoryPage(0);
          }}
        >
          <SelectTrigger className="w-36.25" aria-label="Filter status">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="succeeded">Succeeded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Interactive Command History Table */}
      <div className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th
                  className="expand-indicator-cell"
                  aria-label="Expand indicator"
                />
                <th>Time</th>
                <th>Charger</th>
                <th>Action</th>
                <th>Operator</th>
                <th>Duration</th>
                <th>Outcome</th>
                <th className="actions-cell">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredHistory
                .slice(
                  historyPage * historyPageSize,
                  historyPage * historyPageSize + historyPageSize,
                )
                .map((entry) => {
                  const isExpanded = expandedHistoryIds.has(entry.id);

                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className={cn(
                          "table-row-clickable",
                          isExpanded && "is-expanded",
                        )}
                        tabIndex={0}
                        role="button"
                        aria-expanded={isExpanded}
                        aria-label={`Command ${entry.method} on ${entry.identity}, click to ${isExpanded ? "collapse" : "expand"}`}
                        onClick={() => toggleHistoryExpand(entry.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleHistoryExpand(entry.id);
                          }
                        }}
                      >
                        <td className="expand-indicator-cell">
                          <button
                            type="button"
                            className="expand-toggle-btn"
                            aria-label={
                              isExpanded ? "Collapse row" : "Expand row"
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleHistoryExpand(entry.id);
                            }}
                          >
                            {isExpanded ? (
                              <IconChevronDown size={15} />
                            ) : (
                              <IconChevronRight size={15} />
                            )}
                          </button>
                        </td>
                        <td className="nowrap muted">
                          {time(entry.timestamp)}
                        </td>
                        <td>
                          <Link
                            to={`/connection/view/${encodeURIComponent(entry.identity)}`}
                            className="station-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {entry.identity}
                          </Link>
                        </td>
                        <td>
                          <strong>{entry.method}</strong>
                        </td>
                        <td className="muted">{entry.operator}</td>
                        <td className="muted nowrap">
                          {entry.durationMs != null
                            ? `${entry.durationMs} ms`
                            : "—"}
                        </td>
                        <td>
                          <Status
                            tone={
                              entry.status === "failed"
                                ? "rose"
                                : entry.status === "succeeded"
                                  ? "mint"
                                  : "yellow"
                            }
                          >
                            {entry.status}
                          </Status>
                        </td>
                        <td
                          className="actions-cell"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="row-actions">
                            <button
                              type="button"
                              className="action-btn"
                              title="Load into composer"
                              aria-label="Load into composer"
                              onClick={() => handleLoadIntoComposer(entry)}
                            >
                              <IconArrowBackUp size={16} />
                            </button>
                            <button
                              type="button"
                              className="action-btn"
                              title="Copy response JSON"
                              aria-label="Copy response JSON"
                              onClick={() => handleCopyHistory(entry)}
                            >
                              {copiedHistoryId === entry.id ? (
                                <IconCheck size={16} className="text-mint" />
                              ) : (
                                <IconCopy size={16} />
                              )}
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                className="action-btn"
                                aria-label="More history actions"
                                title="More actions"
                              >
                                <IconDotsVertical size={16} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                className="charger-actions-menu"
                              >
                                <DropdownMenuLabel>
                                  {entry.method} ({entry.identity})
                                </DropdownMenuLabel>
                                <DropdownMenuItem
                                  onClick={() => handleLoadIntoComposer(entry)}
                                >
                                  <IconArrowBackUp size={15} />
                                  Load into composer
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleCopyHistory(entry)}
                                >
                                  <IconCopy size={15} />
                                  Copy response payload
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem>
                                  <Link
                                    to={`/connection/view/${encodeURIComponent(entry.identity)}`}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: "8px",
                                      color: "inherit",
                                      textDecoration: "none",
                                    }}
                                  >
                                    <IconPlug size={15} />
                                    View charger
                                  </Link>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded View for History Entry */}
                      {isExpanded && (
                        <tr
                          key={`${entry.id}-expanded`}
                          className="expanded-row"
                        >
                          <td colSpan={8} className="expanded-cell">
                            <div className="message-expanded-panel">
                              {/* Header Meta */}
                              <div className="message-expanded-header">
                                <div className="message-badge-group">
                                  <Status
                                    tone={
                                      entry.status === "failed"
                                        ? "rose"
                                        : entry.status === "succeeded"
                                          ? "mint"
                                          : "yellow"
                                    }
                                  >
                                    {entry.status}
                                  </Status>
                                  <span className="meta-pill">
                                    <span className="meta-pill-label">
                                      Protocol:
                                    </span>
                                    <strong className="meta-pill-value">
                                      {entry.protocol}
                                    </strong>
                                  </span>
                                  {entry.durationMs != null && (
                                    <span className="meta-pill">
                                      <IconClock size={12} />
                                      <span className="meta-pill-label">
                                        Duration:
                                      </span>
                                      <strong className="meta-pill-value">
                                        {entry.durationMs} ms
                                      </strong>
                                    </span>
                                  )}
                                  <span className="meta-pill">
                                    <span className="meta-pill-label">
                                      Operator:
                                    </span>
                                    <strong className="meta-pill-value">
                                      {entry.operator}
                                    </strong>
                                  </span>
                                </div>
                                <div className="message-header-time muted">
                                  <span>
                                    {new Date(entry.timestamp).toLocaleString()}
                                  </span>
                                </div>
                              </div>

                              {/* Action Bar */}
                              <div className="message-action-toolbar">
                                <div className="action-toolbar-title">
                                  <IconTerminal2 size={15} />
                                  <span>Execution Inspection</span>
                                </div>
                                <div className="action-toolbar-buttons">
                                  <button
                                    type="button"
                                    className="button button-sm action-toolbar-btn primary"
                                    onClick={() =>
                                      handleLoadIntoComposer(entry)
                                    }
                                  >
                                    <IconArrowBackUp size={14} />
                                    <span>Load into composer</span>
                                  </button>
                                  <button
                                    type="button"
                                    className="button button-sm action-toolbar-btn"
                                    onClick={() => handleCopyHistory(entry)}
                                  >
                                    {copiedHistoryId === entry.id ? (
                                      <>
                                        <IconCheck
                                          size={14}
                                          className="text-mint"
                                        />
                                        <span>Copied JSON</span>
                                      </>
                                    ) : (
                                      <>
                                        <IconCopy size={14} />
                                        <span>Copy JSON</span>
                                      </>
                                    )}
                                  </button>
                                  <Link
                                    className="button button-sm action-toolbar-btn"
                                    to={`/connection/view/${encodeURIComponent(entry.identity)}`}
                                  >
                                    <IconPlug size={14} />
                                    <span>View charger</span>
                                  </Link>
                                </div>
                              </div>

                              {/* Side-by-side Request Params & Response */}
                              <div className="command-history-expanded">
                                <div className="history-expanded-block">
                                  <div className="history-expanded-block-title">
                                    <span>Request Parameters</span>
                                  </div>
                                  <div className="message-payload-card">
                                    <JsonView value={entry.params} />
                                  </div>
                                </div>

                                <div className="history-expanded-block">
                                  <div className="history-expanded-block-title">
                                    <span>Response Outcome</span>
                                  </div>
                                  {entry.error && (
                                    <div
                                      className="message-error-callout"
                                      role="alert"
                                      style={{ marginBottom: "8px" }}
                                    >
                                      <IconAlertCircle
                                        size={16}
                                        className="text-rose"
                                      />
                                      <div>
                                        <strong>Failed</strong>
                                        <p>{entry.error}</p>
                                      </div>
                                    </div>
                                  )}
                                  <div className="message-payload-card">
                                    <JsonView
                                      value={
                                        entry.result ??
                                        (entry.error
                                          ? { error: entry.error }
                                          : null)
                                      }
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
            </tbody>
          </table>
        </div>

        {!filteredHistory.length && (
          <Empty title="No commands to show">
            Commands sent to chargers will appear here with timing and results.
          </Empty>
        )}

        <Pagination
          page={historyPage}
          count={filteredHistory.length}
          size={historyPageSize}
          onChange={setHistoryPage}
          onPageSizeChange={setHistoryPageSize}
        />
      </div>
    </>
  );
}
