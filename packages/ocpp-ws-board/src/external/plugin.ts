import { randomUUID } from "node:crypto";
import type {
  MessageEventPayload,
  OCPPPlugin,
  OCPPServerClient,
} from "ocpp-ws-io";
import type { BoardPluginInstance } from "../types/operations.js";
import type {
  BoardStorageAdapter,
  ErrorRecord,
  JsonValue,
  SecurityEventRecord,
  StoredMessage,
  SystemEvent,
} from "./types.js";

export interface BoardPluginCallbacks {
  onMessage?: (message: StoredMessage) => void;
  onSecurityEvent?: (event: SecurityEventRecord) => void;
}

/** JSON boundary for public core objects; never exposes server options or TLS material. */
export function jsonValue(
  value: object | string | number | boolean | null | undefined,
): JsonValue {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return "[Not serializable]";
  }
}

export function createBoardPlugin(
  store: BoardStorageAdapter,
  callbacks?: BoardPluginCallbacks,
): BoardPluginInstance {
  const active = new Map<string, OCPPServerClient>();
  let pending = Promise.resolve();
  // Preserve ordering even when a custom storage adapter is asynchronous.
  const write = (operation: () => void | Promise<void>) => {
    const task = pending.then(operation);
    pending = task.catch(() => {});
    return task;
  };
  const system = (
    type: SystemEvent["type"],
    message: string,
    identity?: string,
    details?: SystemEvent["details"],
  ) =>
    write(() =>
      store.addSystemEvent({
        id: randomUUID(),
        type,
        message,
        identity,
        details,
        timestamp: new Date().toISOString(),
      }),
    );
  const error = (
    client: OCPPServerClient,
    category: ErrorRecord["category"],
    err: Error,
    method?: string,
  ) =>
    write(() =>
      store.addError({
        id: randomUUID(),
        category,
        identity: client.identity,
        message: err.message,
        stack: err.stack,
        method,
        timestamp: new Date().toISOString(),
      }),
    );
  const security = (record: SecurityEventRecord) =>
    write(async () => {
      await store.addSecurityEvent(record);
      callbacks?.onSecurityEvent?.(record);
    });

  const hooks: OCPPPlugin = {
    onInit(server) {
      plugin.serverRef = server;
    },
    onConnection(client) {
      active.set(client.identity, client);
      const session = jsonValue(client.session);
      return write(() =>
        store.addConnection({
          identity: client.identity,
          remoteAddress: client.handshake.remoteAddress ?? "",
          protocol: client.protocol ?? "",
          connectedAt: new Date().toISOString(),
          status: "online",
          sessionData:
            session && typeof session === "object" && !Array.isArray(session)
              ? session
              : {},
          securityProfile: client.securityProfile,
        }),
      );
    },
    onDisconnect(client, code, reason) {
      if (active.get(client.identity) !== client) return;
      active.delete(client.identity);
      return write(() => store.removeConnection(client.identity, code, reason));
    },
    onEviction(evicted, replacement) {
      return system(
        "EVICTION",
        `Connection replaced for ${evicted.identity}`,
        evicted.identity,
        { replacedBy: replacement.identity },
      );
    },
    onMessage(client, payload) {
      const message = toStoredMessage(
        payload,
        client.identity,
        client.protocol ?? "",
      );
      return write(async () => {
        await store.addMessage(message);
        callbacks?.onMessage?.(message);
      });
    },
    onSecurityEvent(event) {
      // AUTH_FAILED is already emitted by the core alongside onAuthFailed.
      const category = event.type.includes("AUTH")
        ? "AUTH_FAILED"
        : event.type.includes("LIMIT")
          ? "RATE_LIMIT"
          : event.type === "INVALID_PAYLOAD"
            ? "PROTOCOL_VIOLATION"
            : "ANOMALY";
      const details = jsonValue(event.details ?? {});
      return security({
        id: randomUUID(),
        category,
        identity: event.identity ?? "server",
        message: event.type.replaceAll("_", " "),
        severity: category === "AUTH_FAILED" ? "high" : "medium",
        details:
          details && typeof details === "object" && !Array.isArray(details)
            ? details
            : {},
        timestamp: event.timestamp,
      });
    },
    onRateLimitExceeded(client) {
      return security({
        id: randomUUID(),
        category: "RATE_LIMIT",
        identity: client.identity,
        message: "Station message rate limit exceeded",
        severity: "medium",
        timestamp: new Date().toISOString(),
      });
    },
    onError(client, err) {
      return error(client, "PROTOCOL_ERROR", err);
    },
    onBadMessage(client, _raw, err) {
      return error(client, "BAD_MESSAGE", err);
    },
    onValidationFailure(client, _message, err) {
      return error(client, "VALIDATION_FAILURE", err);
    },
    onHandlerError(client, method, err) {
      return error(client, "HANDLER_ERROR", err, method);
    },
    onBackpressure(client, bufferedAmount) {
      return system(
        "BACKPRESSURE",
        `Send buffer: ${bufferedAmount} bytes`,
        client.identity,
        { bufferedAmount },
      );
    },
    onPongTimeout(client) {
      return system(
        "PONG_TIMEOUT",
        "Peer did not answer WebSocket ping",
        client.identity,
      );
    },
    onReconfigure(options) {
      return system("RECONFIGURE", "Server configuration updated", undefined, {
        changedKeys: Object.keys(options),
      });
    },
    onTLSUpdate() {
      return system("TLS_UPDATE", "Server TLS certificates reloaded");
    },
    onClosing() {
      return system("SHUTDOWN", "Server is draining connections");
    },
    async onClose() {
      await pending;
      active.clear();
      plugin.serverRef = undefined;
    },
    name: "ocpp-ws-board",
  };
  const plugin: BoardPluginInstance = { ...hooks, flush: () => pending };
  return plugin;
}

function toStoredMessage(
  payload: MessageEventPayload,
  identity: string,
  protocol: string,
): StoredMessage {
  const frame = jsonValue(payload.message);
  const values = Array.isArray(frame) ? frame : [];
  const kind = values[0];
  const type: StoredMessage["type"] =
    kind === 3
      ? "CALLRESULT"
      : kind === 4
        ? "CALLERROR"
        : kind === 5
          ? "CALLRESULTERROR"
          : kind === 6
            ? "SEND"
            : "CALL";
  const isCall = type === "CALL" || type === "SEND";
  const ctx = payload.ctx;
  const method =
    "method" in ctx && typeof ctx.method === "string"
      ? ctx.method
      : isCall && typeof values[2] === "string"
        ? values[2]
        : "Response";
  const response =
    type === "CALLERROR" || type === "CALLRESULTERROR"
      ? {
          errorCode: values[2] ?? null,
          errorDescription: values[3] ?? null,
          errorDetails: values[4] ?? null,
        }
      : values[2];
  return {
    id: randomUUID(),
    identity,
    direction: payload.direction,
    type,
    method,
    messageId: typeof values[1] === "string" ? values[1] : "",
    params: isCall ? values[3] : response,
    payload: isCall ? undefined : response,
    timestamp: ctx.timestamp ?? new Date().toISOString(),
    latencyMs: ctx.latencyMs,
    protocol,
    source: "ocpp-ws-io",
  };
}
