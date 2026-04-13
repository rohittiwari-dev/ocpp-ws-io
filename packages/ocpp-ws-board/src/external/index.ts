// ─── Main Exports ─────────────────────────────────────────────────

// ─── Adapters ─────────────────────────────────────────────────────
export { expressAdapter } from "./adapters/express.js";
export { honoAdapter } from "./adapters/hono.js";
export { createAuthLayer } from "./auth.js";
export { createBoard } from "./board.js";
// ─── Connectors ───────────────────────────────────────────────────
export type { BoardPluginCallbacks } from "./plugin.js";
export { createBoardPlugin } from "./plugin.js";
export { SSEBroker } from "./sse.js";
export { CompressedMemoryStore } from "./store.js";
// ─── Types ────────────────────────────────────────────────────────
export type {
  AuthResult,
  BoardAuthConfig,
  BoardOptions,
  ConnectionRecord,
  ErrorCategory,
  ErrorRecord,
  LoginCredentials,
  LoginResponse,
  OverviewStats,
  ProxyEvent,
  ProxyState,
  SecurityEventCategory,
  SecurityEventRecord,
  SessionInfo,
  SessionResponse,
  SmartChargeSession,
  SmartChargeState,
  StoredMessage,
  SystemEvent,
  SystemEventType,
  TelemetrySnapshot,
} from "./types.js";

// ─── Convenience default ──────────────────────────────────────────
import { createBoard } from "./board.js";
export default createBoard;
