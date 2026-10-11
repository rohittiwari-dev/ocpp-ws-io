import {
  IconAlertTriangle,
  IconArrowDownLeft,
  IconArrowRight,
  IconArrowsExchange,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconFilter,
  IconHash,
  IconList,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlug,
  IconServer,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TrafficTable } from "@/components/traffic-table";
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
import { useSSE } from "@/lib/sse";
import type { CorrelatedExchange, StoredMessage } from "@/types";

type ViewMode = "all" | "exchanges" | "errors" | "chargers";
type PresetFilter =
  | "all"
  | "calls"
  | "errors"
  | "transactions"
  | "heartbeats"
  | "slow";

const DIRECTION_OPTIONS: Record<string, string> = {
  all: "Both directions",
  IN: "Received (IN)",
  OUT: "Sent (OUT)",
};

const MESSAGE_TYPES = [
  "CALL",
  "CALLRESULT",
  "CALLERROR",
  "CALLRESULTERROR",
  "SEND",
] as const;

const MESSAGE_TYPE_OPTIONS: Record<string, string> = {
  all: "All types",
  ...Object.fromEntries(MESSAGE_TYPES.map((val) => [val, val])),
};

const PROTOCOL_OPTIONS: Record<string, string> = {
  all: "All protocols",
  "ocpp1.6": "OCPP 1.6",
  "ocpp2.0.1": "OCPP 2.0.1",
  "ocpp2.1": "OCPP 2.1",
};

const COMMON_ACTIONS = [
  "BootNotification",
  "Heartbeat",
  "StatusNotification",
  "Authorize",
  "StartTransaction",
  "StopTransaction",
  "MeterValues",
  "TransactionEvent",
  "Reset",
  "UnlockConnector",
  "ChangeAvailability",
  "ClearCache",
  "DataTransfer",
  "GetConfiguration",
  "ChangeConfiguration",
  "RemoteStartTransaction",
  "RemoteStopTransaction",
];

const LATENCY_OPTIONS: Record<string, string> = {
  all: "Any latency",
  "50": "> 50 ms",
  "100": "> 100 ms (Slow)",
  "300": "> 300 ms",
  "500": "> 500 ms (High)",
};

