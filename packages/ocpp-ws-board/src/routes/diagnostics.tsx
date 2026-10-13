import {
  IconActivity,
  IconAlertCircle,
  IconAlertTriangle,
  IconBug,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconCpu,
  IconFilter,
  IconHistory,
  IconPlug,
  IconServer,
  IconX,
} from "@tabler/icons-react";
import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
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
import { time } from "@/lib/export";
import type { ErrorRecord, JsonValue, SystemEvent } from "@/types";

const ERROR_CATEGORY_OPTIONS: Record<string, string> = {
  all: "All error categories",
  BAD_MESSAGE: "Bad Message Format",
  VALIDATION_FAILURE: "Validation Failure",
  HANDLER_ERROR: "Handler Exception",
  PROTOCOL_ERROR: "Protocol Error",
  UNKNOWN: "Unknown Error",
};

const SYSTEM_EVENT_OPTIONS: Record<string, string> = {
  all: "All lifecycle types",
  EVICTION: "Connection Eviction",
  BACKPRESSURE: "WebSocket Backpressure",
  PONG_TIMEOUT: "Heartbeat Pong Timeout",
  RECONFIGURE: "Server Reconfiguration",
  SHUTDOWN: "Clean Shutdown",
  TLS_UPDATE: "TLS Certificate Update",
};

