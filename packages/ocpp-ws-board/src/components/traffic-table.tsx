import { Link } from "react-router-dom";
import { time } from "@/lib/export";
import type { StoredMessage } from "@/types";
import { Empty, JsonView, Status } from "./workspace";
export function TrafficTable({ messages }: { messages: StoredMessage[] }) {
  return (
    <div className="table-panel">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Station / message</th>
              <th>Direction</th>
              <th>Action</th>
              <th>Type</th>
              <th>Latency</th>
              <th>Payload</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <td className="muted nowrap">{time(message.timestamp)}</td>
                <td>
                  <Link
                    to={`/connection/view/${encodeURIComponent(message.identity)}`}
                  >
                    {message.identity}
                  </Link>
                  <small className="muted" style={{ display: "block" }}>
                    {message.messageId}
                  </small>
                </td>
                <td>
                  <Status
                    tone={message.direction === "IN" ? "blue" : "lavender"}
                  >
                    {message.direction === "IN" ? "Received" : "Sent"}
                  </Status>
                </td>
                <td>{message.method}</td>
                <td>
                  <Status
                    tone={
                      message.type.includes("ERROR")
                        ? "rose"
                        : message.type === "CALLRESULT"
                          ? "mint"
                          : "neutral"
                    }
                  >
                    {message.type}
                  </Status>
                </td>
                <td className="muted nowrap">
                  {message.latencyMs == null
                    ? "\u2014"
                    : `${message.latencyMs} ms`}
                </td>
                <td>
                  <details className="payload-details">
                    <summary>Inspect</summary>
                    <JsonView
                      value={message.params ?? message.payload ?? null}
                    />
                    <Link
                      className="button"
                      to={`/messages?identity=${encodeURIComponent(message.identity)}&messageId=${encodeURIComponent(message.messageId)}`}
                    >
                      Correlate exchange
                    </Link>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!messages.length && (
        <Empty title="No traffic to show">
          Messages appear as stations exchange OCPP frames with your server.
        </Empty>
      )}
    </div>
  );
}