export default function MessagesPage() {
  const [query, setQuery] = useSearchParams();
  const [paused, setPaused] = useState(false);
  const [activeView, setActiveView] = useState<ViewMode>(
    (query.get("view") as ViewMode) || "all",
  );
  const [preset, setPreset] = useState<PresetFilter>("all");
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState("");
  const [type, setType] = useState("");
  const [protocol, setProtocol] = useState("");
  const [action, setAction] = useState("");
  const [latencyMin, setLatencyMin] = useState("");
  const [expandedExchangeKey, setExpandedExchangeKey] = useState<string | null>(
    null,
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);

  const resource = useResource<StoredMessage[]>("/messages?limit=1000");
  const live = useSSE<StoredMessage>("/messages/stream", "message", !paused);

  // Deduplicate and sort all messages
  const allMessages = useMemo(() => {
    const seen = new Set<string>();
    return [...live.data, ...(resource.data ?? [])]
      .filter((message) => {
        if (seen.has(message.id)) return false;
        seen.add(message.id);
        return true;
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, 1000);
  }, [live.data, resource.data]);

  // Extract all distinct actions present in buffer
  const actionOptions = useMemo(() => {
    const set = new Set<string>(COMMON_ACTIONS);
    for (const m of allMessages) {
      if (m.method) set.add(m.method);
    }
    return Array.from(set).sort();
  }, [allMessages]);

  // Apply filters
  const filteredMessages = useMemo(() => {
    return allMessages.filter((m) => {
      // URL filters
      if (query.get("identity") && m.identity !== query.get("identity"))
        return false;
      if (query.get("messageId") && m.messageId !== query.get("messageId"))
        return false;

      // Dropdown filters
      if (direction && m.direction !== direction) return false;
      if (type && m.type !== type) return false;
      if (protocol && m.protocol !== protocol) return false;
      if (action && m.method !== action) return false;
      if (latencyMin && (m.latencyMs ?? 0) < Number.parseInt(latencyMin, 10))
        return false;

      // Preset filter chips
      if (preset === "calls" && m.type !== "CALL") return false;
      if (
        preset === "errors" &&
        m.type !== "CALLERROR" &&
        m.type !== "CALLRESULTERROR"
      )
        return false;
      if (
        preset === "transactions" &&
        ![
          "starttransaction",
          "stoptransaction",
          "metervalues",
          "transactionevent",
          "authorize",
        ].some((a) => m.method?.toLowerCase().includes(a))
      )
        return false;
      if (
        preset === "heartbeats" &&
        !["heartbeat", "statusnotification"].some((a) =>
          m.method?.toLowerCase().includes(a),
        )
      )
        return false;
      if (preset === "slow" && (m.latencyMs ?? 0) < 100) return false;

      // Search query
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const str =
          `${m.identity} ${m.method} ${m.messageId} ${m.protocol} ${JSON.stringify(m.params)} ${JSON.stringify(m.payload)}`.toLowerCase();
        if (!str.includes(q)) return false;
      }

      return true;
    });
  }, [
    allMessages,
    query,
    direction,
    type,
    protocol,
    action,
    latencyMin,
    preset,
    search,
  ]);

  // Aggregate stats for summary strip
  const stats = useMemo(() => {
    let inbound = 0;
    let outbound = 0;
    let errorCount = 0;
    const chargers = new Set<string>();

    for (const m of filteredMessages) {
      if (m.direction === "IN") inbound += 1;
      if (m.direction === "OUT") outbound += 1;
      if (m.type === "CALLERROR" || m.type === "CALLRESULTERROR")
        errorCount += 1;
      if (m.identity) chargers.add(m.identity);
    }

    const errorRate =
      filteredMessages.length > 0
        ? Math.round((errorCount / filteredMessages.length) * 1000) / 10
        : 0;

    return {
      total: filteredMessages.length,
      inbound,
      outbound,
      errorCount,
      errorRate,
      chargersCount: chargers.size,
    };
  }, [filteredMessages]);

  // Correlated Exchanges aggregation
  const correlatedExchanges = useMemo(() => {
    const map = new Map<string, CorrelatedExchange>();

    for (const msg of filteredMessages) {
      const key = `${msg.identity}:${msg.messageId}`;
      let exchange = map.get(key);
      if (!exchange) {
        exchange = {
          identity: msg.identity,
          messageId: msg.messageId,
          method: msg.method || "Unknown",
          protocol: msg.protocol,
          source: msg.source,
          startedAt: msg.timestamp,
          status: "pending",
        };
        map.set(key, exchange);
      }

      if (msg.type === "CALL" || msg.type === "SEND") {
        exchange.request = msg;
        if (msg.method) exchange.method = msg.method;
        exchange.startedAt = msg.timestamp;
      } else if (msg.type === "CALLRESULT") {
        exchange.response = msg;
        exchange.completedAt = msg.timestamp;
        exchange.latencyMs = msg.latencyMs ?? exchange.latencyMs;
        if (exchange.status !== "error") exchange.status = "completed";
      } else if (msg.type === "CALLERROR" || msg.type === "CALLRESULTERROR") {
        exchange.response = msg;
        exchange.completedAt = msg.timestamp;
        exchange.latencyMs = msg.latencyMs ?? exchange.latencyMs;
        exchange.status = "error";
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }, [filteredMessages]);

  // Protocol Errors view aggregation
  const errorFrames = useMemo(() => {
    return filteredMessages.filter(
      (m) =>
        m.type === "CALLERROR" ||
        m.type === "CALLRESULTERROR" ||
        (m.payload &&
          typeof m.payload === "object" &&
          ("errorCode" in m.payload || "errorDescription" in m.payload)),
    );
  }, [filteredMessages]);

  // Charger Breakdown view aggregation
  const chargerBreakdown = useMemo(() => {
    const map = new Map<
      string,
      {
        identity: string;
        total: number;
        inbound: number;
        outbound: number;
        errors: number;
        protocol: string;
        lastSeen: string;
        latestAction: string;
      }
    >();

    for (const msg of filteredMessages) {
      let item = map.get(msg.identity);
      if (!item) {
        item = {
          identity: msg.identity,
          total: 0,
          inbound: 0,
          outbound: 0,
          errors: 0,
          protocol: msg.protocol,
          lastSeen: msg.timestamp,
          latestAction: msg.method || msg.type,
        };
        map.set(msg.identity, item);
      }
      item.total += 1;
      if (msg.direction === "IN") item.inbound += 1;
      if (msg.direction === "OUT") item.outbound += 1;
      if (msg.type === "CALLERROR" || msg.type === "CALLRESULTERROR")
        item.errors += 1;
      if (msg.timestamp.localeCompare(item.lastSeen) > 0) {
        item.lastSeen = msg.timestamp;
        item.latestAction = msg.method || msg.type;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredMessages]);

  // Pagination bounds based on active view
  const currentItemsCount =
    activeView === "exchanges"
      ? correlatedExchanges.length
      : activeView === "errors"
        ? errorFrames.length
        : activeView === "chargers"
          ? chargerBreakdown.length
          : filteredMessages.length;

  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(currentItemsCount / pageSize) - 1),
  );

  const pagedMessages = useMemo(() => {
    const start = currentPage * pageSize;
    return filteredMessages.slice(start, start + pageSize);
  }, [filteredMessages, currentPage, pageSize]);

  const pagedExchanges = useMemo(() => {
    const start = currentPage * pageSize;
    return correlatedExchanges.slice(start, start + pageSize);
  }, [correlatedExchanges, currentPage, pageSize]);

  const pagedErrors = useMemo(() => {
    const start = currentPage * pageSize;
    return errorFrames.slice(start, start + pageSize);
  }, [errorFrames, currentPage, pageSize]);

  const pagedChargers = useMemo(() => {
    const start = currentPage * pageSize;
    return chargerBreakdown.slice(start, start + pageSize);
  }, [chargerBreakdown, currentPage, pageSize]);

  const handleCopyJson = (data: unknown, key: string) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 2000);
  };

  const handleClearAllFilters = () => {
    setSearch("");
    setDirection("");
    setType("");
    setProtocol("");
    setAction("");
    setLatencyMin("");
    setPreset("all");
    setQuery({});
    setPage(0);
  };

  const hasActiveFilters =
    search ||
    direction ||
    type ||
    protocol ||
    action ||
    latencyMin ||
    preset !== "all" ||
    query.size > 0;

  return (
    <>
      <PageHeading
        title="Message traffic"
        description="Follow every frame. Correlate RPC exchanges. Isolate protocol exceptions."
      >
        <Status tone={paused ? "yellow" : live.connected ? "mint" : "rose"}>
          <span
            className={`telemetry-live-dot ${live.connected && !paused ? "is-live" : ""}`}
          />
          {paused
            ? "Stream paused"
            : live.connected
              ? "Live streaming"
              : "Reconnecting"}
        </Status>
        <button
          type="button"
          className="button secondary"
          onClick={() => setPaused(!paused)}
          title={paused ? "Resume streaming" : "Pause streaming"}
        >
          {paused ? (
            <>
              <IconPlayerPlay size={14} /> Resume
            </>
          ) : (
            <>
              <IconPlayerPause size={14} /> Pause
            </>
          )}
        </button>
        <Refresh onClick={resource.refresh} />
        <Export data={filteredMessages} name="messages" />
      </PageHeading>

      <Feedback {...resource} retry={resource.refresh} />

      {/* ── Live Traffic Summary KPI Strip ───────────────────────── */}
      <div className="messages-summary-strip">
        <div className="messages-summary-item">
          <span className="summary-label">Filtered traffic</span>
          <strong className="summary-val">{stats.total} frames</strong>
        </div>
        <div className="messages-summary-item">
          <span className="summary-label">Inbound (IN)</span>
          <strong className="summary-val text-blue">
            <IconArrowDownLeft size={14} className="inline mr-1" />
            {stats.inbound}
          </strong>
        </div>
        <div className="messages-summary-item">
          <span className="summary-label">Outbound (OUT)</span>
          <strong className="summary-val text-teal">
            <IconArrowUpRight size={14} className="inline mr-1" />
            {stats.outbound}
          </strong>
        </div>
        <div className="messages-summary-item">
          <span className="summary-label">Error frames</span>
          <strong
            className={`summary-val ${stats.errorCount > 0 ? "text-rose" : "text-mint"}`}
          >
            {stats.errorCount} ({stats.errorRate}%)
          </strong>
        </div>
        <div className="messages-summary-item">
          <span className="summary-label">Active chargers</span>
          <strong className="summary-val text-foreground">
            {stats.chargersCount} in buffer
          </strong>
        </div>
      </div>

      {/* ── Operational View Switcher (Tabs) ─────────────────────── */}
      <div
        className="messages-view-tabs"
        role="tablist"
        aria-label="Message Views"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeView === "all"}
          className={`messages-view-tab ${activeView === "all" ? "is-active" : ""}`}
          onClick={() => {
            setActiveView("all");
            setPage(0);
          }}
        >
          <IconList size={16} />
          <span>All traffic</span>
          <span className="messages-tab-badge">{filteredMessages.length}</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeView === "exchanges"}
          className={`messages-view-tab ${activeView === "exchanges" ? "is-active" : ""}`}
          onClick={() => {
            setActiveView("exchanges");
            setPage(0);
          }}
        >
          <IconArrowsExchange size={16} />
          <span>Correlated exchanges</span>
          <span className="messages-tab-badge">
            {correlatedExchanges.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeView === "errors"}
          className={`messages-view-tab ${activeView === "errors" ? "is-active" : ""}`}
          onClick={() => {
            setActiveView("errors");
            setPage(0);
          }}
        >
          <IconAlertTriangle size={16} />
          <span>Protocol errors</span>
          <span
            className={`messages-tab-badge ${errorFrames.length > 0 ? "badge-rose" : ""}`}
          >
            {errorFrames.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeView === "chargers"}
          className={`messages-view-tab ${activeView === "chargers" ? "is-active" : ""}`}
          onClick={() => {
            setActiveView("chargers");
            setPage(0);
          }}
        >
          <IconServer size={16} />
          <span>Charger breakdown</span>
          <span className="messages-tab-badge">{chargerBreakdown.length}</span>
        </button>
      </div>

      {/* ── Advanced Filter Studio ───────────────────────────────── */}
      <div className="messages-filter-card">
        {/* Quick Filter Presets Strip */}
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
            All messages
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "calls" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("calls");
              setPage(0);
            }}
          >
            Calls only
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "errors" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("errors");
              setPage(0);
            }}
          >
            Errors only
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "transactions" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("transactions");
              setPage(0);
            }}
          >
            Transactions
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "heartbeats" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("heartbeats");
              setPage(0);
            }}
          >
            Heartbeats & Status
          </button>
          <button
            type="button"
            className={`messages-preset-chip ${preset === "slow" ? "is-active" : ""}`}
            onClick={() => {
              setPreset("slow");
              setPage(0);
            }}
          >
            Slow (&gt;100ms)
          </button>
        </div>

        {/* Dropdown Filters Toolbar */}
        <div className="messages-filter-toolbar">
          <div className="flex-1 min-w-56">
            <Search
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(0);
              }}
              placeholder="Search action, charger, ID or payload content..."
            />
          </div>

          {/* Direction Filter */}
          <Select
            value={direction || "all"}
            onValueChange={(val) => {
              setDirection(val === "all" ? "" : (val ?? ""));
              setPage(0);
            }}
          >
            <SelectTrigger
              className="w-36 text-xs"
              aria-label="Message direction"
            >
              <SelectValue className={"capitalize"} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(DIRECTION_OPTIONS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Message Type Filter */}
          <Select
            value={type || "all"}
            onValueChange={(val) => {
              setType(val === "all" ? "" : (val ?? ""));
              setPage(0);
            }}
          >
            <SelectTrigger className="w-34 text-xs" aria-label="Message type">
              <SelectValue className={"capitalize"} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(MESSAGE_TYPE_OPTIONS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Protocol Filter */}
          <Select
            value={protocol || "all"}
            onValueChange={(val) => {
              setProtocol(val === "all" ? "" : (val ?? ""));
              setPage(0);
            }}
          >
            <SelectTrigger className="w-34 text-xs" aria-label="OCPP protocol">
              <SelectValue className={"capitalize"} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(PROTOCOL_OPTIONS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Action Filter */}
          <Select
            value={action || "all"}
            onValueChange={(val) => {
              setAction(val === "all" ? "" : (val ?? ""));
              setPage(0);
            }}
          >
            <SelectTrigger className="w-42 text-xs" aria-label="OCPP action">
              <SelectValue placeholder="All actions" className={"capitalize"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All actions</SelectItem>
              {actionOptions.map((act) => (
                <SelectItem key={act} value={act}>
                  {act}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Latency Threshold Filter */}
          <Select
            value={latencyMin || "all"}
            onValueChange={(val) => {
              setLatencyMin(val === "all" ? "" : (val ?? ""));
              setPage(0);
            }}
          >
            <SelectTrigger className="w-32 text-xs" aria-label="Latency filter">
              <SelectValue className={"capitalize"} />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(LATENCY_OPTIONS).map(([k, label]) => (
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
              onClick={handleClearAllFilters}
              title="Reset all filters"
            >
              <IconX size={13} /> Reset
            </button>
          )}
        </div>
      </div>

      {/* Active Correlated Filter Banner (from URL query) */}
      {query.size > 0 && (
        <div
          className="active-filter-banner"
          role="region"
          aria-label="Active exchange filter"
        >
          <div className="active-filter-content">
            <div className="active-filter-label">
              <IconArrowsExchange size={16} />
              <span>Correlated exchange query</span>
            </div>
            <div className="active-filter-tags">
              {query.get("identity") && (
                <span className="filter-chip">
                  <IconPlug size={13} className="muted" />
                  <span className="muted">Charger:</span>
                  <strong>{query.get("identity")}</strong>
                </span>
              )}
              {query.get("messageId") && (
                <span className="filter-chip">
                  <IconHash size={13} className="muted" />
                  <span className="muted">Message ID:</span>
                  <code className="filter-chip-code">
                    {query.get("messageId")}
                  </code>
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="filter-clear-btn"
            aria-label="Clear active exchange filter"
            onClick={() => setQuery({})}
          >
            <IconX size={14} />
            <span>Clear query filter</span>
          </button>
        </div>
      )}

      {/* ── View 1: All Traffic Table ────────────────────────────── */}
      {activeView === "all" && (
        <>
          <TrafficTable messages={pagedMessages} />
          <Pagination
            page={currentPage}
            count={filteredMessages.length}
            size={pageSize}
            onChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      {/* ── View 2: Correlated Exchanges ─────────────────────────── */}
      {activeView === "exchanges" && (
        <div className="messages-exchanges-container">
          {pagedExchanges.map((exchange) => {
            const key = `${exchange.identity}-${exchange.messageId}`;
            const isExpanded = expandedExchangeKey === key;

            return (
              <div
                key={key}
                className={`exchange-card ${isExpanded ? "is-expanded" : ""}`}
              >
                <div
                  className="exchange-card-header"
                  onClick={() =>
                    setExpandedExchangeKey(isExpanded ? null : key)
                  }
                >
                  <div className="exchange-card-title-group">
                    <button
                      type="button"
                      className="exchange-expand-chevron"
                      aria-label="Toggle exchange view"
                    >
                      {isExpanded ? (
                        <IconChevronUp size={16} />
                      ) : (
                        <IconChevronDown size={16} />
                      )}
                    </button>
                    <Link
                      to={`/connection/view/${encodeURIComponent(exchange.identity)}`}
                      className="exchange-charger-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconPlug size={14} className="text-muted-foreground" />
                      <strong>{exchange.identity}</strong>
                    </Link>
                    <span className="exchange-action-badge">
                      {exchange.method}
                    </span>
                    <span className="protocol-badge">{exchange.protocol}</span>
                    <code className="exchange-msg-id">
                      #{exchange.messageId}
                    </code>
                  </div>

                  <div className="exchange-card-meta-group">
                    {exchange.latencyMs !== undefined && (
                      <span className="exchange-latency-badge">
                        ⚡ {exchange.latencyMs} ms
                      </span>
                    )}
                    <Status
                      tone={
                        exchange.status === "completed"
                          ? "mint"
                          : exchange.status === "error"
                            ? "rose"
                            : "yellow"
                      }
                    >
                      {exchange.status === "completed"
                        ? "Completed"
                        : exchange.status === "error"
                          ? "Error response"
                          : "Pending"}
                    </Status>
                    <span className="exchange-time muted text-xs">
                      {time(exchange.startedAt)}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="exchange-card-body">
                    <div className="exchange-comparison-grid">
                      {/* Left Side: Request (CALL) */}
                      <div className="exchange-side-block">
                        <div className="exchange-side-header">
                          <div className="flex items-center gap-2">
                            <span className="direction-pill in">
                              {exchange.request?.direction === "IN"
                                ? "Received Request (IN)"
                                : "Sent Request (OUT)"}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {exchange.request
                                ? time(exchange.request.timestamp)
                                : "—"}
                            </span>
                          </div>
                          {exchange.request && (
                            <button
                              type="button"
                              className="button secondary sm"
                              onClick={() =>
                                handleCopyJson(
                                  exchange.request?.params ??
                                    exchange.request?.payload,
                                  `${key}-req`,
                                )
                              }
                            >
                              {copiedKey === `${key}-req` ? (
                                <>
                                  <IconCheck size={12} className="text-mint" />{" "}
                                  Copied
                                </>
                              ) : (
                                <>
                                  <IconCopy size={12} /> Copy payload
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <JsonView
                          value={
                            exchange.request?.params ??
                            exchange.request?.payload ?? {
                              status: "No payload recorded",
                            }
                          }
                        />
                      </div>

                      {/* Right Side: Response (CALLRESULT / CALLERROR) */}
                      <div className="exchange-side-block">
                        <div className="exchange-side-header">
                          <div className="flex items-center gap-2">
                            <span
                              className={`direction-pill ${exchange.response?.direction === "IN" ? "in" : "out"}`}
                            >
                              {exchange.response
                                ? exchange.response.type === "CALLERROR"
                                  ? "RPC Error (CALLERROR)"
                                  : `Response (${exchange.response.type})`
                                : "Awaiting response..."}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {exchange.response
                                ? time(exchange.response.timestamp)
                                : "—"}
                            </span>
                          </div>
                          {exchange.response && (
                            <button
                              type="button"
                              className="button secondary sm"
                              onClick={() =>
                                handleCopyJson(
                                  exchange.response?.payload ??
                                    exchange.response?.params,
                                  `${key}-res`,
                                )
                              }
                            >
                              {copiedKey === `${key}-res` ? (
                                <>
                                  <IconCheck size={12} className="text-mint" />{" "}
                                  Copied
                                </>
                              ) : (
                                <>
                                  <IconCopy size={12} /> Copy result
                                </>
                              )}
                            </button>
                          )}
                        </div>
                        <JsonView
                          value={
                            exchange.response?.payload ??
                            exchange.response?.params ?? {
                              status:
                                exchange.status === "pending"
                                  ? "Pending response from peer..."
                                  : "No response body recorded",
                            }
                          }
                        />
                      </div>
                    </div>

                    <div className="exchange-card-footer">
                      <Link
                        to={`/commands?target=${encodeURIComponent(exchange.identity)}`}
                        className="button secondary sm"
                      >
                        <IconTerminal2 size={13} /> Re-run action in composer
                      </Link>
                      <button
                        type="button"
                        className="button secondary sm"
                        onClick={() => handleCopyJson(exchange, key)}
                      >
                        {copiedKey === key ? (
                          <>
                            <IconCheck size={12} className="text-mint" /> Copied
                            Full Exchange
                          </>
                        ) : (
                          <>
                            <IconCopy size={12} /> Copy exchange JSON
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {correlatedExchanges.length === 0 && (
            <div className="empty-state-card text-center py-12">
              <IconArrowsExchange
                size={32}
                className="text-muted-foreground mx-auto mb-2"
              />
              <h3>No correlated exchanges found</h3>
              <p className="text-muted-foreground text-xs">
                Exchanges appear as requests (CALL) and matching responses
                (CALLRESULT) are recorded in the buffer.
              </p>
            </div>
          )}

          {correlatedExchanges.length > 0 && (
            <Pagination
              page={currentPage}
              count={correlatedExchanges.length}
              size={pageSize}
              onChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </div>
      )}

      {/* ── View 3: Protocol Errors & Exceptions ─────────────────── */}
      {activeView === "errors" && (
        <>
          <div className="table-panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Charger</th>
                    <th>Direction</th>
                    <th>Action</th>
                    <th>Message ID</th>
                    <th>Error outcome</th>
                    <th className="text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedErrors.map((msg) => (
                    <tr key={msg.id}>
                      <td className="muted nowrap">{time(msg.timestamp)}</td>
                      <td>
                        <Link
                          to={`/connection/view/${encodeURIComponent(msg.identity)}`}
                          className="font-mono text-xs font-semibold"
                        >
                          {msg.identity}
                        </Link>
                      </td>
                      <td>
                        <span
                          className={`direction-pill ${msg.direction === "IN" ? "in" : "out"}`}
                        >
                          {msg.direction}
                        </span>
                      </td>
                      <td>
                        <span className="exchange-action-badge">
                          {msg.method || "RPC Error"}
                        </span>
                      </td>
                      <td>
                        <code className="text-xs">#{msg.messageId}</code>
                      </td>
                      <td>
                        <Status tone="rose">
                          {msg.type === "CALLERROR"
                            ? "CALLERROR"
                            : msg.type === "CALLRESULTERROR"
                              ? "CALLRESULTERROR"
                              : "Exception"}
                        </Status>
                      </td>
                      <td className="text-right">
                        <Link
                          to={`/messages?identity=${encodeURIComponent(msg.identity)}&messageId=${encodeURIComponent(msg.messageId)}`}
                          className="button secondary sm"
                          title="Correlate this error exchange"
                        >
                          <IconArrowsExchange size={13} /> Correlate
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {errorFrames.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted text-center py-8">
                        No protocol errors or exceptions recorded in the current
                        message buffer.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {errorFrames.length > 0 && (
            <Pagination
              page={currentPage}
              count={errorFrames.length}
              size={pageSize}
              onChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </>
      )}

      {/* ── View 4: Charger Activity Breakdown ───────────────────── */}
      {activeView === "chargers" && (
        <>
          <div className="charger-activity-grid">
            {pagedChargers.map((item) => (
              <div key={item.identity} className="charger-activity-card">
                <div className="charger-activity-card-header">
                  <div className="flex items-center gap-2">
                    <IconPlug size={16} className="text-mint" />
                    <Link
                      to={`/connection/view/${encodeURIComponent(item.identity)}`}
                      className="font-mono text-sm font-semibold hover:underline"
                    >
                      {item.identity}
                    </Link>
                  </div>
                  <span className="protocol-badge">{item.protocol}</span>
                </div>

                <div className="charger-activity-metrics">
                  <div className="charger-metric-box">
                    <span className="metric-label">Total traffic</span>
                    <strong className="metric-num">{item.total}</strong>
                  </div>
                  <div className="charger-metric-box">
                    <span className="metric-label">Inbound (IN)</span>
                    <strong className="metric-num text-blue">
                      {item.inbound}
                    </strong>
                  </div>
                  <div className="charger-metric-box">
                    <span className="metric-label">Outbound (OUT)</span>
                    <strong className="metric-num text-teal">
                      {item.outbound}
                    </strong>
                  </div>
                  <div className="charger-metric-box">
                    <span className="metric-label">Errors</span>
                    <strong
                      className={`metric-num ${item.errors > 0 ? "text-rose" : "text-mint"}`}
                    >
                      {item.errors}
                    </strong>
                  </div>
                </div>

                <div className="charger-activity-card-footer">
                  <span className="text-xs text-muted-foreground truncate">
                    Last: <strong>{item.latestAction}</strong> •{" "}
                    {time(item.lastSeen)}
                  </span>
                  <button
                    type="button"
                    className="button secondary sm"
                    onClick={() => {
                      setQuery({ identity: item.identity });
                      setActiveView("all");
                    }}
                  >
                    Filter traffic <IconArrowRight size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {chargerBreakdown.length === 0 && (
            <div className="empty-state-card text-center py-12">
              <IconPlug
                size={32}
                className="text-muted-foreground mx-auto mb-2"
              />
              <h3>No chargers recorded in message traffic</h3>
              <p className="text-muted-foreground text-xs">
                Chargers will appear as messages are exchanged.
              </p>
            </div>
          )}

          {chargerBreakdown.length > 0 && (
            <Pagination
              page={currentPage}
              count={chargerBreakdown.length}
              size={pageSize}
              onChange={setPage}
              onPageSizeChange={setPageSize}
            />
          )}
        </>
      )}

      <p className="table-note">
        Showing up to 1,000 recent frames; the live buffer retains 200. Pausing
        stops the live subscription, while the server continues recording.
      </p>
    </>
  );
}
