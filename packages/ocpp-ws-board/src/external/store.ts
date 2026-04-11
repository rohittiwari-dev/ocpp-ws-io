import { deflateSync, inflateSync } from "node:zlib";
import type {
  BoardStorageAdapter,
  ConnectionRecord,
  ErrorRecord,
  OverviewStats,
  ProxyEvent,
  SecurityEventRecord,
  SmartChargeSession,
  StoredMessage,
  SystemEvent,
  TelemetrySnapshot,
} from "./types.js";

// ─── Ring Buffer (Compressed) ─────────────────────────────────────

class CompressedRingBuffer<T> {
  private buffer: Buffer[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.buffer = new Array<Buffer>(capacity);
  }

  push(item: T): void {
    const jsonStr = JSON.stringify(item);
    const compressed = deflateSync(Buffer.from(jsonStr, "utf-8"));
    this.buffer[this.head] = compressed;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  toArray(): T[] {
    const result: T[] = [];
    const ordered =
      this.count < this.capacity
        ? this.buffer.slice(0, this.count)
        : [...this.buffer.slice(this.head), ...this.buffer.slice(0, this.head)];

    for (const buf of ordered) {
      if (!buf) continue;
      const decompressed = inflateSync(buf);
      result.push(JSON.parse(decompressed.toString("utf-8")));
    }
    return result;
  }

  /**
   * Remove all items matching a predicate by rebuilding the buffer.
   * Returns the number of items removed.
   */
  removeWhere(predicate: (item: T) => boolean): number {
    const items = this.toArray();
    const kept = items.filter((item) => !predicate(item));
    const removed = items.length - kept.length;
    if (removed === 0) return 0;

    // Rebuild buffer with surviving items
    this.buffer = new Array<Buffer>(this.capacity);
    this.head = 0;
    this.count = 0;
    for (const item of kept) {
      this.push(item);
    }
    return removed;
  }

  get length(): number {
    return this.count;
  }

  clear(): void {
    this.buffer = new Array<Buffer>(this.capacity);
    this.head = 0;
    this.count = 0;
  }
}

// ─── Compressed Memory Store ──────────────────────────────────────

export class CompressedMemoryStore implements BoardStorageAdapter {
  protected connections = new Map<string, ConnectionRecord>();
  private readonly messages: CompressedRingBuffer<StoredMessage>;
  private readonly proxyEvents: CompressedRingBuffer<ProxyEvent>;
  private readonly smartChargeHistory: CompressedRingBuffer<unknown>;
  readonly smartChargeSessions = new Map<string, SmartChargeSession>();
  smartChargeConfig: Record<string, unknown> = {};
  smartChargeConnected = false;
  proxyConnected = false;
  dispatchErrors: unknown[] = [];

  // Observability
  private readonly securityEvents: CompressedRingBuffer<SecurityEventRecord>;
  private readonly errors: CompressedRingBuffer<ErrorRecord>;
  private readonly systemEvents: CompressedRingBuffer<SystemEvent>;

  private peakConnections = 0;
  private totalMessageCount = 0;
  private errorTotalCount = 0;
  private latencySum = 0;
  private latencyCount = 0;
  private msgTimestamps: number[] = [];
  readonly startedAt = Date.now();
  private telemetryHistory = new CompressedRingBuffer<
    TelemetrySnapshot & { time: string }
  >(60);

  constructor(
    maxMessages = 10000, // Increased defaults due to compression
    maxProxyEvents = 2000,
    maxSmartChargeHistory = 1000,
  ) {
    this.messages = new CompressedRingBuffer<StoredMessage>(maxMessages);
    this.proxyEvents = new CompressedRingBuffer<ProxyEvent>(maxProxyEvents);
    this.smartChargeHistory = new CompressedRingBuffer<unknown>(
      maxSmartChargeHistory,
    );
    this.securityEvents = new CompressedRingBuffer<SecurityEventRecord>(1000);
    this.errors = new CompressedRingBuffer<ErrorRecord>(2000);
    this.systemEvents = new CompressedRingBuffer<SystemEvent>(1000);
  }

  // ── Connections ──────────────────────────────────────────────────

  async addConnection(conn: ConnectionRecord): Promise<void> {
    this.connections.set(conn.identity, conn);
    const online = [...this.connections.values()].filter(
      (c) => c.status === "online",
    ).length;
    if (online > this.peakConnections) this.peakConnections = online;
  }

  async removeConnection(
    identity: string,
    _code?: number,
    _reason?: string,
  ): Promise<void> {
    const conn = this.connections.get(identity);
    if (conn) {
      conn.status = "offline";
      conn.disconnectedAt = new Date().toISOString();
    }
  }

  async evictConnection(identity: string): Promise<void> {
    const conn = this.connections.get(identity);
    if (conn) {
      conn.status = "evicted";
      conn.disconnectedAt = new Date().toISOString();
    }
  }

  async getConnections(): Promise<ConnectionRecord[]> {
    return [...this.connections.values()];
  }

  async getConnection(identity: string): Promise<ConnectionRecord | undefined> {
    return this.connections.get(identity);
  }

  async purgeConnection(identity: string): Promise<void> {
    this.connections.delete(identity);

    // Remove all messages for this identity
    this.messages.removeWhere((m) => m.identity === identity);

    // Remove all security events for this identity
    this.securityEvents.removeWhere((e) => e.identity === identity);

    // Remove all errors for this identity
    this.errors.removeWhere((e) => e.identity === identity);

    // Remove all system events for this identity
    this.systemEvents.removeWhere((e) => (e as any).identity === identity);
  }