export default function DiagnosticsPage() {
  const [query, setQuery] = useSearchParams();
  const system = query.get("tab") === "system";

  const errors = useResource<{ errors: ErrorRecord[]; totalCount: number }>(
    "/errors?limit=1000",
    5000,
  );
  const events = useResource<SystemEvent[]>("/system-events?limit=1000", 5000);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [preset, setPreset] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);

  // Kept across renders: a new `[]` each render would rerun every memo below.
  const rawErrors = useMemo(
    () => errors.data?.errors ?? [],
    [errors.data?.errors],
  );
  const rawEvents = useMemo(() => events.data ?? [], [events.data]);

  // Error KPI metrics
  const errorStats = useMemo(() => {
    let validation = 0;
    let protocol = 0;
    let handler = 0;
    const chargers = new Set<string>();

    for (const err of rawErrors) {
      if (err.category === "VALIDATION_FAILURE") validation += 1;
      if (err.category === "PROTOCOL_ERROR" || err.category === "BAD_MESSAGE")
        protocol += 1;
      if (err.category === "HANDLER_ERROR") handler += 1;
      if (err.identity) chargers.add(err.identity);
    }

    return {
      total: errors.data?.totalCount ?? rawErrors.length,
      validation,
      protocol,
      handler,
      chargersCount: chargers.size,
    };
  }, [rawErrors, errors.data?.totalCount]);

  // System Event KPI metrics
  const systemStats = useMemo(() => {
    let evictionsTimeouts = 0;
    let reconfigsTls = 0;
    let shutdowns = 0;

    for (const ev of rawEvents) {
      if (ev.type === "EVICTION" || ev.type === "PONG_TIMEOUT")
        evictionsTimeouts += 1;
      if (ev.type === "RECONFIGURE" || ev.type === "TLS_UPDATE")
        reconfigsTls += 1;
      if (ev.type === "SHUTDOWN") shutdowns += 1;
    }

    return {
      total: rawEvents.length,
      evictionsTimeouts,
      reconfigsTls,
      shutdowns,
    };
  }, [rawEvents]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (system) {
      return rawEvents.filter((ev) => {
        // Preset
        if (
          preset === "evictions" &&
          ev.type !== "EVICTION" &&
          ev.type !== "PONG_TIMEOUT"
        )
          return false;
        if (
          preset === "reconfig" &&
          ev.type !== "RECONFIGURE" &&
          ev.type !== "TLS_UPDATE"
        )
          return false;
        if (preset === "shutdown" && ev.type !== "SHUTDOWN") return false;

        // Type filter
        if (typeFilter && ev.type !== typeFilter) return false;

        // URL identity filter
        if (query.get("identity") && ev.identity !== query.get("identity"))
          return false;

        // Search text
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          const str =
            `${ev.identity ?? "server"} ${ev.type} ${ev.message} ${JSON.stringify(ev.details ?? {})}`.toLowerCase();
          if (!str.includes(q)) return false;
        }

        return true;
      });
    }

    return rawErrors.filter((err) => {
      // Preset
      if (preset === "validation" && err.category !== "VALIDATION_FAILURE")
        return false;
      if (
        preset === "protocol" &&
        err.category !== "PROTOCOL_ERROR" &&
        err.category !== "BAD_MESSAGE"
      )
        return false;
      if (preset === "handler" && err.category !== "HANDLER_ERROR")
        return false;

      // Category filter
      if (categoryFilter && err.category !== categoryFilter) return false;

      // URL identity filter
      if (query.get("identity") && err.identity !== query.get("identity"))
        return false;

      // Search text
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const str =
          `${err.identity ?? "server"} ${err.category} ${err.message} ${err.method ?? ""} ${err.stack ?? ""}`.toLowerCase();
        if (!str.includes(q)) return false;
      }

      return true;
    });
  }, [
    system,
    rawEvents,
    rawErrors,
    preset,
    typeFilter,
    categoryFilter,
    query,
    search,
  ]);

  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredRows.length / pageSize) - 1),
  );

  const pagedRows = useMemo(() => {
    const start = currentPage * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, currentPage, pageSize]);

  const handleCopyJson = (
    data: JsonValue | ErrorRecord | SystemEvent,
    id: string,
  ) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 2000);
  };

  const handleClearFilters = () => {
    setSearch("");
    setCategoryFilter("");
    setTypeFilter("");
    setPreset("all");
    const next = new URLSearchParams(query);
    next.delete("identity");
    setQuery(next);
    setPage(0);
  };

  const hasActiveFilters =
    search ||
    categoryFilter ||
    typeFilter ||
    preset !== "all" ||
    Boolean(query.get("identity"));

  const resource = system ? events : errors;

  return (
    <>
      <PageHeading
        title="Diagnostics & system trace"
        description="Investigate protocol validation failures, WebSocket network drops, and host runtime lifecycle events."
      >
        <Status
          tone={system ? "lavender" : errorStats.total > 0 ? "rose" : "mint"}
        >
          {system
            ? `${systemStats.total} Lifecycle Events`
            : errorStats.total > 0
              ? `${errorStats.total} Protocol Errors`
              : "Zero errors recorded"}
        </Status>
        <Refresh onClick={resource.refresh} />
        <Export
          name={system ? "system-events" : "errors"}
          data={filteredRows}
        />
      </PageHeading>

      <Feedback {...resource} retry={resource.refresh} />

      {/* ── Operational View Switcher (Tabs) ─────────────────────── */}
      <div
        className="messages-view-tabs"
        role="tablist"
        aria-label="Diagnostic mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!system}
          className={`messages-view-tab ${!system ? "is-active" : ""}`}
          onClick={() => {
            const next = new URLSearchParams(query);
            next.delete("tab");
            setQuery(next);
            setPreset("all");
            setPage(0);
          }}
        >
          <IconBug size={16} />
          <span>Errors & exceptions</span>
          <span
            className={`messages-tab-badge ${rawErrors.length > 0 ? "badge-rose" : ""}`}
          >
            {rawErrors.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={system}
          className={`messages-view-tab ${system ? "is-active" : ""}`}
          onClick={() => {
            const next = new URLSearchParams(query);
            next.set("tab", "system");
            setQuery(next);
            setPreset("all");
            setPage(0);
          }}
        >
          <IconHistory size={16} />
          <span>Server lifecycle events</span>
          <span className="messages-tab-badge">{rawEvents.length}</span>
        </button>
      </div>

      {/* ── Contextual KPI Summary Strip ─────────────────────────── */}
      {!system ? (
        <div className="security-kpi-grid">
          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconAlertTriangle
                  size={16}
                  className={errorStats.total > 0 ? "text-rose" : "text-mint"}
                />
                <span>Total error records</span>
              </div>
              <span
                className={`telemetry-kpi-tag ${errorStats.total > 0 ? "tag-rose" : "tag-mint"}`}
              >
                {errorStats.total > 0 ? "Active issues" : "Clean state"}
              </span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value text-rose">
                {errorStats.total}
              </span>
              <span className="security-kpi-card-unit">observed errors</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>{errorStats.chargersCount} faulting chargers</span>
            </div>
          </div>

          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconAlertCircle size={16} className="text-amber" />
                <span>Validation failures</span>
              </div>
              <span className="telemetry-kpi-tag">{errorStats.validation}</span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value">
                {errorStats.validation}
              </span>
              <span className="security-kpi-card-unit">schema errors</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>OCPP JSON Schema mismatch</span>
              {errorStats.validation > 0 && (
                <button
                  type="button"
                  className="security-card-action"
                  onClick={() => {
                    setPreset("validation");
                    setPage(0);
                  }}
                >
                  Filter validation →
                </button>
              )}
            </div>
          </div>

          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconServer size={16} className="text-blue" />
                <span>Protocol errors</span>
              </div>
              <span className="telemetry-kpi-tag">{errorStats.protocol}</span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value">
                {errorStats.protocol}
              </span>
              <span className="security-kpi-card-unit">framing errors</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>CALLERROR & bad frames</span>
              {errorStats.protocol > 0 && (
                <button
                  type="button"
                  className="security-card-action"
                  onClick={() => {
                    setPreset("protocol");
                    setPage(0);
                  }}
                >
                  Filter protocol →
                </button>
              )}
            </div>
          </div>

          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconBug size={16} className="text-teal" />
                <span>Handler exceptions</span>
              </div>
              <span className="telemetry-kpi-tag">{errorStats.handler}</span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value">
                {errorStats.handler}
              </span>
              <span className="security-kpi-card-unit">runtime faults</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>Internal dispatch errors</span>
              {errorStats.handler > 0 && (
                <button
                  type="button"
                  className="security-card-action"
                  onClick={() => {
                    setPreset("handler");
                    setPage(0);
                  }}
                >
                  Filter handlers →
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="security-kpi-grid">
          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconHistory size={16} className="text-blue" />
                <span>Total lifecycle events</span>
              </div>
              <span className="telemetry-kpi-tag tag-mint">Recorded</span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value">
                {systemStats.total}
              </span>
              <span className="security-kpi-card-unit">audit entries</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>Real-time host activity</span>
            </div>
          </div>

          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconActivity size={16} className="text-amber" />
                <span>Evictions & timeouts</span>
              </div>
              <span className="telemetry-kpi-tag">
                {systemStats.evictionsTimeouts}
              </span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value">
                {systemStats.evictionsTimeouts}
              </span>
              <span className="security-kpi-card-unit">disconnects</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>Pong timeout / evictions</span>
              {systemStats.evictionsTimeouts > 0 && (
                <button
                  type="button"
                  className="security-card-action"
                  onClick={() => {
                    setPreset("evictions");
                    setPage(0);
                  }}
                >
                  Filter evictions →
                </button>
              )}
            </div>
          </div>

          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconCpu size={16} className="text-teal" />
                <span>Reconfigs & TLS</span>
              </div>
              <span className="telemetry-kpi-tag">
                {systemStats.reconfigsTls}
              </span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value">
                {systemStats.reconfigsTls}
              </span>
              <span className="security-kpi-card-unit">runtime changes</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>Config reloads & TLS</span>
              {systemStats.reconfigsTls > 0 && (
                <button
                  type="button"
                  className="security-card-action"
                  onClick={() => {
                    setPreset("reconfig");
                    setPage(0);
                  }}
                >
                  Filter reconfigs →
                </button>
              )}
            </div>
          </div>

          <div className="security-kpi-card">
            <div className="security-kpi-card-header">
              <div className="security-kpi-card-title">
                <IconServer size={16} className="text-lavender" />
                <span>Shutdowns & clean exits</span>
              </div>
              <span className="telemetry-kpi-tag">{systemStats.shutdowns}</span>
            </div>
            <div className="security-kpi-card-body">
              <span className="security-kpi-card-value">
                {systemStats.shutdowns}
              </span>
              <span className="security-kpi-card-unit">server stops</span>
            </div>
            <div className="security-kpi-card-footer">
              <span>Clean termination traces</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Filter Studio ────────────────────────────────────────── */}
      <div className="messages-filter-card">
        {/* Presets */}
        <div className="messages-preset-strip">
          <span className="preset-strip-label">
            <IconFilter size={13} /> Presets:
          </span>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "all" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("all");
              setPage(0);
            }}
          >
            All {!system ? "errors" : "events"}
          </button>
          {!system ? (
            <>
              <button
                type="button"
                className={`messages-preset-chip ${preset === "validation" ? "is-active" : ""}`}
                onClick={() => {
                  setPreset("validation");
                  setPage(0);
                }}
              >
                Validation failures
              </button>
              <button
                type="button"
                className={`messages-preset-chip ${preset === "protocol" ? "is-active" : ""}`}
                onClick={() => {
                  setPreset("protocol");
                  setPage(0);
                }}
              >
                Protocol errors
              </button>
              <button
                type="button"
                className={`messages-preset-chip ${preset === "handler" ? "is-active" : ""}`}
                onClick={() => {
                  setPreset("handler");
                  setPage(0);
                }}
              >
                Handler faults
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`messages-preset-chip ${preset === "evictions" ? "is-active" : ""}`}
                onClick={() => {
                  setPreset("evictions");
                  setPage(0);
                }}
              >
                Evictions & timeouts
              </button>
              <button
                type="button"
                className={`messages-preset-chip ${preset === "reconfig" ? "is-active" : ""}`}
                onClick={() => {
                  setPreset("reconfig");
                  setPage(0);
                }}
              >
                Reconfigs & TLS
              </button>
              <button
                type="button"
                className={`messages-preset-chip ${preset === "shutdown" ? "is-active" : ""}`}
                onClick={() => {
                  setPreset("shutdown");
                  setPage(0);
                }}
              >
                Shutdowns
              </button>
            </>
          )}
        </div>

        {/* Controls Toolbar */}
        <div className="messages-filter-toolbar">
          <div className="flex-1 min-w-56">
            <Search
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              placeholder={`Search ${!system ? "errors, methods, stacks..." : "lifecycle messages, details..."}`}
            />
          </div>

          {!system ? (
            <Select
              value={categoryFilter || "all"}
              onValueChange={(val) => {
                setCategoryFilter(val === "all" ? "" : (val ?? ""));
                setPage(0);
              }}
            >
              <SelectTrigger
                className="w-48 text-xs"
                aria-label="Error category"
              >
                <SelectValue className={"capitalize"} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ERROR_CATEGORY_OPTIONS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select
              value={typeFilter || "all"}
              onValueChange={(val) => {
                setTypeFilter(val === "all" ? "" : (val ?? ""));
                setPage(0);
              }}
            >
              <SelectTrigger
                className="w-48 text-xs"
                aria-label="Lifecycle event type"
              >
                <SelectValue className={"capitalize"} />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SYSTEM_EVENT_OPTIONS).map(([k, label]) => (
                  <SelectItem key={k} value={k}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {hasActiveFilters && (
            <button
              type="button"
              className="button secondary sm"
              onClick={handleClearFilters}
              title="Reset all filters"
            >
              <IconX size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Filtered Charger Banner */}
      {query.get("identity") && (
        <div className="active-filter-banner" role="region">
          <div className="active-filter-content">
            <div className="active-filter-label">
              <IconPlug size={16} />
              <span>Target charger filter:</span>
              <strong>{query.get("identity")}</strong>
            </div>
          </div>
          <button
            type="button"
            className="filter-clear-btn"
            onClick={() => {
              const next = new URLSearchParams(query);
              next.delete("identity");
              setQuery(next);
            }}
          >
            <IconX size={14} /> Clear charger
          </button>
        </div>
      )}

      {/* ── Table Panel with Clickable Expandable Rows ───────────── */}
      <div className="table-panel">
        <div className="table-scroll">
          <table className="telemetry-sample-table">
            <thead>
              <tr>
                <th className="w-10" aria-label="Expand" />
                <th>Time</th>
                <th>Charger</th>
                <th>Category / Type</th>
                <th>Message</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => {
                const isExpanded = expandedId === row.id;
                const isError = "category" in row;

                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`telemetry-sample-row ${isExpanded ? "is-expanded" : ""}`}
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                    >
                      <td className="w-10 text-muted-foreground">
                        {isExpanded ? (
                          <IconChevronUp size={16} />
                        ) : (
                          <IconChevronDown size={16} />
                        )}
                      </td>
                      <td className="muted nowrap">{time(row.timestamp)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {row.identity ? (
                          <Link
                            to={`/connection/view/${encodeURIComponent(row.identity)}`}
                            className="font-mono text-xs font-semibold text-foreground hover:underline"
                          >
                            {row.identity}
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Server
                          </span>
                        )}
                      </td>
                      <td>
                        <Status tone={isError ? "rose" : "lavender"}>
                          {(isError ? row.category : row.type).replaceAll(
                            "_",
                            " ",
                          )}
                        </Status>
                      </td>
                      <td>
                        <span className="text-xs text-foreground font-medium">
                          {row.message}
                        </span>
                      </td>
                      <td
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          {row.identity && (
                            <Link
                              to={`/messages?identity=${encodeURIComponent(row.identity)}`}
                              className="button secondary sm"
                              title="Inspect messages for charger"
                            >
                              Traffic
                            </Link>
                          )}
                          <button
                            type="button"
                            className="button secondary sm"
                            onClick={() => handleCopyJson(row, row.id)}
                            title="Copy diagnostic record JSON"
                          >
                            {copiedId === row.id ? (
                              <>
                                <IconCheck size={12} className="text-mint" />{" "}
                                Copied
                              </>
                            ) : (
                              <>
                                <IconCopy size={12} /> Copy
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${row.id}-expanded`} className="expanded-row">
                        <td colSpan={6} className="expanded-cell">
                          <div className="telemetry-sample-expanded-card m-0! mt-2!">
                            <div className="telemetry-sample-expanded-header">
                              <div className="flex items-center gap-2">
                                {isError ? (
                                  <IconBug size={16} className="text-rose" />
                                ) : (
                                  <IconHistory
                                    size={16}
                                    className="text-blue"
                                  />
                                )}
                                <strong>
                                  {isError
                                    ? `Error Record (${row.category})`
                                    : `Lifecycle Event (${row.type})`}{" "}
                                  — {row.identity || "Server"}
                                </strong>
                              </div>
                              <button
                                type="button"
                                className="button secondary sm"
                                onClick={() =>
                                  handleCopyJson(row, `full-${row.id}`)
                                }
                              >
                                {copiedId === `full-${row.id}` ? (
                                  <>
                                    <IconCheck
                                      size={12}
                                      className="text-mint"
                                    />{" "}
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <IconCopy size={12} /> Copy record
                                  </>
                                )}
                              </button>
                            </div>

                            <div className="p-3 bg-muted/40 rounded-lg text-xs font-medium mb-3">
                              {row.message}
                            </div>

                            {/* Render Stack trace in clean monospace code block if present */}
                            {isError && (row as ErrorRecord).stack && (
                              <div className="mb-3">
                                <div className="text-[11px] font-semibold text-muted-foreground uppercase mb-1">
                                  Stack Trace
                                </div>
                                <pre className="p-3 bg-background border border-border rounded-lg text-xs font-mono overflow-x-auto text-rose/90 whitespace-pre-wrap">
                                  {(row as ErrorRecord).stack}
                                </pre>
                              </div>
                            )}

                            <JsonView
                              value={
                                (!isError
                                  ? (row as SystemEvent).details
                                  : undefined) ?? row
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {!resource.loading && filteredRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted text-center py-10">
                    <div className="empty-state-card text-center">
                      <IconCheck size={32} className="text-mint mx-auto mb-2" />
                      <h3>No diagnostic records found</h3>
                      <p className="text-muted-foreground text-xs">
                        {hasActiveFilters
                          ? "No records match the current filter criteria."
                          : !system
                            ? "Zero runtime exceptions or protocol validation failures recorded."
                            : "Host lifecycle events will appear as configuration or connection shifts occur."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredRows.length > 0 && (
          <Pagination
            page={currentPage}
            count={filteredRows.length}
            size={pageSize}
            onChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>

      <p className="table-note">
        Showing retained {system ? "lifecycle" : "error"} records in memory.
        Refreshes every 5 seconds.
      </p>
    </>
  );
}
