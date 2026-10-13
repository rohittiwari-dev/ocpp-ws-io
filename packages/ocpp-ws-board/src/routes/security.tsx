import {
  IconAlertTriangle,
  IconBan,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconFilter,
  IconFingerprint,
  IconShieldCheck,
  IconShieldExclamation,
  IconShieldLock,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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
import type { JsonValue, SecurityEventRecord } from "@/types";

type SecurityPreset =
  | "all"
  | "critical_high"
  | "auth"
  | "rate_limit"
  | "protocol";

const SEVERITY_OPTIONS: Record<string, string> = {
  all: "All severities",
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const CATEGORY_OPTIONS: Record<string, string> = {
  all: "All categories",
  AUTH_FAILED: "Authentication Failed",
  RATE_LIMIT: "Rate Limit Exceeded",
  ANOMALY: "Security Anomaly",
  PROTOCOL_VIOLATION: "Protocol Violation",
  POLICY_REJECTION: "Policy Rejection",
};

export default function SecurityPage() {
  const resource = useResource<{
    events: SecurityEventRecord[];
    totalCount: number;
  }>("/security-events?limit=1000", 5000);

  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [preset, setPreset] = useState<SecurityPreset>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);

  // Kept across renders: a new `[]` each render would rerun every memo below.
  const rawEvents = useMemo(
    () => resource.data?.events ?? [],
    [resource.data?.events],
  );

  // Security KPI metrics
  const stats = useMemo(() => {
    let criticalHigh = 0;
    let authFailed = 0;
    let rateLimits = 0;
    const chargers = new Set<string>();

    for (const evt of rawEvents) {
      if (evt.severity === "critical" || evt.severity === "high") {
        criticalHigh += 1;
      }
      if (evt.category === "AUTH_FAILED") {
        authFailed += 1;
      }
      if (evt.category === "RATE_LIMIT" || evt.category === "ANOMALY") {
        rateLimits += 1;
      }
      if (evt.identity) {
        chargers.add(evt.identity);
      }
    }

    return {
      total: resource.data?.totalCount ?? rawEvents.length,
      criticalHigh,
      authFailed,
      rateLimits,
      chargersCount: chargers.size,
    };
  }, [rawEvents, resource.data?.totalCount]);

  // Filter events
  const filteredEvents = useMemo(() => {
    return rawEvents.filter((event) => {
      // Preset chips
      if (
        preset === "critical_high" &&
        event.severity !== "critical" &&
        event.severity !== "high"
      )
        return false;
      if (preset === "auth" && event.category !== "AUTH_FAILED") return false;
      if (
        preset === "rate_limit" &&
        event.category !== "RATE_LIMIT" &&
        event.category !== "ANOMALY"
      )
        return false;
      if (
        preset === "protocol" &&
        event.category !== "PROTOCOL_VIOLATION" &&
        event.category !== "POLICY_REJECTION"
      )
        return false;

      // Dropdown filters
      if (severity && event.severity !== severity) return false;
      if (category && event.category !== category) return false;

      // Search query
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const text =
          `${event.identity} ${event.category} ${event.message} ${event.severity} ${JSON.stringify(event.details ?? {})}`.toLowerCase();
        if (!text.includes(q)) return false;
      }

      return true;
    });
  }, [rawEvents, preset, severity, category, search]);

  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filteredEvents.length / pageSize) - 1),
  );

  const pagedEvents = useMemo(() => {
    const start = currentPage * pageSize;
    return filteredEvents.slice(start, start + pageSize);
  }, [filteredEvents, currentPage, pageSize]);

  const handleCopyJson = (
    data: JsonValue | SecurityEventRecord,
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
    setSeverity("");
    setCategory("");
    setPreset("all");
    setPage(0);
  };

  const hasActiveFilters = search || severity || category || preset !== "all";

  return (
    <>
      <PageHeading
        title="Security events & audit"
        description="Monitor authentication, rate limits, protocol violations, and TLS security profile events."
      >
        <Status tone={stats.criticalHigh > 0 ? "rose" : "mint"}>
          <span
            className={`telemetry-live-dot ${stats.criticalHigh > 0 ? "is-live" : ""}`}
            style={
              stats.criticalHigh > 0
                ? { backgroundColor: "var(--rose)" }
                : undefined
            }
          />
          {stats.criticalHigh > 0
            ? `${stats.criticalHigh} Critical / High Alerts`
            : "Security policies active"}
        </Status>
        <Refresh onClick={resource.refresh} />
        <Export data={filteredEvents} name="security-events" />
      </PageHeading>

      <Feedback {...resource} retry={resource.refresh} />

      {/* ── Security KPI Summary Strip ───────────────────────────── */}
      <div className="security-kpi-grid">
        <div className="security-kpi-card">
          <div className="security-kpi-card-header">
            <div className="security-kpi-card-title">
              <IconShieldLock size={16} className="text-blue" />
              <span>Total audit events</span>
            </div>
            <span className="telemetry-kpi-tag">{stats.total} total</span>
          </div>
          <div className="security-kpi-card-body">
            <span className="security-kpi-card-value">{stats.total}</span>
            <span className="security-kpi-card-unit">retained events</span>
          </div>
          <div className="security-kpi-card-footer">
            <span>5-second auto refresh</span>
            <span className="text-muted-foreground">
              {stats.chargersCount} chargers monitored
            </span>
          </div>
        </div>

        <div className="security-kpi-card">
          <div className="security-kpi-card-header">
            <div className="security-kpi-card-title">
              <IconAlertTriangle
                size={16}
                className={stats.criticalHigh > 0 ? "text-rose" : "text-mint"}
              />
              <span>Critical & High alerts</span>
            </div>
            <span
              className={`telemetry-kpi-tag ${stats.criticalHigh > 0 ? "tag-rose" : "tag-mint"}`}
            >
              {stats.criticalHigh > 0 ? "Requires review" : "Nominal"}
            </span>
          </div>
          <div className="security-kpi-card-body">
            <span
              className={`security-kpi-card-value ${stats.criticalHigh > 0 ? "text-rose" : "text-foreground"}`}
            >
              {stats.criticalHigh}
            </span>
            <span className="security-kpi-card-unit">severe incidents</span>
          </div>
          <div className="security-kpi-card-footer">
            <span>Priority triage items</span>
            {stats.criticalHigh > 0 && (
              <button
                type="button"
                className="security-card-action"
                onClick={() => {
                  setPreset("critical_high");
                  setPage(0);
                }}
              >
                Filter alerts →
              </button>
            )}
          </div>
        </div>

        <div className="security-kpi-card">
          <div className="security-kpi-card-header">
            <div className="security-kpi-card-title">
              <IconFingerprint size={16} className="text-amber" />
              <span>Authentication failures</span>
            </div>
            <span
              className={`telemetry-kpi-tag ${stats.authFailed > 0 ? "tag-amber" : "tag-mint"}`}
            >
              {stats.authFailed > 0 ? "Auth errors" : "Clean auth"}
            </span>
          </div>
          <div className="security-kpi-card-body">
            <span className="security-kpi-card-value">{stats.authFailed}</span>
            <span className="security-kpi-card-unit">failed logins</span>
          </div>
          <div className="security-kpi-card-footer">
            <span>Invalid tokens & credentials</span>
            {stats.authFailed > 0 && (
              <button
                type="button"
                className="security-card-action"
                onClick={() => {
                  setPreset("auth");
                  setPage(0);
                }}
              >
                Filter auth →
              </button>
            )}
          </div>
        </div>

        <div className="security-kpi-card">
          <div className="security-kpi-card-header">
            <div className="security-kpi-card-title">
              <IconBan size={16} className="text-teal" />
              <span>Rate limits & anomalies</span>
            </div>
            <span
              className={`telemetry-kpi-tag ${stats.rateLimits > 0 ? "tag-amber" : "tag-mint"}`}
            >
              {stats.rateLimits > 0 ? "Throttled" : "Normal traffic"}
            </span>
          </div>
          <div className="security-kpi-card-body">
            <span className="security-kpi-card-value">{stats.rateLimits}</span>
            <span className="security-kpi-card-unit">policy actions</span>
          </div>
          <div className="security-kpi-card-footer">
            <span>Flood defense & rate limits</span>
            {stats.rateLimits > 0 && (
              <button
                type="button"
                className="security-card-action"
                onClick={() => {
                  setPreset("rate_limit");
                  setPage(0);
                }}
              >
                Filter limits →
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Security Filter Studio ───────────────────────────────── */}
      <div className="messages-filter-card">
        {/* Quick Filter Presets */}
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
            All events
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "critical_high" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("critical_high");
              setPage(0);
            }}
          >
            Critical & High
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "auth" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("auth");
              setPage(0);
            }}
          >
            Auth failures
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "rate_limit" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("rate_limit");
              setPage(0);
            }}
          >
            Rate limits
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "protocol" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("protocol");
              setPage(0);
            }}
          >
            Protocol violations
          </button>
        </div>

        {/* Toolbar Controls */}
        <div className="messages-filter-toolbar">
          <div className="flex-1 min-w-56">
            <Search
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              placeholder="Search charger, category, error message or detail..."
            />
          </div>

          <Select
            value={severity || "all"}
            onValueChange={(val) => {
              setSeverity(val === "all" ? "" : (val ?? ""));
              setPage(0);
            }}
          >
            <SelectTrigger className="w-38 text-xs" aria-label="Severity level">
              <SelectValue className={"capitalize"} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(SEVERITY_OPTIONS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={category || "all"}
            onValueChange={(val) => {
              setCategory(val === "all" ? "" : (val ?? ""));
              setPage(0);
            }}
          >
            <SelectTrigger
              className="w-48 text-xs"
              aria-label="Security category"
            >
              <SelectValue className={"capitalize"} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(CATEGORY_OPTIONS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

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

      {/* ── Security Events Table Panel ──────────────────────────── */}
      <div className="table-panel">
        <div className="table-scroll">
          <table className="telemetry-sample-table">
            <thead>
              <tr>
                <th className="w-10" aria-label="Expand" />
                <th>Time</th>
                <th>Charger</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Message</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pagedEvents.map((event, index) => {
                const isExpanded = expandedId === event.id;

                return (
                  <Fragment key={event.id || index}>
                    <tr
                      className={`telemetry-sample-row ${isExpanded ? "is-expanded" : ""}`}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : event.id)
                      }
                    >
                      <td className="w-10 text-muted-foreground">
                        {isExpanded ? (
                          <IconChevronUp size={16} />
                        ) : (
                          <IconChevronDown size={16} />
                        )}
                      </td>
                      <td className="muted nowrap">{time(event.timestamp)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={`/connection/view/${encodeURIComponent(event.identity)}`}
                          className="font-mono text-xs font-semibold text-foreground hover:underline"
                        >
                          {event.identity || "Server"}
                        </Link>
                      </td>
                      <td>
                        <span className="exchange-action-badge">
                          {event.category.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>
                        <Status
                          tone={
                            event.severity === "critical" ||
                            event.severity === "high"
                              ? "rose"
                              : event.severity === "medium"
                                ? "yellow"
                                : "blue"
                          }
                        >
                          {event.severity}
                        </Status>
                      </td>
                      <td>
                        <span className="text-xs text-foreground font-medium">
                          {event.message}
                        </span>
                      </td>
                      <td
                        className="text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          {event.identity && (
                            <Link
                              to={`/commands?target=${encodeURIComponent(event.identity)}`}
                              className="button secondary sm"
                              title="Command charger"
                            >
                              <IconTerminal2 size={13} /> Command
                            </Link>
                          )}
                          <button
                            type="button"
                            className="button secondary sm"
                            onClick={() => handleCopyJson(event, event.id)}
                            title="Copy security event JSON"
                          >
                            {copiedId === event.id ? (
                              <>
                                <IconCheck size={12} className="text-mint" />{" "}
                                Copied
                              </>
                            ) : (
                              <>
                                <IconCopy size={12} /> Copy JSON
                              </>
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${event.id}-expanded`} className="expanded-row">
                        <td colSpan={7} className="expanded-cell">
                          <div className="telemetry-sample-expanded-card m-0! mt-2!">
                            <div className="telemetry-sample-expanded-header">
                              <div className="flex items-center gap-2">
                                <IconShieldExclamation
                                  size={16}
                                  className={
                                    event.severity === "critical" ||
                                    event.severity === "high"
                                      ? "text-rose"
                                      : "text-blue"
                                  }
                                />
                                <strong>
                                  Event details — {event.category} (
                                  {event.identity || "Server"})
                                </strong>
                              </div>
                              <button
                                type="button"
                                className="button secondary sm"
                                onClick={() =>
                                  handleCopyJson(event, `full-${event.id}`)
                                }
                              >
                                {copiedId === `full-${event.id}` ? (
                                  <>
                                    <IconCheck
                                      size={12}
                                      className="text-mint"
                                    />{" "}
                                    Copied
                                  </>
                                ) : (
                                  <>
                                    <IconCopy size={12} /> Copy full event
                                  </>
                                )}
                              </button>
                            </div>
                            <div className="p-3 bg-muted/40 rounded-lg text-xs font-medium mb-3">
                              {event.message}
                            </div>
                            <JsonView
                              value={
                                event.details ?? {
                                  message: event.message,
                                  severity: event.severity,
                                  timestamp: event.timestamp,
                                }
                              }
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}

              {!resource.loading && filteredEvents.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted text-center py-10">
                    <div className="empty-state-card text-center">
                      <IconShieldCheck
                        size={32}
                        className="text-mint mx-auto mb-2"
                      />
                      <h3>No security events matched</h3>
                      <p className="text-muted-foreground text-xs">
                        {hasActiveFilters
                          ? "Try relaxing search query or filter options."
                          : "Core security monitors report zero protocol violations or authentication incidents."}
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {filteredEvents.length > 0 && (
          <Pagination
            page={currentPage}
            count={filteredEvents.length}
            size={pageSize}
            onChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
      </div>

      <p className="table-note">
        {stats.total} retained events recorded in memory. Security events are
        sampled in real time.
      </p>
    </>
  );
}
