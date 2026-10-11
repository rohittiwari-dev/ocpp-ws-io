import {
  IconArrowUpRight,
  IconDotsVertical,
  IconMessage,
  IconPlug,
  IconPower,
  IconRoute,
  IconStar,
  IconTerminal2,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
  PageHeading,
  Pagination,
  Refresh,
  Search,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { api } from "@/lib/api";
import { time } from "@/lib/export";
import type { ConnectionRecord } from "@/types";

const STATUS_OPTIONS: Record<string, string> = {
  all: "All statuses",
  online: "Online",
  offline: "Offline",
  evicted: "Evicted",
};

const SORT_OPTIONS: Record<string, string> = {
  newest: "Newest first",
  name: "Charger name",
  errors: "Most errors",
};

export default function ConnectionsPage() {
  const resource = useResource<ConnectionRecord[]>("/connections", 5000);
  const [query, setQuery] = useSearchParams();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState("newest");
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const data: string[] = JSON.parse(
        localStorage.getItem("board:favorites") ?? "[]",
      );
      return Array.isArray(data)
        ? data.filter((value) => typeof value === "string")
        : [];
    } catch {
      return [];
    }
  });
  const status = query.get("status") ?? "";
  const protocol = query.get("protocol") ?? "";
  const view = query.get("view") ?? "all";
  const stations = (resource.data ?? [])
    .filter(
      (station) =>
        (!status || station.status === status) &&
        (!protocol || station.protocol === protocol) &&
        (view !== "favorites" || favorites.includes(station.identity)) &&
        (view !== "attention" ||
          station.errorCount ||
          station.status === "evicted") &&
        `${station.identity} ${station.remoteAddress}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "name"
        ? a.identity.localeCompare(b.identity)
        : sort === "errors"
          ? (b.errorCount ?? 0) - (a.errorCount ?? 0)
          : b.connectedAt.localeCompare(a.connectedAt),
    );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(stations.length / 12) - 1),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing a filter resets pagination.
  useEffect(() => {
    setPage(0);
  }, [search, status, protocol, view, sort]);
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    setQuery(next);
  };
  const navigate = useNavigate();
  const [busyIdentity, setBusyIdentity] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const star = (identity: string) => {
    const next = favorites.includes(identity)
      ? favorites.filter((id) => id !== identity)
      : [...favorites, identity];
    setFavorites(next);
    try {
      localStorage.setItem("board:favorites", JSON.stringify(next));
    } catch {
      /* Favorites remain available for this session. */
    }
  };
  const handleDisconnect = async (identity: string) => {
    setBusyIdentity(identity);
    setActionFeedback(null);
    try {
      await api.post(`/connections/${encodeURIComponent(identity)}/disconnect`);
      setActionFeedback({
        type: "success",
        message: `Charger ${identity} disconnected successfully.`,
      });
      resource.refresh();
    } catch (err) {
      setActionFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : `Failed to disconnect charger ${identity}.`,
      });
    } finally {
      setBusyIdentity(null);
    }
  };
  const handlePurge = async (identity: string) => {
    setBusyIdentity(identity);
    setActionFeedback(null);
    try {
      await api.post(`/connections/${encodeURIComponent(identity)}/purge`);
      setActionFeedback({
        type: "success",
        message: `Charger ${identity} records removed.`,
      });
      resource.refresh();
    } catch (err) {
      setActionFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : `Failed to remove charger ${identity}.`,
      });
    } finally {
      setBusyIdentity(null);
    }
  };
  const totalCount = resource.data?.length ?? 0;
  const onlineCount = (resource.data ?? []).filter(
    (station) => station.status === "online",
  ).length;
  const offlineCount = (resource.data ?? []).filter(
    (station) => station.status === "offline",
  ).length;
  const attentionCount = (resource.data ?? []).filter(
    (station) => station.errorCount || station.status === "evicted",
  ).length;
  const recentStations = [...(resource.data ?? [])]
    .sort((a, b) => b.connectedAt.localeCompare(a.connectedAt))
    .slice(0, 5);
  const protocols = ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"];
  return (
    <>
      <PageHeading
        title={
          view === "favorites"
            ? "Starred chargers"
            : view === "attention"
              ? "Needs attention"
              : "All chargers"
        }
        description="Your charging network, one charger at a time."
      >
        <div className="segmented min-w-max">
          <Link
            to="/connections"
            className={view !== "favorites" ? "active min-w-max" : "min-w-max"}
          >
            All chargers
          </Link>
          <Link
            to="/connections?view=favorites"
            className={view === "favorites" ? "active" : ""}
          >
            Starred
          </Link>
        </div>
        <Link className="button primary" to="/commands">
          <IconTerminal2 size={18} />
          Send command
        </Link>
      </PageHeading>
      {actionFeedback && (
        <div
          className={`action-banner ${actionFeedback.type}`}
          role={actionFeedback.type === "error" ? "alert" : "status"}
        >
          <span>{actionFeedback.message}</span>
          <button
            type="button"
            className="action-btn"
            aria-label="Dismiss notification"
            onClick={() => setActionFeedback(null)}
          >
            <IconX size={14} />
          </button>
        </div>
      )}
      <div className="station-meta-bar">
        <div className="fleet-summary">
          <div className="station-stack">
            {(resource.data ?? []).slice(0, 4).map((station, index) => (
              <span key={station.identity} className={`avatar pastel-${index}`}>
                {station.identity.slice(0, 1).toUpperCase()}
              </span>
            ))}
          </div>
          <span>
            <strong>{onlineCount}</strong> chargers online
          </span>
          <span className="summary-divider" />
          <span>
            Updated {resource.updatedAt?.toLocaleTimeString() ?? "\u2014"}
          </span>
        </div>
        {recentStations.length > 0 && (
          <div
            className="recent-strip"
            aria-label="Recently connected chargers"
          >
            <span className="recent-label">Recently connected:</span>
            <div className="recent-chips">
              {recentStations.map((station) => (
                <Link
                  key={station.identity}
                  to={`/connection/view/${encodeURIComponent(station.identity)}`}
                  className="recent-chip"
                  title={`Connected: ${station.identity}`}
                >
                  <span
                    className={`status-dot ${station.status === "online" ? "mint" : ""}`}
                  />
                  <span>{station.identity}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="station-filter-strip" aria-label="Charger quick filters">
        <div className="filter-chip-group">
          <span className="filter-group-title">Status:</span>
          <button
            type="button"
            className={`filter-chip ${!status && view !== "attention" ? "active" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(query);
              next.delete("status");
              if (view === "attention") next.delete("view");
              setQuery(next);
            }}
          >
            <IconPlug size={15} />
            <span>All</span>
            <span className="count-badge">{totalCount}</span>
          </button>
          <button
            type="button"
            className={`filter-chip ${status === "online" ? "active" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(query);
              if (status === "online") next.delete("status");
              else next.set("status", "online");
              if (view === "attention") next.delete("view");
              setQuery(next);
            }}
          >
            <span className="status-dot mint" />
            <span>Online</span>
            <span className="count-badge tone-mint">{onlineCount}</span>
          </button>
          <button
            type="button"
            className={`filter-chip ${status === "offline" ? "active" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(query);
              if (status === "offline") next.delete("status");
              else next.set("status", "offline");
              if (view === "attention") next.delete("view");
              setQuery(next);
            }}
          >
            <span className="status-dot" />
            <span>Offline</span>
            <span className="count-badge">{offlineCount}</span>
          </button>
          <button
            type="button"
            className={`filter-chip ${view === "attention" ? "active" : ""}`}
            onClick={() => {
              const next = new URLSearchParams(query);
              if (view === "attention") next.delete("view");
              else next.set("view", "attention");
              next.delete("status");
              setQuery(next);
            }}
          >
            <span className="status-dot rose" />
            <span>Needs attention</span>
            <span className="count-badge tone-rose">{attentionCount}</span>
          </button>
        </div>
        <div className="filter-strip-divider" />
        <div className="filter-chip-group">
          <span className="filter-group-title">Protocols:</span>
          {protocols.map((proto) => {
            const isSelected = protocol === proto;
            const count = (resource.data ?? []).filter(
              (station) => station.protocol === proto,
            ).length;
            return (
              <button
                key={proto}
                type="button"
                className={`filter-chip ${isSelected ? "active" : ""}`}
                onClick={() => {
                  const next = new URLSearchParams(query);
                  if (isSelected) next.delete("protocol");
                  else next.set("protocol", proto);
                  setQuery(next);
                }}
              >
                <span>OCPP {proto.replace("ocpp", "")}</span>
                <span className="count-badge">{count}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Search chargers or IP address..."
        />
        <Select
          items={STATUS_OPTIONS}
          value={status || "all"}
          onValueChange={(val) =>
            filter("status", val === "all" ? "" : (val ?? ""))
          }
        >
          <SelectTrigger className="w-36.25" aria-label="Filter status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="online">Online</SelectItem>
            <SelectItem value="offline">Offline</SelectItem>
            <SelectItem value="evicted">Evicted</SelectItem>
          </SelectContent>
        </Select>
        <Select
          items={{
            all: "All protocols",
            ...Object.fromEntries(
              [
                ...new Set([
                  "ocpp1.6",
                  "ocpp2.0.1",
                  "ocpp2.1",
                  ...(resource.data ?? []).map((station) => station.protocol),
                ]),
              ].map((value) => [value, value]),
            ),
          }}
          value={protocol || "all"}
          onValueChange={(val) =>
            filter("protocol", val === "all" ? "" : (val ?? ""))
          }
        >
          <SelectTrigger className="w-37.5" aria-label="Filter protocol">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All protocols</SelectItem>
            {[
              ...new Set([
                "ocpp1.6",
                "ocpp2.0.1",
                "ocpp2.1",
                ...(resource.data ?? []).map((station) => station.protocol),
              ]),
            ].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={SORT_OPTIONS}
          value={sort}
          onValueChange={(val) => {
            if (val) setSort(val);
          }}
        >
          <SelectTrigger className="w-36.25" aria-label="Sort chargers">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="name">Charger name</SelectItem>
            <SelectItem value="errors">Most errors</SelectItem>
          </SelectContent>
        </Select>
        <Refresh onClick={resource.refresh} />
        <Export name="chargers" data={stations} />
      </div>
      <Feedback {...resource} retry={resource.refresh} />
      <section className="table-panel" aria-label="Charger list">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="star-column">
                  <IconStar size={16} aria-label="Favorites" />
                </th>
                <th>Charger</th>
                <th>Status</th>
                <th>Protocol</th>
                <th>Security</th>
                <th>Errors</th>
                <th>Connected</th>
                <th style={{ textAlign: "right", paddingRight: 20 }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {stations
                .slice(currentPage * 12, currentPage * 12 + 12)
                .map((station, index) => (
                  <tr
                    key={station.identity}
                    className="table-row-clickable"
                    tabIndex={0}
                    role="button"
                    aria-label={`View charger ${station.identity}`}
                    onClick={() =>
                      navigate(
                        `/connection/view/${encodeURIComponent(station.identity)}`,
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(
                          `/connection/view/${encodeURIComponent(station.identity)}`,
                        );
                      }
                    }}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <button
                        className={`star-button ${favorites.includes(station.identity) ? "is-starred" : ""}`}
                        aria-label={`${favorites.includes(station.identity) ? "Unstar" : "Star"} ${station.identity}`}
                        aria-pressed={favorites.includes(station.identity)}
                        onClick={() => star(station.identity)}
                      >
                        <IconStar
                          size={17}
                          fill={
                            favorites.includes(station.identity)
                              ? "currentColor"
                              : "none"
                          }
                        />
                      </button>
                    </td>
                    <td>
                      <Link
                        className="station-cell"
                        to={`/connection/view/${encodeURIComponent(station.identity)}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className={`avatar pastel-${index % 5}`}>
                          {station.identity.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong>{station.identity}</strong>
                          <small>
                            {station.remoteAddress || "Address unavailable"}
                          </small>
                        </div>
                      </Link>
                    </td>
                    <td>
                      <Status
                        tone={
                          station.status === "online"
                            ? "mint"
                            : station.status === "evicted"
                              ? "rose"
                              : "neutral"
                        }
                      >
                        {station.status}
                      </Status>
                    </td>
                    <td>
                      <span className="protocol-label">
                        {station.protocol || "Not negotiated"}
                      </span>
                    </td>
                    <td>
                      <Status
                        tone={station.securityProfile >= 2 ? "blue" : "yellow"}
                      >
                        {["None", "Basic auth", "TLS + auth", "Mutual TLS"][
                          station.securityProfile
                        ] ?? `Profile ${station.securityProfile}`}
                      </Status>
                    </td>
                    <td>
                      <span
                        className={station.errorCount ? "text-rose" : "muted"}
                      >
                        {station.errorCount ?? 0}
                      </span>
                    </td>
                    <td className="muted nowrap">
                      {time(station.connectedAt)}
                    </td>
                    <td
                      className="actions-cell"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="row-actions">
                        <Link
                          className="action-btn"
                          aria-label={`Send command to ${station.identity}`}
                          title={`Send command to ${station.identity}`}
                          to={`/commands?identity=${encodeURIComponent(station.identity)}`}
                        >
                          <IconTerminal2 size={16} />
                        </Link>
                        {station.status === "online" && (
                          <button
                            type="button"
                            className="action-btn action-disconnect"
                            aria-label={`Disconnect ${station.identity}`}
                            title={`Disconnect ${station.identity}`}
                            disabled={busyIdentity === station.identity}
                            onClick={() =>
                              void handleDisconnect(station.identity)
                            }
                          >
                            <IconPower size={16} />
                          </button>
                        )}
                        <Link
                          className="action-btn"
                          aria-label={`Inspect ${station.identity}`}
                          title={`Inspect ${station.identity}`}
                          to={`/connection/view/${encodeURIComponent(station.identity)}`}
                        >
                          <IconArrowUpRight size={16} />
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="action-btn"
                            aria-label={`More actions for ${station.identity}`}
                            title="More actions"
                          >
                            <IconDotsVertical size={16} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="charger-actions-menu"
                          >
                            <DropdownMenuLabel>
                              {station.identity}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/commands?identity=${encodeURIComponent(station.identity)}`,
                                )
                              }
                            >
                              <IconTerminal2 size={15} />
                              Send command
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/connection/view/${encodeURIComponent(station.identity)}`,
                                )
                              }
                            >
                              <IconArrowUpRight size={15} />
                              View details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/messages?identity=${encodeURIComponent(station.identity)}`,
                                )
                              }
                            >
                              <IconMessage size={15} />
                              Live messages
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/diagnostics?identity=${encodeURIComponent(station.identity)}`,
                                )
                              }
                            >
                              <IconRoute size={15} />
                              Diagnostics
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {station.status === "online" ? (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  void handleDisconnect(station.identity)
                                }
                              >
                                <IconPower size={15} />
                                Disconnect charger
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() =>
                                  void handlePurge(station.identity)
                                }
                              >
                                <IconTrash size={15} />
                                Remove charger records
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!resource.loading && !stations.length && (
          <Empty
            title={
              resource.data?.length
                ? "No chargers match"
                : "Waiting for your first charger"
            }
          >
            {resource.data?.length
              ? "Try another search or change the status and protocol filters."
              : "Register the board plugin with your OCPP server. Connected chargers will appear here automatically."}
          </Empty>
        )}
        <Pagination
          page={currentPage}
          count={stations.length}
          onChange={setPage}
        />
      </section>
      <p className="table-note">
        Chargers observed by this board instance. Status updates every 5
        seconds.
      </p>
    </>
  );
}
