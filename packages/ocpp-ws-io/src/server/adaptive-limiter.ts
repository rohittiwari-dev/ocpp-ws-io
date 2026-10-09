import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { cpus, freemem, totalmem } from "node:os";

// ── Container-aware resource limits ───────────────────────────────
//
// os.cpus() / totalmem() describe the HOST. Inside a container with a quota
// they are the wrong denominator entirely, which left the adaptive limiter
// either blind (a small container on a big host never looks busy) or
// permanently tripped (a busy host makes every container throttle). cgroup v2
// exposes the real limits; v1 paths are checked as a fallback, and the host
// values are used when neither is present.

function readFirst(paths: string[]): string | null {
  for (const p of paths) {
    try {
      return readFileSync(p, "utf8").trim();
    } catch {
      // Not this one.
    }
  }
  return null;
}

let cachedCpuLimit: number | null = null;

/** Cores this process may use, honouring a cgroup CPU quota. */
export function cpuLimit(): number {
  if (cachedCpuLimit !== null) return cachedCpuLimit;
  const hostCores = Math.max(1, cpus().length);

  // cgroup v2: "<quota> <period>", or "max <period>" when unlimited.
  const v2 = readFirst(["/sys/fs/cgroup/cpu.max"]);
  if (v2) {
    const [quota, period] = v2.split(/\s+/);
    const q = Number(quota);
    const p = Number(period);
    if (quota !== "max" && Number.isFinite(q) && Number.isFinite(p) && p > 0) {
      cachedCpuLimit = Math.max(0.1, Math.min(hostCores, q / p));
      return cachedCpuLimit;
    }
  }

  // cgroup v1: separate quota and period files.
  const q1 = readFirst(["/sys/fs/cgroup/cpu/cpu.cfs_quota_us"]);
  const p1 = readFirst(["/sys/fs/cgroup/cpu/cpu.cfs_period_us"]);
  if (q1 && p1) {
    const q = Number(q1);
    const p = Number(p1);
    if (q > 0 && p > 0) {
      cachedCpuLimit = Math.max(0.1, Math.min(hostCores, q / p));
      return cachedCpuLimit;
    }
  }

  cachedCpuLimit = hostCores;
  return cachedCpuLimit;
}

/** Memory in use and available to this process, honouring a cgroup limit. */
export function memoryUsage(): { used: number; total: number } {
  const v2Max = readFirst(["/sys/fs/cgroup/memory.max"]);
  const v2Cur = readFirst(["/sys/fs/cgroup/memory.current"]);
  if (v2Max && v2Cur && v2Max !== "max") {
    const total = Number(v2Max);
    const used = Number(v2Cur);
    if (total > 0 && Number.isFinite(used)) return { used, total };
  }

  const v1Max = readFirst(["/sys/fs/cgroup/memory/memory.limit_in_bytes"]);
  const v1Cur = readFirst(["/sys/fs/cgroup/memory/memory.usage_in_bytes"]);
  if (v1Max && v1Cur) {
    const total = Number(v1Max);
    const used = Number(v1Cur);
    // v1 reports an absurd sentinel when unlimited; ignore it.
    if (total > 0 && total < Number.MAX_SAFE_INTEGER / 2 && used > 0) {
      return { used, total };
    }
  }

  const total = totalmem();
  return { used: total - freemem(), total };
}

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
    // Divide by the cores this process may actually use. os.cpus() reports the
    // HOST's core count, so a container limited to 1 core on a 64-core machine
    // looked 1/64th as busy as it was — the limiter never engaged however hard
    // the process was working.
    const cpuPercent =
      ((cpuUsage.user + cpuUsage.system) / 1000 / elapsedMs / cpuLimit()) * 100;
    this._prevCpuUsage = process.cpuUsage();
    this._prevTimestamp = now;

    // ── Memory measurement ──
    // Prefer the cgroup limit over host memory for the same reason: host RAM
    // says nothing about this container's headroom, and on a busy shared host
    // it made every container throttle for someone else's usage.
    const { used, total } = memoryUsage();
    const memPercent = (used / total) * 100;

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
