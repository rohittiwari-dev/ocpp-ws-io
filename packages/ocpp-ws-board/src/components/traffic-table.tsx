import {
  IconAlertCircle,
  IconArrowDownLeft,
  IconArrowsExchange,
  IconArrowUpRight,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconCode,
  IconCopy,
  IconDotsVertical,
  IconHash,
  IconPlug,
  IconTerminal2,
} from "@tabler/icons-react";
import { Fragment, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { time } from "@/lib/export";
import { cn } from "@/lib/utils";
import type { JsonObject, JsonValue, StoredMessage } from "@/types";
import { Empty, JsonView, Status } from "./workspace";

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API unavailable or permission denied, fall through
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const success = document.execCommand("copy");
    document.body.removeChild(textarea);
    return success;
  } catch {
    return false;
  }
}

interface ErrorDetails {
  code?: string;
  description?: string;
}

function extractErrorInfo(payload: JsonValue | undefined): ErrorDetails | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const obj = payload as JsonObject;
  const code =
    typeof obj.errorCode === "string"
      ? obj.errorCode
      : typeof obj.code === "string"
        ? obj.code
        : undefined;
  const description =
    typeof obj.errorDescription === "string"
      ? obj.errorDescription
      : typeof obj.description === "string"
        ? obj.description
        : typeof obj.message === "string"
          ? obj.message
          : undefined;

  if (code || description) {
    return { code, description };
  }
  return null;
}

function getPayloadSummary(payload: JsonValue | undefined): string {
  if (payload === undefined || payload === null) {
    return "(Empty)";
  }
  if (Array.isArray(payload)) {
    return `Array (${payload.length} ${payload.length === 1 ? "item" : "items"})`;
  }
  if (typeof payload === "object") {
    const keys = Object.keys(payload);
    return `Object (${keys.length} ${keys.length === 1 ? "key" : "keys"})`;
  }
  return typeof payload;
}

