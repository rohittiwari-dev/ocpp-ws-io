import { useState } from "react";
import { useSearchParams } from "react-router-dom";
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
import { time } from "@/lib/export";
import type { ErrorRecord, SystemEvent } from "@/types";
export default function DiagnosticsPage() {
  const [query, setQuery] = useSearchParams();
  const system = query.get("tab") === "system";
  const errors = useResource<{ errors: ErrorRecord[]; totalCount: number }>(
    "/errors?limit=1000",
    5000,
  );
  const events = useResource<SystemEvent[]>("/system-events?limit=1000", 5000);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const rows = (
    system ? (events.data ?? []) : (errors.data?.errors ?? [])
  ).filter(
    (event) =>
      (!query.get("identity") || event.identity === query.get("identity")) &&
      `${event.identity ?? "server"} ${event.message} ${"category" in event ? event.category : event.type}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const resource = system ? events : errors;
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 20) - 1),
  );
  return (
    <>
      <PageHeading
        title="Diagnostics"
        description="Trace protocol failures and server lifecycle changes."
      >
        <Refresh onClick={resource.refresh} />
        <Export name={system ? "system-events" : "errors"} data={rows} />
      </PageHeading>
      <div className="tab-row" role="tablist" aria-label="Diagnostic log">
        <button
          role="tab"
          aria-selected={!system}
          onClick={() => {
            const next = new URLSearchParams(query);
            next.delete("tab");
            setQuery(next);
            setPage(0);
          }}
        >
          Errors
        </button>
        <button
          role="tab"
          aria-selected={system}
          onClick={() => {
            const next = new URLSearchParams(query);
            next.set("tab", "system");
            setQuery(next);
            setPage(0);
          }}
        >
          Lifecycle events
        </button>
      </div>
      <div className="toolbar">
        <Search
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder="Search diagnostics..."
        />
        {query.get("identity") && (
          <button
            className="button"
            onClick={() => {
              const next = new URLSearchParams(query);
              next.delete("identity");
              setQuery(next);
            }}
          >
            Clear station: {query.get("identity")}
          </button>
        )}
      </div>
      <Feedback {...resource} retry={resource.refresh} />
      <div className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Station</th>
                <th>Category</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice(currentPage * 20, currentPage * 20 + 20)
                .map((event) => (
                  <tr key={event.id}>
                    <td className="muted nowrap">{time(event.timestamp)}</td>
                    <td>{event.identity ?? "Server"}</td>
                    <td>
                      <Status tone={system ? "lavender" : "rose"}>
                        {("category" in event
                          ? event.category
                          : event.type
                        ).replaceAll("_", " ")}
                      </Status>
                    </td>
                    <td>
                      {event.message}
                      <details className="payload-details">
                        <summary>Inspect record</summary>
                        <JsonView value={event} />
                      </details>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!resource.loading && !rows.length && (
          <Empty title="No matching diagnostics">
            Observed errors and lifecycle events will appear here.
          </Empty>
        )}
        <Pagination
          page={currentPage}
          count={rows.length}
          size={20}
          onChange={setPage}
        />
      </div>
    </>
  );
}