  // ── Messages ─────────────────────────────────────────────────────

  async addMessage(msg: StoredMessage): Promise<void> {
    this.messages.push(msg);
    this.totalMessageCount++;
    this.msgTimestamps.push(Date.now());
    if (msg.type === "CALLERROR") {
      this.errorTotalCount++;
      if (msg.identity) {
        const conn = this.connections.get(msg.identity);
        if (conn) {
          conn.errorCount = (conn.errorCount || 0) + 1;
        }
      }
    }
    if (msg.latencyMs != null) {
      this.latencySum += msg.latencyMs;
      this.latencyCount++;
    }
  }

  async getMessages(opts?: {
    limit?: number;
    offset?: number;
    identity?: string;
    method?: string;
    direction?: string;
  }): Promise<StoredMessage[]> {
    let result = this.messages.toArray().reverse();
    if (opts?.identity)
      result = result.filter((m) => m.identity === opts.identity);
    if (opts?.method) result = result.filter((m) => m.method === opts.method);
    if (opts?.direction)
      result = result.filter((m) => m.direction === opts.direction);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    return result.slice(offset, offset + limit);
  }

  // ── Proxy Events ─────────────────────────────────────────────────

  async addProxyEvent(event: ProxyEvent): Promise<void> {
    this.proxyEvents.push(event);
  }

  async getProxyEvents(): Promise<ProxyEvent[]> {
    return this.proxyEvents.toArray().reverse();
  }

  // ── Smart Charge ─────────────────────────────────────────────────

  async addSmartChargeEvent(event: unknown): Promise<void> {
    this.smartChargeHistory.push(event);
  }

  // ── Security Events ─────────────────────────────────────────────

  async addSecurityEvent(event: SecurityEventRecord): Promise<void> {
    this.securityEvents.push(event);
  }

  async getSecurityEvents(opts?: {
    limit?: number;
    offset?: number;
    category?: string;
    identity?: string;
  }): Promise<SecurityEventRecord[]> {
    let result = this.securityEvents.toArray().reverse();
    if (opts?.category)
      result = result.filter((e) => e.category === opts.category);
    if (opts?.identity)
      result = result.filter((e) => e.identity === opts.identity);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    return result.slice(offset, offset + limit);
  }

  async getSecurityEventCount(): Promise<number> {
    return this.securityEvents.length;
  }

  // ── Errors ──────────────────────────────────────────────────────

  async addError(error: ErrorRecord): Promise<void> {
    this.errors.push(error);
    this.errorTotalCount++;
    if (
      error.identity &&
      error.identity !== "server" &&
      error.identity !== "unknown"
    ) {
      const conn = this.connections.get(error.identity);
      if (conn) {
        conn.errorCount = (conn.errorCount || 0) + 1;
      }
    }
  }

  async getErrors(opts?: {
    limit?: number;
    offset?: number;
    category?: string;
    identity?: string;
  }): Promise<ErrorRecord[]> {
    let result = this.errors.toArray().reverse();
    if (opts?.category)
      result = result.filter((e) => e.category === opts.category);
    if (opts?.identity)
      result = result.filter((e) => e.identity === opts.identity);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    return result.slice(offset, offset + limit);
  }

  async getErrorCount(): Promise<number> {
    return this.errors.length;
  }

  // ── System Events ───────────────────────────────────────────────

  async addSystemEvent(event: SystemEvent): Promise<void> {
    this.systemEvents.push(event);
  }

  async getSystemEvents(opts?: {
    limit?: number;
    offset?: number;
    type?: string;
  }): Promise<SystemEvent[]> {
    let result = this.systemEvents.toArray().reverse();
    if (opts?.type) result = result.filter((e) => e.type === opts.type);
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 100;
    return result.slice(offset, offset + limit);
  }

  // ── Telemetry ────────────────────────────────────────────────────

  async getTelemetry(): Promise<TelemetrySnapshot> {
    const now = Date.now();
    this.msgTimestamps = this.msgTimestamps.filter((t) => now - t < 10_000);
    const mps = this.msgTimestamps.length / 10;
    const online = [...this.connections.values()].filter(
      (c) => c.status === "online",
    ).length;
    const mem = process.memoryUsage();

    const snapshot = {
      messagesPerSecond: Math.round(mps * 100) / 100,
      avgLatencyMs:
        this.latencyCount > 0
          ? Math.round((this.latencySum / this.latencyCount) * 100) / 100
          : 0,
      errorRate:
        this.totalMessageCount > 0
          ? Math.round(
              (this.errorTotalCount / this.totalMessageCount) * 10000,
            ) / 100
          : 0,
      connectionCount: online,
      peakConnections: this.peakConnections,
      uptimeSeconds: Math.floor((now - this.startedAt) / 1000),
      memoryUsage: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      totalMessages: this.totalMessageCount,
    };

    this.telemetryHistory.push({
      ...snapshot,
      time: new Date(now).toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    });

    return snapshot;
  }

  async getTelemetryHistory(): Promise<
    Array<TelemetrySnapshot & { time: string }>
  > {
    return this.telemetryHistory.toArray();
  }

  async getOverview(): Promise<OverviewStats> {
    const telemetry = await this.getTelemetry();
    const recentMessages = (await this.getMessages({ limit: 10 })).slice(0, 10);
    return {
      ...telemetry,
      connectedClients: telemetry.connectionCount,
      totalConnections: this.connections.size,
      recentMessages,
      securityEventCount: this.securityEvents.length,
      errorCount: this.errors.length,
      systemEventCount: this.systemEvents.length,
    };
  }
}
