import { EventEmitter } from "node:events";
import { cpus, freemem, totalmem } from "node:os";

// ─── Adaptive Rate Limiter ──────────────────────────────────────
//
// Monitors CPU and memory usage at 2s intervals, adjusting a
// rate multiplier that other components (connection-level and
// per-message rate limiters) can query to dynamically tighten
// or relax limits under load.

export interface AdaptiveLimiterOptions {
  /** CPU usage % at which limits start tightening (default: 70) */
  cpuThresholdPercent?: number;
  /** Memory usage % at which limits start tightening (default: 85) */
  memThresholdPercent?: number;
  /** Cooldown before the multiplier recovers after an overload (default: 10000ms) */
  cooldownMs?: number;
  /** How often to sample system metrics (default: 2000ms) */
  sampleIntervalMs?: number;
}

export interface AdaptedEvent {
  multiplier: number;
  cpuPercent: number;
  memPercent: number;
}

export class AdaptiveLimiter extends EventEmitter {
  private _cpuThreshold: number;
  private _memThreshold: number;
  private _cooldownMs: number;
  private _sampleInterval: number;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _lastOverloadTime = 0;
  private _multiplier = 1;
  private _prevCpuUsage: NodeJS.CpuUsage | null = null;
  private _prevTimestamp = 0;

  constructor(options: AdaptiveLimiterOptions = {}) {
    super();
    this._cpuThreshold = options.cpuThresholdPercent ?? 70;
    this._memThreshold = options.memThresholdPercent ?? 85;
    this._cooldownMs = options.cooldownMs ?? 10_000;
    this._sampleInterval = options.sampleIntervalMs ?? 2_000;
  }

  /** Current rate multiplier: 1.0 = normal, 0.25 = heavily throttled */
  get multiplier(): number {
    return this._multiplier;
  }

  /** Start periodic sampling */
  start(): void {
    if (this._timer) return;
    this._prevCpuUsage = process.cpuUsage();
    this._prevTimestamp = Date.now();
    this._timer = setInterval(() => this._sample(), this._sampleInterval);
    // Don't keep the process alive just for adaptive limiting
    if (this._timer.unref) this._timer.unref();
  }

  /** Stop sampling and reset multiplier */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._multiplier = 1;
  }

  private _sample(): void {
    const now = Date.now();

    // ── CPU measurement ──
    const cpuUsage = process.cpuUsage(this._prevCpuUsage ?? undefined);
    const elapsedMs = now - this._prevTimestamp;
    // CPU usage is in microseconds; normalize to percentage across all cores
    const cpuPercent =
      ((cpuUsage.user + cpuUsage.system) / 1000 / elapsedMs / cpus().length) *
      100;
    this._prevCpuUsage = process.cpuUsage();
    this._prevTimestamp = now;

    // ── Memory measurement ──
    const total = totalmem();
    const free = freemem();
    const memPercent = ((total - free) / total) * 100;

    // ── Decision logic ──
    const cpuOverload = cpuPercent > this._cpuThreshold;
    const memOverload = memPercent > this._memThreshold;
    const prevMultiplier = this._multiplier;

    if (cpuOverload || memOverload) {
      this._lastOverloadTime = now;
      // Progressive throttling: 1.0 → 0.5 → 0.25
      this._multiplier = Math.max(0.25, this._multiplier * 0.5);
    } else if (now - this._lastOverloadTime > this._cooldownMs) {
      // Gradual recovery after cooldown
      this._multiplier = Math.min(1, this._multiplier + 0.1);
    }

    // Emit only when multiplier changes
    if (this._multiplier !== prevMultiplier) {
      this.emit("adapted", {
        multiplier: this._multiplier,
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        memPercent: Math.round(memPercent * 100) / 100,
      } satisfies AdaptedEvent);
    }
  }

  // Typed event emitter overrides
  override on(event: "adapted", listener: (data: AdaptedEvent) => void): this {
    return super.on(event, listener);
  }

  override emit(event: "adapted", data: AdaptedEvent): boolean {
    return super.emit(event, data);
  }
}
