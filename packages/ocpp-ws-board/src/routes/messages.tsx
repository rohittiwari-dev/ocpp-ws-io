import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  PageHeading,
  Pagination,
  Refresh,
  Search,
  Status,
} from "@/components/workspace";
import { useResource } from "@/hooks/use-resource";
import { useSSE } from "@/lib/sse";
import type { StoredMessage } from "@/types";

const DIRECTION_OPTIONS: Record<string, string> = {
  all: "Both directions",
  IN: "Received",
  OUT: "Sent",
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

export default function MessagesPage() {
  const [query, setQuery] = useSearchParams();
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(6);
  const resource = useResource<StoredMessage[]>("/messages?limit=1000");
  const live = useSSE<StoredMessage>("/messages/stream", "message", !paused);
  const seen = new Set<string>();
  const all = [...live.data, ...(resource.data ?? [])]
    .filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 1000);
  const messages = all.filter(
    (message) =>
      (!query.get("identity") || message.identity === query.get("identity")) &&
      (!query.get("messageId") ||
        message.messageId === query.get("messageId")) &&
      (!direction || message.direction === direction) &&
      (!type || message.type === type) &&
      `${message.identity} ${message.method} ${message.messageId} ${JSON.stringify(message.params)}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(messages.length / pageSize) - 1),
  );
  return (
    <>
      <PageHeading
        title="Message traffic"
        description="Follow every frame. Understand the whole exchange."
      >
        <Status tone={paused ? "yellow" : live.connected ? "mint" : "rose"}>
          {paused ? "Paused" : live.connected ? "Streaming" : "Reconnecting"}
        </Status>
        <button className="button" onClick={() => setPaused(!paused)}>
          {paused ? (
            <IconPlayerPlay size={17} />
          ) : (
            <IconPlayerPause size={17} />
          )}
          {paused ? "Resume" : "Pause"}
        </button>
      </PageHeading>
      <div className="toolbar">
        <Search
          value={search}
          onChange={(value) => {
            setSearch(value);
            setPage(0);
          }}
          placeholder="Search action, charger, ID or payload..."
        />
        <Select
          items={DIRECTION_OPTIONS}
          value={direction || "all"}
          onValueChange={(val) => {
            setDirection(val === "all" ? "" : (val ?? ""));
            setPage(0);
          }}
        >
          <SelectTrigger className="w-38.75" aria-label="Message direction">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Both directions</SelectItem>
            <SelectItem value="IN">Received</SelectItem>
            <SelectItem value="OUT">Sent</SelectItem>
          </SelectContent>
        </Select>
        <Select
          items={MESSAGE_TYPE_OPTIONS}
          value={type || "all"}
          onValueChange={(val) => {
            setType(val === "all" ? "" : (val ?? ""));
            setPage(0);
          }}
        >
          <SelectTrigger className="w-38.75" aria-label="Message type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {MESSAGE_TYPES.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Refresh onClick={resource.refresh} />
        <Export data={messages} name="messages" />
      </div>
      {query.size > 0 && (
        <div className="notice">
          Exchange filter: {query.get("identity")} {query.get("messageId")}{" "}
          <button className="button" onClick={() => setQuery({})}>
            Clear filter
          </button>
        </div>
      )}
      <Feedback {...resource} retry={resource.refresh} />
      <TrafficTable
        messages={messages.slice(
          currentPage * pageSize,
          currentPage * pageSize + pageSize,
        )}
      />
      <Pagination
        page={currentPage}
        count={messages.length}
        size={pageSize}
        onChange={setPage}
        onPageSizeChange={setPageSize}
      />
      <p className="table-note">
        Showing up to 1,000 recent frames; the live buffer retains 200. Pausing
        stops the live subscription, while the server continues recording.
      </p>
    </>
  );
}
