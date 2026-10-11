import { IconArrowUpRight, IconStar, IconTerminal2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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
import { time } from "@/lib/export";
import type { ConnectionRecord } from "@/types";
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
  return (
    <>
      <PageHeading
        title={
          view === "favorites"
            ? "Starred stations"
            : view === "attention"
              ? "Needs attention"
              : "All stations"
        }
        description="Your charging network, one connection at a time."
      >
        <Link className="button primary" to="/commands">
          <IconTerminal2 size={18} />
          Send command
        </Link>
      </PageHeading>
      <div className="fleet-summary">
        <div className="station-stack">
          {(resource.data ?? []).slice(0, 4).map((station, index) => (
            <span key={station.identity} className={`avatar pastel-${index}`}>
              {station.identity.slice(0, 1).toUpperCase()}
            </span>
          ))}
        </div>
        <span>
          <strong>
            {resource.data?.filter((station) => station.status === "online")
              .length ?? 0}
          </strong>{" "}
          stations online
        </span>
        <span className="summary-divider" />
        <span>
          Updated {resource.updatedAt?.toLocaleTimeString() ?? "\u2014"}
        </span>
      </div>
      <div className="toolbar">
        <Search
          value={search}
          onChange={setSearch}
          placeholder="Search stations or IP address..."
        />
        <select
          aria-label="Filter status"
          value={status}
          onChange={(event) => filter("status", event.target.value)}
        >
          <option value="">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="evicted">Evicted</option>
        </select>
        <select
          aria-label="Filter protocol"
          value={protocol}
          onChange={(event) => filter("protocol", event.target.value)}
        >
          <option value="">All protocols</option>
          {[
            ...new Set([
              "ocpp1.6",
              "ocpp2.0.1",
              "ocpp2.1",
              ...(resource.data ?? []).map((station) => station.protocol),
            ]),
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Sort stations"
          value={sort}
          onChange={(event) => setSort(event.target.value)}
        >
          <option value="newest">Newest first</option>
          <option value="name">Station name</option>
          <option value="errors">Most errors</option>
        </select>
        <Refresh onClick={resource.refresh} />
        <Export name="stations" data={stations} />
      </div>
      <Feedback {...resource} retry={resource.refresh} />
      <section className="table-panel" aria-label="Station list">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th className="star-column">
                  <IconStar size={16} aria-label="Favorites" />
                </th>
                <th>Station</th>
                <th>Status</th>
                <th>Protocol</th>
                <th>Security</th>
                <th>Errors</th>
                <th>Connected</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stations
                .slice(currentPage * 12, currentPage * 12 + 12)
                .map((station, index) => (
                  <tr key={station.identity}>
                    <td>
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
                    <td>
                      <Link
                        className="row-link"
                        aria-label={`Inspect ${station.identity}`}
                        to={`/connection/view/${encodeURIComponent(station.identity)}`}
                      >
                        <IconArrowUpRight size={18} />
                      </Link>
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
                ? "No stations match"
                : "Waiting for your first station"
            }
          >
            {resource.data?.length
              ? "Try another search or change the status and protocol filters."
              : "Register the board plugin with your OCPP server. Connected stations will appear here automatically."}
          </Empty>
        )}
        <Pagination
          page={currentPage}
          count={stations.length}
          onChange={setPage}
        />
      </section>
      <p className="table-note">
        Connections observed by this board instance. Status updates every 5
        seconds.
      </p>
    </>
  );
}
