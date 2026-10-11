import { useState } from "react";
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
import { time } from "@/lib/export";
import type { SecurityEventRecord } from "@/types";

const SEVERITY_OPTIONS: Record<string, string> = {
  all: "All severities",
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical",
};

const CATEGORIES = [
  "AUTH_FAILED",
  "RATE_LIMIT",
  "ANOMALY",
  "PROTOCOL_VIOLATION",
  "POLICY_REJECTION",
] as const;

const CATEGORY_OPTIONS: Record<string, string> = {
  all: "All categories",
  ...Object.fromEntries(CATEGORIES.map((val) => [val, val])),
};

export default function SecurityPage() {
  const resource = useResource<{
    events: SecurityEventRecord[];
    totalCount: number;
  }>("/security-events?limit=1000", 5000);
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);
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
    Math.max(0, Math.ceil(events.length / pageSize) - 1),
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
          placeholder="Search charger or security event..."
        />
        <Select
          items={SEVERITY_OPTIONS}
          value={severity || "all"}
          onValueChange={(val) => {
            setSeverity(val === "all" ? "" : (val ?? ""));
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[155px]" aria-label="Severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            {["low", "medium", "high", "critical"].map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={CATEGORY_OPTIONS}
          value={category || "all"}
          onValueChange={(val) => {
            setCategory(val === "all" ? "" : (val ?? ""));
            setPage(0);
          }}
        >
          <SelectTrigger className="w-[185px]" aria-label="Security category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Feedback {...resource} retry={resource.refresh} />
      <div className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Charger</th>
                <th>Category</th>
                <th>Severity</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {events
                .slice(
                  currentPage * pageSize,
                  currentPage * pageSize + pageSize,
                )
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
          size={pageSize}
          onChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </div>
      <p className="table-note">
        {resource.data?.totalCount ?? 0} retained events. Refreshes every 5
        seconds.
      </p>
    </>
  );
}