export function TrafficTable({ messages }: { messages: StoredMessage[] }) {
  const navigate = useNavigate();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedPayloadId, setCopiedPayloadId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCopyPayload = (message: StoredMessage) => {
    const payloadData = message.params ?? message.payload ?? null;
    const jsonStr = JSON.stringify(payloadData, null, 2);
    void copyToClipboard(jsonStr);
    setCopiedPayloadId(message.id);
    setTimeout(() => {
      setCopiedPayloadId((curr) => (curr === message.id ? null : curr));
    }, 2000);
  };

  const handleCopyMessageId = (messageId: string) => {
    void copyToClipboard(messageId);
    setCopiedMsgId(messageId);
    setTimeout(() => {
      setCopiedMsgId((curr) => (curr === messageId ? null : curr));
    }, 2000);
  };

  return (
    <div className="table-panel">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th
                className="expand-indicator-cell"
                aria-label="Expand indicator"
              />
              <th>Time</th>
              <th>Charger / message</th>
              <th>Direction</th>
              <th>Action</th>
              <th>Type</th>
              <th>Latency</th>
              <th className="actions-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => {
              const isExpanded = expandedIds.has(message.id);
              const payloadData = message.params ?? message.payload ?? null;
              const errorInfo = message.type.includes("ERROR")
                ? extractErrorInfo(payloadData)
                : null;

              return (
                <Fragment key={message.id}>
                  <tr
                    className={cn(
                      "table-row-clickable",
                      isExpanded && "is-expanded",
                    )}
                    tabIndex={0}
                    role="button"
                    aria-expanded={isExpanded}
                    aria-label={`Message ${message.method} for ${message.identity}, click to ${isExpanded ? "collapse" : "expand"}`}
                    onClick={() => toggleExpand(message.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleExpand(message.id);
                      }
                    }}
                  >
                    <td className="expand-indicator-cell">
                      <button
                        type="button"
                        className="expand-toggle-btn"
                        aria-label={isExpanded ? "Collapse row" : "Expand row"}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleExpand(message.id);
                        }}
                      >
                        {isExpanded ? (
                          <IconChevronDown size={15} />
                        ) : (
                          <IconChevronRight size={15} />
                        )}
                      </button>
                    </td>
                    <td className="muted nowrap">{time(message.timestamp)}</td>
                    <td>
                      <Link
                        className="station-link"
                        to={`/connection/view/${encodeURIComponent(message.identity)}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {message.identity}
                      </Link>
                      <small
                        className="muted nowrap"
                        style={{ display: "block" }}
                      >
                        {message.messageId}
                      </small>
                    </td>
                    <td>
                      <Status
                        tone={message.direction === "IN" ? "blue" : "lavender"}
                      >
                        {message.direction === "IN" ? (
                          <>
                            <IconArrowDownLeft size={13} />
                            Received
                          </>
                        ) : (
                          <>
                            <IconArrowUpRight size={13} />
                            Sent
                          </>
                        )}
                      </Status>
                    </td>
                    <td>
                      <strong>{message.method}</strong>
                    </td>
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
                    <td
                      className="actions-cell"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="row-actions">
                        <button
                          type="button"
                          className="action-btn"
                          title="Copy payload JSON"
                          aria-label="Copy payload JSON"
                          onClick={() => handleCopyPayload(message)}
                        >
                          {copiedPayloadId === message.id ? (
                            <IconCheck size={16} className="text-mint" />
                          ) : (
                            <IconCopy size={16} />
                          )}
                        </button>
                        <Link
                          className="action-btn"
                          title="Correlate exchange"
                          aria-label="Correlate exchange"
                          to={`/messages?identity=${encodeURIComponent(message.identity)}&messageId=${encodeURIComponent(message.messageId)}`}
                        >
                          <IconArrowsExchange size={16} />
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            className="action-btn"
                            aria-label={`Actions for ${message.method}`}
                            title="More actions"
                          >
                            <IconDotsVertical size={16} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="charger-actions-menu"
                          >
                            <DropdownMenuLabel>
                              {message.method} ({message.identity})
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/messages?identity=${encodeURIComponent(message.identity)}&messageId=${encodeURIComponent(message.messageId)}`,
                                )
                              }
                            >
                              <IconArrowsExchange size={15} />
                              Correlate exchange
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleCopyPayload(message)}
                            >
                              <IconCopy size={15} />
                              Copy payload JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                handleCopyMessageId(message.messageId)
                              }
                            >
                              <IconHash size={15} />
                              Copy message ID
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/connection/view/${encodeURIComponent(message.identity)}`,
                                )
                              }
                            >
                              <IconPlug size={15} />
                              View charger
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                navigate(
                                  `/commands?identity=${encodeURIComponent(message.identity)}`,
                                )
                              }
                            >
                              <IconTerminal2 size={15} />
                              Send command
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${message.id}-expanded`} className="expanded-row">
                      <td colSpan={8} className="expanded-cell">
                        <div className="message-expanded-panel">
                          {/* Expanded Header */}
                          <div className="message-expanded-header">
                            <div className="message-badge-group">
                              <Status
                                tone={
                                  message.direction === "IN"
                                    ? "blue"
                                    : "lavender"
                                }
                              >
                                {message.direction === "IN" ? (
                                  <>
                                    <IconArrowDownLeft size={13} />
                                    Received (IN)
                                  </>
                                ) : (
                                  <>
                                    <IconArrowUpRight size={13} />
                                    Sent (OUT)
                                  </>
                                )}
                              </Status>
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
                              <span className="meta-pill">
                                <span className="meta-pill-label">
                                  Protocol:
                                </span>
                                <strong className="meta-pill-value">
                                  {message.protocol || "OCPP"}
                                </strong>
                              </span>
                              {message.latencyMs != null && (
                                <span className="meta-pill">
                                  <IconClock size={12} />
                                  <span className="meta-pill-label">
                                    Latency:
                                  </span>
                                  <strong className="meta-pill-value">
                                    {message.latencyMs} ms
                                  </strong>
                                </span>
                              )}
                              <span className="meta-pill">
                                <span className="meta-pill-label">Source:</span>
                                <strong className="meta-pill-value">
                                  {message.source}
                                </strong>
                              </span>
                            </div>
                            <div className="message-header-time muted">
                              <span>
                                {new Date(message.timestamp).toLocaleString()}
                              </span>
                            </div>
                          </div>

                          {/* Route & Correlation Bar */}
                          <div className="message-route-bar">
                            <div className="message-route-item">
                              <span className="route-item-label">Charger</span>
                              <Link
                                to={`/connection/view/${encodeURIComponent(message.identity)}`}
                                className="route-item-link"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <IconPlug size={14} />
                                <span>{message.identity}</span>
                              </Link>
                            </div>
                            <div className="message-route-item">
                              <span className="route-item-label">
                                Action / Method
                              </span>
                              <span className="route-item-method">
                                {message.method}
                              </span>
                            </div>
                            <div className="message-route-item">
                              <span className="route-item-label">
                                Correlation ID
                              </span>
                              <div className="id-badge-wrap">
                                <code className="id-code">
                                  {message.messageId}
                                </code>
                                <button
                                  type="button"
                                  className="id-copy-btn"
                                  title="Copy message ID"
                                  aria-label="Copy message ID"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleCopyMessageId(message.messageId);
                                  }}
                                >
                                  {copiedMsgId === message.messageId ? (
                                    <IconCheck
                                      size={13}
                                      className="text-mint"
                                    />
                                  ) : (
                                    <IconCopy size={13} />
                                  )}
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Error Callout if applicable */}
                          {message.type.includes("ERROR") && (
                            <div className="message-error-callout" role="alert">
                              <IconAlertCircle
                                size={18}
                                className="text-rose"
                              />
                              <div>
                                <strong>
                                  RPC Error ({errorInfo?.code ?? message.type})
                                </strong>
                                <p>
                                  {errorInfo?.description ??
                                    "The remote station or server returned an RPC error for this frame."}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Action Toolbar */}
                          <div className="message-action-toolbar">
                            <div className="action-toolbar-title">
                              <IconCode size={15} />
                              <span>Payload & Parameters</span>
                              <span className="payload-keys-count">
                                {getPayloadSummary(payloadData)}
                              </span>
                            </div>
                            <div className="action-toolbar-buttons">
                              <Link
                                className="button button-sm action-toolbar-btn primary"
                                to={`/messages?identity=${encodeURIComponent(message.identity)}&messageId=${encodeURIComponent(message.messageId)}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <IconArrowsExchange size={14} />
                                <span>Correlate exchange</span>
                              </Link>
                              <button
                                type="button"
                                className="button button-sm action-toolbar-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCopyPayload(message);
                                }}
                              >
                                {copiedPayloadId === message.id ? (
                                  <>
                                    <IconCheck
                                      size={14}
                                      className="text-mint"
                                    />
                                    <span>Copied JSON</span>
                                  </>
                                ) : (
                                  <>
                                    <IconCopy size={14} />
                                    <span>Copy JSON</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                className="button button-sm action-toolbar-btn"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleCopyMessageId(message.messageId);
                                }}
                              >
                                {copiedMsgId === message.messageId ? (
                                  <>
                                    <IconCheck
                                      size={14}
                                      className="text-mint"
                                    />
                                    <span>Copied ID</span>
                                  </>
                                ) : (
                                  <>
                                    <IconHash size={14} />
                                    <span>Copy ID</span>
                                  </>
                                )}
                              </button>
                              <Link
                                className="button button-sm action-toolbar-btn"
                                to={`/connection/view/${encodeURIComponent(message.identity)}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <IconPlug size={14} />
                                <span>View charger</span>
                              </Link>
                              <Link
                                className="button button-sm action-toolbar-btn"
                                to={`/commands?identity=${encodeURIComponent(message.identity)}`}
                                onClick={(event) => event.stopPropagation()}
                              >
                                <IconTerminal2 size={14} />
                                <span>Send command</span>
                              </Link>
                            </div>
                          </div>

                          {/* Formatted JSON Payload Card */}
                          <div className="message-payload-card">
                            <JsonView value={payloadData} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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
