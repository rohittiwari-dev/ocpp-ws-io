import type {
  BoardStorageAdapter,
  ErrorRecord,
  SecurityEventRecord,
  StoredMessage,
  SystemEvent,
} from "./types.js";

let counter = 0;
let securityCounter = 0;
let errorCounter = 0;
let sysCounter = 0;

/**
 * Map the middleware context type to OCPP-J message types.
 * ocpp-ws-io uses: incoming_call, outgoing_call, incoming_result, incoming_error
 */
function resolveMessageType(
  ctxType: string,
  message?: unknown[],
): "CALL" | "CALLRESULT" | "CALLERROR" {
  if (ctxType === "incoming_call" || ctxType === "outgoing_call") return "CALL";
  if (ctxType === "incoming_result") return "CALLRESULT";
  if (ctxType === "incoming_error") return "CALLERROR";

  // Fallback: infer from OCPP-J message array [messageType, ...]
  if (Array.isArray(message)) {
    const mt = message[0];
    if (mt === 2) return "CALL";
    if (mt === 3) return "CALLRESULT";
    if (mt === 4) return "CALLERROR";
  }
  return "CALL";
}

/** Callbacks for SSE broadcast */
export interface BoardPluginCallbacks {
  onMessage?: (msg: StoredMessage) => void;
  onSecurityEvent?: (evt: SecurityEventRecord) => void;
}

export interface BoardPluginInstance {
  name: string;
  serverRef?: any;
  [key: string]: any;
}

/**
 * The OCPPPlugin that passively observes connections, messages,
 * security events, errors, and lifecycle events using native hooks.
 */
export function createBoardPlugin(
  store: BoardStorageAdapter,
  callbacks?: BoardPluginCallbacks,
): BoardPluginInstance {
  return {
    name: "ocpp-ws-board",
    serverRef: undefined,

    // ── Server Lifecycle ────────────────────────────────────────

    onInit(server: any) {
      this.serverRef = server;
    },

    // ── Connection Lifecycle ────────────────────────────────────

    onConnection(client: any) {
      store.addConnection({
        identity: client.identity ?? "unknown",
        remoteAddress: client.handshake?.remoteAddress ?? "",
        protocol: client.protocol ?? "",
        connectedAt: new Date().toISOString(),
        status: "online",
        sessionData: client.session ?? {},
        securityProfile: client.handshake?.securityProfile ?? 0,
      });
    },

    onDisconnect(client: any, code: number, reason: string) {
      store.removeConnection(client.identity ?? "unknown", code, reason);
    },

    onEviction(evicted: any, replacement: any) {
      const identity = evicted.identity ?? "unknown";
      store.evictConnection(identity);

      const evt: SystemEvent = {
        id: `sys-${++sysCounter}`,
        type: "EVICTION",
        identity,
        message: `Station "${identity}" evicted by new connection`,
        details: { replacedBy: replacement?.identity },
        timestamp: new Date().toISOString(),
      };
      store.addSystemEvent(evt);
    },

    // ── Message Traffic ─────────────────────────────────────────

    onMessage(client: any, payload: any) {
      const msg = toStoredMessage(payload, client.identity, client.protocol);
      store.addMessage(msg);
      callbacks?.onMessage?.(msg);
    },

    // ── Security ────────────────────────────────────────────────

    onSecurityEvent(evt: any) {
      const record: SecurityEventRecord = {
        id: `sec-${++securityCounter}`,
        category: mapSecurityCategory(evt.type ?? evt.eventType),
        identity: evt.identity ?? "unknown",
        message: evt.message ?? evt.type ?? "Security event",
        severity: mapSeverity(evt.type ?? evt.eventType),
        details: evt,
        timestamp: new Date().toISOString(),
      };
      store.addSecurityEvent(record);
      callbacks?.onSecurityEvent?.(record);
    },

    onAuthFailed(handshake: any, code: number, reason: string) {
      const identity = handshake?.identity ?? "unknown";
      const record: SecurityEventRecord = {
        id: `sec-${++securityCounter}`,
        category: "AUTH_FAILED",
        identity,
        message: `Authentication failed: ${reason}`,
        severity: "high",
        details: { reason, code },
        timestamp: new Date().toISOString(),
      };
      store.addSecurityEvent(record);
      callbacks?.onSecurityEvent?.(record);
    },

    onRateLimitExceeded(client: any) {
      const identity = client.identity ?? "unknown";
      const record: SecurityEventRecord = {
        id: `sec-${++securityCounter}`,
        category: "RATE_LIMIT",
        identity,
        message: `Rate limit exceeded for "${identity}"`,
        severity: "medium",
        timestamp: new Date().toISOString(),
      };
      store.addSecurityEvent(record);
      callbacks?.onSecurityEvent?.(record);
    },

    // ── Errors ──────────────────────────────────────────────────

    onError(error: any, context: any) {
      const record: ErrorRecord = {
        id: `err-${++errorCounter}`,
        category: "UNKNOWN",
        identity: context?.client?.identity ?? "server",
        message: error?.message ?? String(error),
        stack: error?.stack,
        timestamp: new Date().toISOString(),
      };
      store.addError(record);
    },

    onBadMessage(client: any, error: any) {
      const record: ErrorRecord = {
        id: `err-${++errorCounter}`,
        category: "BAD_MESSAGE",
        identity: client.identity ?? "unknown",
        message: error?.message ?? "Malformed OCPP message",
        timestamp: new Date().toISOString(),
      };
      store.addError(record);
    },

    onValidationFailure(client: any, message: any) {
      const record: ErrorRecord = {
        id: `err-${++errorCounter}`,
        category: "VALIDATION_FAILURE",
        identity: client.identity ?? "unknown",
        message: `Schema validation failed for ${
          message?.method ?? "unknown method"
        }`,
        method: message?.method,
        timestamp: new Date().toISOString(),
      };
      store.addError(record);
    },

    onHandlerError(client: any, method: string, error: any) {
      const record: ErrorRecord = {
        id: `err-${++errorCounter}`,
        category: "HANDLER_ERROR",
        identity: client.identity ?? "unknown",
        message: `Handler crashed: ${method} — ${
          error?.message ?? String(error)
        }`,
        method,
        stack: error?.stack,
        timestamp: new Date().toISOString(),
      };
      store.addError(record);
    },

    // ── Backpressure & Health ───────────────────────────────────

    onBackpressure(client: any, queueSize: number) {
      const evt: SystemEvent = {
        id: `sys-${++sysCounter}`,
        type: "BACKPRESSURE",
        identity: client.identity ?? "unknown",
        message: `Backpressure detected — queue depth: ${queueSize}`,
        details: { queueSize },
        timestamp: new Date().toISOString(),
      };
      store.addSystemEvent(evt);
    },

    onPongTimeout(client: any) {
      const evt: SystemEvent = {
        id: `sys-${++sysCounter}`,
        type: "PONG_TIMEOUT",
        identity: client.identity ?? "unknown",
        message: `Pong timeout — peer unresponsive`,
        timestamp: new Date().toISOString(),
      };
      store.addSystemEvent(evt);
    },

    // ── Server Management ───────────────────────────────────────

    onReconfigure(config: any) {
      const evt: SystemEvent = {
        id: `sys-${++sysCounter}`,
        type: "RECONFIGURE",
        message: "Server configuration updated",
        details: config,
        timestamp: new Date().toISOString(),
      };
      store.addSystemEvent(evt);
    },

    onClosing() {
      const evt: SystemEvent = {
        id: `sys-${++sysCounter}`,
        type: "SHUTDOWN",
        message: "Server shutting down gracefully",
        timestamp: new Date().toISOString(),
      };
      store.addSystemEvent(evt);
    },

    onClose() {
      // Final cleanup
    },
  };
}

