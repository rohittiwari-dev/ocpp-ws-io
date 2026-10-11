import { useState } from "react";
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
import type { SecurityEventRecord } from "@/types";
export default function SecurityPage() {
  const resource = useResource<{
    events: SecurityEventRecord[];
    totalCount: number;
  }>("/security-events?limit=1000", 5000);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const events = (resource.data?.events ?? []).filter(
    (event) =>
      (!severity || event.severity === severity) &&
      (!category || event.category === category) &&
      `${event.identity} ${event.message}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(events.length / 20) - 1),
  );
  return (
    <>
      <PageHeading
        title="Security events"
        description="Authentication, rate limits, and protocol anomalies."
      >
        <Refresh onClick={resource.refresh} />
        <Export data={events} name="security-events" />
      </PageHeading>
      <div className="toolbar">
        <Search
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder="Search station or security event..."
        />
        <select
          aria-label="Severity"
          value={severity}
          onChange={(event) => {
            setSeverity(event.target.value);
            setPage(0);
          }}
        >
          <option value="">All severities</option>
          {["low", "medium", "high", "critical"].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Security category"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(0);
          }}
        >
          <option value="">All categories</option>
          {[
            "AUTH_FAILED",
            "RATE_LIMIT",
            "ANOMALY",
            "PROTOCOL_VIOLATION",
            "POLICY_REJECTION",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
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
                <th>Severity</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {events
                .slice(currentPage * 20, currentPage * 20 + 20)
                .map((event) => (
                  <tr key={event.id}>
                    <td className="muted nowrap">{time(event.timestamp)}</td>
                    <td>{event.identity}</td>
                    <td>{event.category.replaceAll("_", " ")}</td>
                    <td>
                      <Status
                        tone={
                          event.severity === "high" ||
                          event.severity === "critical"
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
                      {event.message}
                      {event.details && (
                        <details className="payload-details">
                          <summary>Details</summary>
                          <JsonView value={event.details} />
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {!resource.loading && !events.length && (
          <Empty title="No matching security events">
            Events reported by the core appear here. Adjust filters to inspect
            other categories.
          </Empty>
        )}
        <Pagination
          page={currentPage}
          count={events.length}
          size={20}
          onChange={setPage}
        />
      </div>
      <p className="table-note">
        {resource.data?.totalCount ?? 0} retained events. Refreshes every 5
        seconds.
      </p>
    </>
  );
}
