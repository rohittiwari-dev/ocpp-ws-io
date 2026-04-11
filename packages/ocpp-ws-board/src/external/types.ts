// ─── Board Configuration Types ────────────────────────────────────

export interface BoardOptions {
  basePath?: string;
  auth: BoardAuthConfig;
  store?: BoardStorageAdapter;
  sseHeartbeatMs?: number;
}

export type BoardAuthConfig =
  | { mode: "token"; token: string; sessionTtlMs?: number }
  | {
      mode: "credentials";
      username: string;
      password: string;
      sessionTtlMs?: number;
    }
  | {
      mode: "custom";
      validate: (creds: LoginCredentials) => AuthResult | Promise<AuthResult>;
      sessionTtlMs?: number;
    }
  | { mode: "none" };

export interface LoginCredentials {
  token?: string;
  username?: string;
  password?: string;
}

export type AuthResult = false | { id?: string; name: string };

export interface SessionInfo {
  user: { id?: string; name: string };
  expiresAt: number;
}

export interface SessionResponse {
  authenticated: boolean;
  user?: { id?: string; name: string };
  authMode?: string;
}

export interface LoginResponse {
  success: boolean;
  user?: { name: string };
  error?: string;
}

// ─── Connection Record ────────────────────────────────────────────

export interface ConnectionRecord {
  identity: string;
  remoteAddress: string;
  protocol: string;
  connectedAt: string;
  disconnectedAt?: string;
  status: "online" | "offline" | "evicted";
  sessionData: Record<string, unknown>;
  securityProfile: number;
  errorCount?: number;
}

// ─── Stored Message ───────────────────────────────────────────────

export interface StoredMessage {
  id: string;
  identity: string;
  direction: "IN" | "OUT";
  type: "CALL" | "CALLRESULT" | "CALLERROR";
  method: string;
  messageId: string;
  params?: unknown;
  payload?: unknown;
  timestamp: string;
  latencyMs?: number;
  protocol: string;
  source: "ocpp-ws-io" | "smart-charge" | "protocol-proxy";
}

// ─── Telemetry Snapshot ───────────────────────────────────────────

export interface TelemetrySnapshot {
  messagesPerSecond: number;
  avgLatencyMs: number;
  errorRate: number;
  connectionCount: number;
  peakConnections: number;
  uptimeSeconds: number;
  memoryUsage: { rss: number; heapUsed: number; heapTotal: number };
  totalMessages: number;
}

// ─── Overview Stats ───────────────────────────────────────────────

export interface OverviewStats {
  connectedClients: number;
  totalConnections: number;
  messagesPerSecond: number;
  avgLatencyMs: number;
  errorRate: number;
  uptimeSeconds: number;
  recentMessages: StoredMessage[];
  securityEventCount: number;
  errorCount: number;
  systemEventCount: number;
}

// ─── Smart Charge Types ───────────────────────────────────────────

export interface SmartChargeSession {
  clientId: string;
  connectorId: number;
  priority: number;
  allocatedKw?: number;
  phases?: number;
  maxHardwarePowerKw?: number;
}

export interface SmartChargeState {
  connected: boolean;
  sessions: SmartChargeSession[];
  engineConfig?: Record<string, unknown>;
  lastOptimized?: unknown[];
  dispatchErrors: unknown[];
}

// ─── Proxy Event Types ────────────────────────────────────────────

export interface ProxyEvent {
  identity: string;
  direction: "IN" | "OUT";
  sourceProtocol: string;
  targetProtocol: string;
  latencyMs?: number;
  error?: string;
  timestamp: string;
}

export interface ProxyState {
  connected: boolean;
  events: ProxyEvent[];
  translationErrors: number;
  totalTranslations: number;
}

// ─── Security Event Record ────────────────────────────────────────

export type SecurityEventCategory =
  | "AUTH_FAILED"
  | "RATE_LIMIT"
  | "ANOMALY"
  | "PROTOCOL_VIOLATION"
  | "POLICY_REJECTION";

export interface SecurityEventRecord {
  id: string;
  category: SecurityEventCategory;
  identity: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  details?: Record<string, unknown>;
  timestamp: string;
}

// ─── Error Record ─────────────────────────────────────────────────

export type ErrorCategory =
  | "BAD_MESSAGE"
  | "VALIDATION_FAILURE"
  | "HANDLER_ERROR"
  | "PROTOCOL_ERROR"
  | "UNKNOWN";

export interface ErrorRecord {
  id: string;
  category: ErrorCategory;
  identity: string;
  message: string;
  method?: string;
  stack?: string;
  timestamp: string;
}

// ─── System Event ─────────────────────────────────────────────────

export type SystemEventType =
  | "EVICTION"
  | "BACKPRESSURE"
  | "PONG_TIMEOUT"
  | "RECONFIGURE"
  | "SHUTDOWN";

export interface SystemEvent {
  id: string;
  type: SystemEventType;
  identity?: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

// ─── Storage Adapter ──────────────────────────────────────────────

export interface BoardStorageAdapter {
  // Connections
  addConnection(conn: ConnectionRecord): Promise<void> | void;
  removeConnection(
    identity: string,
    code?: number,
    reason?: string,
  ): Promise<void> | void;
  evictConnection(identity: string): Promise<void> | void;
  getConnections(): Promise<ConnectionRecord[]> | ConnectionRecord[];
  getConnection(
    identity: string,
  ): Promise<ConnectionRecord | undefined> | ConnectionRecord | undefined;
  purgeConnection(identity: string): Promise<void> | void;

  // Messages
  addMessage(msg: StoredMessage): Promise<void> | void;
  getMessages(opts?: {
    limit?: number;
    offset?: number;
    identity?: string;
    method?: string;
    direction?: string;
  }): Promise<StoredMessage[]> | StoredMessage[];

  // Proxy Events
  addProxyEvent(event: ProxyEvent): Promise<void> | void;
  getProxyEvents(): Promise<ProxyEvent[]> | ProxyEvent[];

  // Smart Charge
  addSmartChargeEvent(event: unknown): Promise<void> | void;

  // Security Events
  addSecurityEvent(event: SecurityEventRecord): Promise<void> | void;
  getSecurityEvents(opts?: {
    limit?: number;
    offset?: number;
    category?: string;
    identity?: string;
  }): Promise<SecurityEventRecord[]> | SecurityEventRecord[];
  getSecurityEventCount(): Promise<number> | number;

  // Errors
  addError(error: ErrorRecord): Promise<void> | void;
  getErrors(opts?: {
    limit?: number;
    offset?: number;
    category?: string;
    identity?: string;
  }): Promise<ErrorRecord[]> | ErrorRecord[];
  getErrorCount(): Promise<number> | number;

  // System Events
  addSystemEvent(event: SystemEvent): Promise<void> | void;
  getSystemEvents(opts?: {
    limit?: number;
    offset?: number;
    type?: string;
  }): Promise<SystemEvent[]> | SystemEvent[];

  // Subsystem States (Proxy / SmartCharge)
  smartChargeConnected?: boolean;
  smartChargeSessions?: Map<string, SmartChargeSession>;
  smartChargeConfig?: Record<string, unknown>;
  dispatchErrors?: unknown[];
  proxyConnected?: boolean;

  // Aggregation
  getTelemetry(): Promise<TelemetrySnapshot> | TelemetrySnapshot;
  getTelemetryHistory():
    | Promise<Array<TelemetrySnapshot & { time: string }>>
    | Array<TelemetrySnapshot & { time: string }>;
  getOverview(): Promise<OverviewStats> | OverviewStats;
}