// ─── Helpers ──────────────────────────────────────────────────────

function mapSecurityCategory(type: string): SecurityEventRecord["category"] {
  if (!type) return "ANOMALY";
  const t = type.toUpperCase();
  if (t.includes("AUTH")) return "AUTH_FAILED";
  if (t.includes("RATE")) return "RATE_LIMIT";
  if (t.includes("PROTOCOL") || t.includes("VIOLATION"))
    return "PROTOCOL_VIOLATION";
  if (t.includes("POLICY") || t.includes("REJECT")) return "POLICY_REJECTION";
  return "ANOMALY";
}

function mapSeverity(type: string): SecurityEventRecord["severity"] {
  if (!type) return "medium";
  const t = type.toUpperCase();
  if (t.includes("AUTH")) return "high";
  if (t.includes("RATE")) return "medium";
  if (t.includes("ANOMALY")) return "high";
  return "medium";
}

/**
 * Convert the message event payload from ocpp-ws-io into a StoredMessage.
 *
 * Event payload shape:
 *   { message: [msgType, msgId, method?, params?], direction: "IN"|"OUT", ctx: { type, messageId, method, params, timestamp, latencyMs, protocol } }
 */
function toStoredMessage(
  payload: any,
  identity?: string,
  protocol?: string,
): StoredMessage {
  const ctx = payload.ctx ?? {};
  const message = payload.message; // OCPP-J array: [type, id, method?, params/payload?]

  // Extract method: ctx.method is most reliable, then from OCPP-J array position [2] for CALLs
  const method =
    ctx.method ??
    (Array.isArray(message) && message[0] === 2 ? message[2] : undefined) ??
    "Unknown";

  // Extract messageId
  const messageId =
    ctx.messageId ?? (Array.isArray(message) ? message[1] : "") ?? "";

  // Extract params/payload from ctx or from OCPP-J array
  const params =
    ctx.params ??
    (Array.isArray(message) && message[0] === 2 ? message[3] : undefined);

  const responsePayload =
    ctx.payload ??
    (Array.isArray(message) && (message[0] === 3 || message[0] === 4)
      ? message[2]
      : undefined);

  return {
    id: `msg-${++counter}`,
    identity: identity ?? "unknown",
    direction: payload.direction ?? "IN",
    type: resolveMessageType(ctx.type, message),
    method,
    messageId,
    params: params ?? responsePayload,
    payload: responsePayload,
    timestamp: ctx.timestamp ?? new Date().toISOString(),
    latencyMs: ctx.latencyMs,
    protocol: ctx.protocol ?? protocol ?? "",
    source: "ocpp-ws-io",
  };
}
