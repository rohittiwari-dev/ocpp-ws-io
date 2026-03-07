import { nanoid } from "nanoid";
import { BrowserOCPPClient } from "ocpp-ws-io/browser";
import {
  type ChargingProfile,
  type LocalAuthEntry,
  type StationConfigKey,
  useEmulatorStore,
} from "../store/emulatorStore";

type Timer = ReturnType<typeof setInterval>;

// ─── Per-Charger Accessors ────────────────────────────────────────────────────

function getSlotState(chargerId: string) {
  const s = useEmulatorStore.getState();
  const slot = s.chargers.find((c) => c.id === chargerId);
  if (!slot) throw new Error(`No charger slot for id: ${chargerId}`);
  return { slot, runtime: slot.runtime, config: slot.config, store: s };
}

class OCPPService {
  private chargerId: string;
  private client: BrowserOCPPClient | null = null;
  private heartbeatTimer: Timer | null = null;
  private meterTimers: Record<number, Timer> = {};
  private uploadTimer: Timer | null = null;
  private reservationTimers: Record<number, Timer> = {};
  private autoChargeTimers: Record<number, Timer> = {};

  constructor(chargerId: string) {
    this.chargerId = chargerId;
  }

  // ─── Store helpers ────────────────────────────────────────────────────────

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: we may need this later
  private get store() {
    return useEmulatorStore.getState();
  }

  // ─── Connection ────────────────────────────────────────────────────────────

  async connect() {
    const { config, store } = getSlotState(this.chargerId);
    if (this.client) await this.disconnect();

    store.setStatus(this.chargerId, "connecting");

    try {
      this.client = new BrowserOCPPClient({
        endpoint: config.endpoint,
        identity: config.chargePointId,
        protocols: [config.ocppVersion],
        reconnect: true,
        maxReconnects: 5,
        logging: false,
        ...(config.securityProfile === 1 && config.basicAuthPassword
          ? { password: config.basicAuthPassword }
          : {}),
      });

      this.client.on("open", () => {
        const s = useEmulatorStore.getState();
        s.setStatus(this.chargerId, "connected");
        s.setConnectedAt(this.chargerId, Date.now());
        s.addLog(this.chargerId, {
          direction: "System",
          action: "Connected",
          payload: { url: config.endpoint, protocol: config.ocppVersion },
        });
        this.sendBootNotification();
      });

      this.client.on("error", (err: Event | Error) => {
        const message =
          err instanceof Error ? err.message : "WebSocket error event";
        const s = useEmulatorStore.getState();
        s.setStatus(this.chargerId, "faulted");
        s.addLog(this.chargerId, {
          direction: "Error",
          action: "WebSocket Error",
          payload: { message },
        });
      });

      this.client.on("close", (info: { code: number; reason: string }) => {
        const s = useEmulatorStore.getState();
        s.setStatus(this.chargerId, "disconnected");
        s.setConnectedAt(this.chargerId, null);
        this.clearAllTimers();
        s.addLog(this.chargerId, {
          direction: "System",
          action: "Disconnected",
          payload: { code: info.code, reason: info.reason },
        });
        const slot = s.chargers.find((c) => c.id === this.chargerId);
        const n = slot?.config.numberOfConnectors ?? 1;
        for (let i = 1; i <= n; i++) s.resetConnector(this.chargerId, i);
      });

      this.client.on("connecting", (info: { url: string }) => {
        useEmulatorStore.getState().addLog(this.chargerId, {
          direction: "System",
          action: "Connecting",
          payload: { url: info.url },
        });
      });

      this.client.on(
        "reconnect",
        (info: { attempt: number; delay: number }) => {
          useEmulatorStore.getState().addLog(this.chargerId, {
            direction: "System",
            action: "Reconnecting",
            payload: info,
          });
        },
      );

      this.registerHandlers();
      await this.client.connect();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to create client";
      useEmulatorStore.getState().setStatus(this.chargerId, "faulted");
      useEmulatorStore.getState().addLog(this.chargerId, {
        direction: "Error",
        action: "Connect Failed",
        payload: { message: msg },
      });
    }
  }

  async disconnect() {
    try {
      await this.client?.close({ code: 1000, reason: "User disconnect" });
    } catch (_) {}
    this.client = null;
    this.clearAllTimers();
    useEmulatorStore.getState().setStatus(this.chargerId, "disconnected");
  }

  private clearAllTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    Object.values(this.meterTimers).forEach(clearInterval);
    if (this.uploadTimer) clearInterval(this.uploadTimer);
    Object.values(this.reservationTimers).forEach(clearTimeout);
    Object.values(this.autoChargeTimers).forEach(clearInterval);
    this.heartbeatTimer = null;
    this.meterTimers = {};
    this.uploadTimer = null;
    this.reservationTimers = {};
    this.autoChargeTimers = {};
  }

  // ─── Incoming CSMS Handlers ───────────────────────────────────────────────

  /**
   * Wraps handler registration with configurable response delay.
   * If responseDelayMs > 0, the handler response is held for that duration.
   */
  private handleWithDelay(action: string, handler: (ctx: any) => any) {
    if (!this.client) return;
    this.client.handle(action, async (ctx: any) => {
      const { config } = getSlotState(this.chargerId);
      const delay = config.simulation.responseDelayMs;
      const result = handler(ctx);
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      return result;
    });
  }

  /** Dispatch to the right handler set based on configured OCPP version */
  private registerHandlers() {
    if (!this.client) return;
    const { config } = getSlotState(this.chargerId);
    if (config.ocppVersion === "ocpp1.6") {
      this.registerHandlers16();
    } else {
      // ocpp2.0.1 and ocpp2.1 share the same handler set
      this.registerHandlers201();
    }
  }

  private registerHandlers16() {
    if (!this.client) return;

    const cid = this.chargerId;

    // ── Reset ──
    this.client.handle("Reset", (ctx) => {
      const payload = ctx.params as { type: string };
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "Reset",
        payload,
        ocppMessageId: ctx.messageId,
      });
      if (payload.type === "Hard") {
        setTimeout(() => {
          this.disconnect();
          setTimeout(() => this.connect(), 1500);
        }, 300);
      }
      return { status: "Accepted" };
    });

    // ── RemoteStartTransaction ──
    this.client.handle("RemoteStartTransaction", (ctx) => {
      const payload = ctx.params as { connectorId?: number; idTag: string };
      const s = useEmulatorStore.getState();
      const slot = s.chargers.find((c) => c.id === cid);
      const connId = payload.connectorId ?? 1;
      s.addLog(cid, {
        direction: "Rx",
        action: "RemoteStartTransaction",
        payload,
        ocppMessageId: ctx.messageId,
      });
      if (slot?.runtime.connectors[connId]?.inTransaction)
        return { status: "Rejected" };
      setTimeout(() => this.startTransaction(connId, payload.idTag), 500);
      return { status: "Accepted" };
    });

    // ── RemoteStopTransaction ──
    this.client.handle("RemoteStopTransaction", (ctx) => {
      const payload = ctx.params as { transactionId: number };
      const s = useEmulatorStore.getState();
      const slot = s.chargers.find((c) => c.id === cid);
      s.addLog(cid, {
        direction: "Rx",
        action: "RemoteStopTransaction",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const n = slot?.config.numberOfConnectors ?? 1;
      let connId: number | null = null;
      for (let i = 1; i <= n; i++) {
        if (
          slot?.runtime.connectors[i]?.transactionId === payload.transactionId
        ) {
          connId = i;
          break;
        }
      }
      if (!connId) return { status: "Rejected" };
      setTimeout(() => this.stopTransaction(connId), 500);
      return { status: "Accepted" };
    });

    // ── TriggerMessage ──
    this.client.handle("TriggerMessage", (ctx) => {
      const payload = ctx.params as {
        requestedMessage: string;
        connectorId?: number;
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers.find((c) => c.id === cid);
      const connId = payload.connectorId ?? 1;
      s.addLog(cid, {
        direction: "Rx",
        action: "TriggerMessage",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const { requestedMessage } = payload;
      if (
        requestedMessage === "MeterValues" &&
        !slot?.runtime.connectors[connId]?.inTransaction
      )
        return { status: "Rejected" };
      setTimeout(() => {
        if (requestedMessage === "Heartbeat") this.sendHeartbeat();
        else if (requestedMessage === "BootNotification")
          this.sendBootNotification();
        else if (requestedMessage === "StatusNotification") {
          const st =
            useEmulatorStore.getState().chargers.find((c) => c.id === cid)
              ?.runtime.connectors[connId]?.status ?? "Available";
          this.sendStatusNotification(connId, st);
        } else if (requestedMessage === "MeterValues")
          this.sendMeterValues(connId);
        else if (requestedMessage === "DiagnosticsStatusNotification") {
          const isUp =
            useEmulatorStore.getState().chargers.find((c) => c.id === cid)
              ?.runtime.isUploading ?? false;
          this.sendDiagnosticsStatus(isUp ? "Uploading" : "Idle");
        } else if (requestedMessage === "FirmwareStatusNotification") {
          const fw =
            useEmulatorStore.getState().chargers.find((c) => c.id === cid)
              ?.config.simulation.firmwareStatus ?? "Downloaded";
          this.sendFirmwareStatus(fw);
        }
      }, 200);
      return { status: "Accepted" };
    });

    // ── GetConfiguration ──
    this.client.handle("GetConfiguration", (ctx) => {
      const payload = ctx.params as { key?: string[] };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "GetConfiguration",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const keys = payload?.key;
      const configurationKey = keys?.length
        ? slot.config.stationConfig.filter((k: StationConfigKey) =>
            keys.includes(k.key),
          )
        : slot.config.stationConfig;
      const unknownKey = keys?.length
        ? keys.filter(
            (k: string) =>
              !slot.config.stationConfig.find(
                (sc: StationConfigKey) => sc.key === k,
              ),
          )
        : [];
      return { configurationKey, unknownKey };
    });

    // ── ChangeConfiguration ──
    this.client.handle("ChangeConfiguration", (ctx) => {
      const payload = ctx.params as { key: string; value: string };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "ChangeConfiguration",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const found = slot.config.stationConfig.find(
        (k: StationConfigKey) => k.key === payload.key,
      );
      if (!found) return { status: "NotSupported" };
      if (found.readonly) return { status: "Rejected" };

      s.updateStationConfigKey(cid, payload.key, payload.value);

      // Reactivity Engine: Apply changes immediately
      if (payload.key === "HeartbeatInterval") {
        const interval = Number(payload.value);
        if (!Number.isNaN(interval) && interval > 0) {
          this.startHeartbeatTimer(interval);
        }
      }

      return { status: "Accepted" };
    });

    // ── UnlockConnector ──
    this.client.handle("UnlockConnector", (ctx) => {
      const payload = ctx.params as { connectorId: number };
      const s = useEmulatorStore.getState();
      const slot = s.chargers.find((c) => c.id === cid);
      s.addLog(cid, {
        direction: "Rx",
        action: "UnlockConnector",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const connector = slot?.runtime.connectors[payload.connectorId];
      return { status: connector?.unlockStatus ?? "UnlockFailed" };
    });

    // ── GetDiagnostics ──
    this.client.handle("GetDiagnostics", (ctx) => {
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "GetDiagnostics",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      this.startDiagnosticsUpload();
      return { fileName: slot.config.simulation.diagnosticFileName };
    });

    // ── UpdateFirmware ──
    this.client.handle("UpdateFirmware", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "UpdateFirmware",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      setTimeout(() => this.sendFirmwareStatus("Downloading"), 1000);
      setTimeout(() => this.sendFirmwareStatus("Downloaded"), 3000);
      setTimeout(() => this.sendFirmwareStatus("Installing"), 5000);
      setTimeout(() => this.sendFirmwareStatus("Installed"), 7000);
      return {};
    });

    // ── ClearCache ──
    this.client.handle("ClearCache", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "ClearCache",
        payload: {},
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── ChangeAvailability ──
    this.client.handle("ChangeAvailability", (ctx) => {
      const payload = ctx.params as {
        connectorId: number;
        type: "Inoperative" | "Operative";
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "ChangeAvailability",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const newStatus =
        payload.type === "Inoperative" ? "Unavailable" : "Available";
      if (payload.connectorId === 0) {
        for (let i = 1; i <= slot.config.numberOfConnectors; i++) {
          s.updateConnector(cid, i, { status: newStatus as any });
          this.sendStatusNotification(i, newStatus);
        }
      } else {
        s.updateConnector(cid, payload.connectorId, {
          status: newStatus as any,
        });
        this.sendStatusNotification(payload.connectorId, newStatus);
      }
      return { status: "Accepted" };
    });

    // ── ReserveNow ──
    this.client.handle("ReserveNow", (ctx) => {
      const payload = ctx.params as {
        connectorId: number;
        expiryDate: string;
        idTag: string;
        parentIdTag?: string;
        reservationId: number;
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "ReserveNow",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const conn = slot.runtime.connectors[payload.connectorId];
      if (!conn) return { status: "Rejected" };
      if (conn.inTransaction) return { status: "Occupied" };
      if (conn.status === "Faulted") return { status: "Faulted" };
      if (conn.status === "Unavailable") return { status: "Unavailable" };
      s.updateConnector(cid, payload.connectorId, {
        status: "Reserved",
        reservation: {
          reservationId: payload.reservationId,
          idTag: payload.idTag,
          expiryDate: payload.expiryDate,
          parentIdTag: payload.parentIdTag,
        },
      });
      this.sendStatusNotification(payload.connectorId, "Reserved");
      const expiryMs = new Date(payload.expiryDate).getTime() - Date.now();
      if (expiryMs > 0) {
        this.reservationTimers[payload.connectorId] = setTimeout(() => {
          const current = useEmulatorStore
            .getState()
            .chargers.find((c) => c.id === cid)?.runtime.connectors[
            payload.connectorId
          ];
          if (current?.reservation?.reservationId === payload.reservationId) {
            useEmulatorStore
              .getState()
              .updateConnector(cid, payload.connectorId, {
                status: "Available",
                reservation: null,
              });
            this.sendStatusNotification(payload.connectorId, "Available");
            useEmulatorStore.getState().addLog(cid, {
              direction: "System",
              action: "ReservationExpired",
              payload: {
                connectorId: payload.connectorId,
                reservationId: payload.reservationId,
              },
            });
          }
        }, expiryMs);
      }
      return { status: "Accepted" };
    });

    // ── CancelReservation ──
    this.client.handle("CancelReservation", (ctx) => {
      const payload = ctx.params as { reservationId: number };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) return { status: "Rejected" };
      s.addLog(cid, {
        direction: "Rx",
        action: "CancelReservation",
        payload,
        ocppMessageId: ctx.messageId,
      });
      for (let i = 1; i <= slot.config.numberOfConnectors; i++) {
        if (
          slot.runtime.connectors[i]?.reservation?.reservationId ===
          payload.reservationId
        ) {
          s.updateConnector(cid, i, { status: "Available", reservation: null });
          if (this.reservationTimers[i]) {
            clearTimeout(this.reservationTimers[i]);
            delete this.reservationTimers[i];
          }
          this.sendStatusNotification(i, "Available");
          return { status: "Accepted" };
        }
      }
      return { status: "Rejected" };
    });

    // ── SetChargingProfile ──
    this.client.handle("SetChargingProfile", (ctx) => {
      const payload = ctx.params as {
        connectorId: number;
        csChargingProfiles: ChargingProfile;
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "SetChargingProfile",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const conn = slot.runtime.connectors[payload.connectorId];
      if (!conn && payload.connectorId !== 0) return { status: "Rejected" };
      const profile = payload.csChargingProfiles;
      const targetId = payload.connectorId === 0 ? 1 : payload.connectorId;
      const existing = (
        slot.runtime.connectors[targetId]?.chargingProfiles ?? []
      ).filter(
        (p) =>
          !(
            p.chargingProfileId === profile.chargingProfileId &&
            p.stackLevel === profile.stackLevel
          ),
      );
      s.updateConnector(cid, targetId, {
        chargingProfiles: [...existing, profile],
      });
      return { status: "Accepted" };
    });

    // ── ClearChargingProfile ──
    this.client.handle("ClearChargingProfile", (ctx) => {
      const payload = ctx.params as {
        id?: number;
        connectorId?: number;
        chargingProfilePurpose?: string;
        stackLevel?: number;
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "ClearChargingProfile",
        payload,
        ocppMessageId: ctx.messageId,
      });
      let found = false;
      for (let i = 1; i <= slot.config.numberOfConnectors; i++) {
        if (
          payload.connectorId !== undefined &&
          payload.connectorId !== i &&
          payload.connectorId !== 0
        )
          continue;
        const profiles = slot.runtime.connectors[i]?.chargingProfiles ?? [];
        const filtered = profiles.filter((p) => {
          if (payload.id !== undefined && p.chargingProfileId === payload.id)
            return false;
          if (
            payload.chargingProfilePurpose &&
            p.chargingProfilePurpose === payload.chargingProfilePurpose
          )
            return false;
          if (
            payload.stackLevel !== undefined &&
            p.stackLevel === payload.stackLevel
          )
            return false;
          return true;
        });
        if (filtered.length !== profiles.length) {
          found = true;
          s.updateConnector(cid, i, { chargingProfiles: filtered });
        }
      }
      return { status: found ? "Accepted" : "Unknown" };
    });

    // ── GetCompositeSchedule ──
    this.client.handle("GetCompositeSchedule", (ctx) => {
      const payload = ctx.params as {
        connectorId: number;
        duration: number;
        chargingRateUnit?: "A" | "W";
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "GetCompositeSchedule",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const conn = slot.runtime.connectors[payload.connectorId];
      if (!conn || conn.chargingProfiles.length === 0)
        return { status: "Rejected" };
      const sorted = [...conn.chargingProfiles].sort(
        (a, b) => b.stackLevel - a.stackLevel,
      );
      const top = sorted[0];
      return {
        status: "Accepted",
        connectorId: payload.connectorId,
        scheduleStart: new Date().toISOString(),
        chargingSchedule: top.chargingSchedule,
      };
    });

    // ── SendLocalList ──
    this.client.handle("SendLocalList", (ctx) => {
      const payload = ctx.params as {
        listVersion: number;
        localAuthorizationList?: LocalAuthEntry[];
        updateType: "Differential" | "Full";
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "NotSupported" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "SendLocalList",
        payload,
        ocppMessageId: ctx.messageId,
      });
      if (
        payload.listVersion <= slot.runtime.localAuthListVersion &&
        payload.updateType === "Differential"
      ) {
        return { status: "VersionMismatch" };
      }
      const newEntries = payload.localAuthorizationList ?? [];
      if (payload.updateType === "Full") {
        s.setLocalAuthList(cid, newEntries, payload.listVersion);
      } else {
        const merged = [...slot.runtime.localAuthList];
        newEntries.forEach((entry) => {
          const idx = merged.findIndex((e) => e.idTag === entry.idTag);
          if (idx >= 0) merged[idx] = entry;
          else merged.push(entry);
        });
        s.setLocalAuthList(cid, merged, payload.listVersion);
      }
      return { status: "Accepted" };
    });

    // ── GetLocalListVersion ──
    this.client.handle("GetLocalListVersion", (ctx) => {
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "GetLocalListVersion",
        payload: {},
        ocppMessageId: ctx.messageId,
      });
      return { listVersion: slot.runtime.localAuthListVersion };
    });

    // ── DataTransfer (CSMS → CP) ──
    this.client.handle("DataTransfer", (ctx) => {
      const payload = ctx.params as {
        vendorId: string;
        messageId?: string;
        data?: string;
      };
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "DataTransfer",
        payload,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── ExtendedTriggerMessage ──
    this.client.handle("ExtendedTriggerMessage", (ctx) => {
      const payload = ctx.params as {
        requestedMessage: string;
        connectorId?: number;
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      const connId = payload.connectorId ?? 1;
      s.addLog(cid, {
        direction: "Rx",
        action: "ExtendedTriggerMessage",
        payload,
        ocppMessageId: ctx.messageId,
      });
      setTimeout(() => {
        const msg = payload.requestedMessage;
        if (msg === "BootNotification") this.sendBootNotification();
        else if (msg === "Heartbeat") this.sendHeartbeat();
        else if (msg === "StatusNotification") {
          const st =
            useEmulatorStore.getState().chargers.find((c) => c.id === cid)
              ?.runtime.connectors[connId]?.status ?? "Available";
          this.sendStatusNotification(connId, st);
        } else if (
          msg === "MeterValues" &&
          slot.runtime.connectors[connId]?.inTransaction
        )
          this.sendMeterValues(connId);
        else if (msg === "FirmwareStatusNotification")
          this.sendFirmwareStatus(slot.config.simulation.firmwareStatus);
        else if (msg === "LogStatusNotification")
          this.sendDiagnosticsStatus(
            slot.runtime.isUploading ? "Uploading" : "Idle",
          );
      }, 200);
      return { status: "Accepted" };
    });

    // ── GetLog ──
    this.client.handle("GetLog", (ctx) => {
      const s = useEmulatorStore.getState();
      const slot = s.chargers?.find((c) => c.id === cid);
      if (!slot) {
        return { status: "Rejected" };
      }
      s.addLog(cid, {
        direction: "Rx",
        action: "GetLog",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      this.startDiagnosticsUpload();
      return {
        status: "Accepted",
        filename: slot.config.simulation.diagnosticFileName,
      };
    });

    // ── SignedUpdateFirmware ──
    this.client.handle("SignedUpdateFirmware", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "SignedUpdateFirmware",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      this.sendFirmwareStatus("Downloading");
      setTimeout(() => this.sendFirmwareStatus("Downloaded"), 3000);
      setTimeout(() => this.sendFirmwareStatus("Installing"), 6000);
      setTimeout(() => this.sendFirmwareStatus("Installed"), 9000);
      return { status: "Accepted" };
    });

    // ── InstallCertificate ──
    this.client.handle("InstallCertificate", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "InstallCertificate",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── DeleteCertificate ──
    this.client.handle("DeleteCertificate", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "DeleteCertificate",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── GetInstalledCertificateIds ──
    this.client.handle("GetInstalledCertificateIds", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "GetInstalledCertificateIds",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted", certificateHashData: [] };
    });

    // ── CertificateSigned ──
    this.client.handle("CertificateSigned", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "CertificateSigned",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });
  }

  // ─── OCPP 2.x Incoming Handlers ───────────────────────────────────────────

  private registerHandlers201() {
    if (!this.client) return;
    const cid = this.chargerId;

    // ── Reset ──
    this.client.handle("Reset", (ctx) => {
      const payload = ctx.params as { type: string };
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "Reset",
        payload,
        ocppMessageId: ctx.messageId,
      });
      if (payload.type === "Immediate") {
        setTimeout(() => {
          this.disconnect();
          setTimeout(() => this.connect(), 1500);
        }, 300);
      }
      return { status: "Accepted" };
    });

    // ── ChangeAvailability ──
    this.client.handle("ChangeAvailability", (ctx) => {
      const payload = ctx.params as {
        evseId?: number;
        operationalStatus: string;
      };
      const s = useEmulatorStore.getState();
      s.addLog(cid, {
        direction: "Rx",
        action: "ChangeAvailability",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const evseId = payload.evseId ?? 0;
      const status =
        payload.operationalStatus === "Operative" ? "Available" : "Unavailable";
      if (evseId === 0) {
        // all EVSEs
        const slot = s.chargers.find((c) => c.id === cid);
        slot?.runtime.evse.forEach((e) =>
          s.updateEVSE(cid, e.evseId, { status }),
        );
      } else {
        s.updateEVSE(cid, evseId, {
          status: status as "Available" | "Unavailable",
        });
      }
      return { status: "Accepted" };
    });

    // ── GetVariables ──
    this.client.handle("GetVariables", (ctx) => {
      const payload = ctx.params as {
        getVariableData: {
          component: { name: string };
          variable: { name: string };
          attributeType?: string;
        }[];
      };
      const s = useEmulatorStore.getState();
      s.addLog(cid, {
        direction: "Rx",
        action: "GetVariables",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const slot = s.chargers.find((c) => c.id === cid);
      const model = slot?.runtime.deviceModel ?? [];
      const result = payload.getVariableData.map((req) => {
        const found = model.find(
          (v) =>
            v.component === req.component.name &&
            v.variable === req.variable.name,
        );
        return {
          component: req.component,
          variable: req.variable,
          attributeType: (req.attributeType ?? "Actual") as
            | "Actual"
            | "Target"
            | "MinSet"
            | "MaxSet",
          attributeStatus: (found ? "Accepted" : "UnknownVariable") as
            | "Accepted"
            | "Rejected"
            | "UnknownComponent"
            | "UnknownVariable"
            | "NotSupportedAttributeType",
          attributeValue: found?.value,
        };
      });
      return { getVariableResult: result };
    });

    // ── SetVariables ──
    this.client.handle("SetVariables", (ctx) => {
      const payload = ctx.params as {
        setVariableData: {
          component: { name: string };
          variable: { name: string };
          attributeValue: string;
        }[];
      };
      const s = useEmulatorStore.getState();
      s.addLog(cid, {
        direction: "Rx",
        action: "SetVariables",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const slot = s.chargers.find((c) => c.id === cid);
      const model = slot?.runtime.deviceModel ?? [];
      const result = payload.setVariableData.map((req) => {
        const found = model.find(
          (v) =>
            v.component === req.component.name &&
            v.variable === req.variable.name,
        );
        if (found?.mutability === "ReadOnly") {
          return {
            component: req.component,
            variable: req.variable,
            attributeStatus: "Rejected" as
              | "Accepted"
              | "Rejected"
              | "UnknownComponent"
              | "UnknownVariable"
              | "NotSupportedAttributeType",
          };
        }
        s.setDeviceVariable(
          cid,
          req.component.name,
          req.variable.name,
          req.attributeValue,
        );

        // Reactivity Engine: Apply changes immediately
        if (
          req.variable.name === "HeartbeatInterval" ||
          (req.component.name === "OCPPCommCtrlr" &&
            req.variable.name === "HeartbeatInterval") ||
          (req.component.name === "HeartbeatInterval" &&
            req.variable.name === "Interval")
        ) {
          const interval = Number(req.attributeValue);
          if (!Number.isNaN(interval) && interval > 0) {
            this.startHeartbeatTimer(interval);
          }
        }

        return {
          component: req.component,
          variable: req.variable,
          attributeStatus: "Accepted" as
            | "Accepted"
            | "Rejected"
            | "UnknownComponent"
            | "UnknownVariable"
            | "NotSupportedAttributeType",
        };
      });
      return { setVariableResult: result };
    });

    // ── TriggerMessage (2.x) ──
    this.client.handle("TriggerMessage", (ctx) => {
      const payload = ctx.params as {
        requestedMessage: string;
        evse?: { id: number };
      };
      const s = useEmulatorStore.getState();
      s.addLog(cid, {
        direction: "Rx",
        action: "TriggerMessage",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const evseId = payload.evse?.id ?? 1;
      setTimeout(() => {
        const msg = payload.requestedMessage;
        if (msg === "Heartbeat") this.sendHeartbeat();
        else if (msg === "BootNotification") this.sendBootNotification201();
        else if (msg === "StatusNotification") {
          const ev = useEmulatorStore
            .getState()
            .chargers.find((c) => c.id === cid)
            ?.runtime.evse.find((e) => e.evseId === evseId);
          this.sendStatusNotification201(evseId, 1, ev?.status ?? "Available");
        } else if (msg === "MeterValues") this.sendMeterValues(evseId);
      }, 300);
      return { status: "Accepted" };
    });

    // ── RemoteStartTransaction (2.x → use TransactionEvent) ──
    this.client.handle("RemoteStartTransaction", (ctx) => {
      const payload = ctx.params as unknown as {
        evseId?: number;
        idToken: { idToken: string; type: string };
      };
      const s = useEmulatorStore.getState();
      const slot = s.chargers.find((c) => c.id === cid);
      const evseId = payload.evseId ?? 1;
      s.addLog(cid, {
        direction: "Rx",
        action: "RemoteStartTransaction",
        payload,
        ocppMessageId: ctx.messageId,
      });
      if (slot?.runtime.connectors[evseId]?.inTransaction)
        return { status: "Rejected" };
      setTimeout(
        () => this.startTransaction201(evseId, payload.idToken.idToken),
        500,
      );
      return { status: "Accepted" };
    });

    // ── RemoteStopTransaction (2.x) ──
    this.client.handle("RemoteStopTransaction", (ctx) => {
      const payload = ctx.params as unknown as { transactionId: string };
      const s = useEmulatorStore.getState();
      const slot = s.chargers.find((c) => c.id === cid);
      s.addLog(cid, {
        direction: "Rx",
        action: "RemoteStopTransaction",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const n = slot?.config.numberOfConnectors ?? 1;
      let evseId: number | null = null;
      for (let i = 1; i <= n; i++) {
        if (
          String(slot?.runtime.connectors[i]?.transactionId) ===
          payload.transactionId
        ) {
          evseId = i;
          break;
        }
      }
      if (!evseId) return { status: "Rejected" };
      setTimeout(
        () => this.stopTransaction201(evseId as number, "Remote"),
        500,
      );
      return { status: "Accepted" };
    });

    // ── ClearCache ──
    this.client.handle("ClearCache", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "ClearCache",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── SetChargingProfile ──
    this.client.handle("SetChargingProfile", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "SetChargingProfile",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── ClearChargingProfile ──
    this.client.handle("ClearChargingProfile", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "ClearChargingProfile",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── GetChargingProfiles ──
    this.client.handle("GetChargingProfiles", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "GetChargingProfiles",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "NoProfiles" };
    });

    // ── ReserveNow (2.x evseId-based) ──
    this.client.handle("ReserveNow", (ctx) => {
      const payload = ctx.params as {
        id: number;
        evseId?: number;
        idToken: { idToken: string; type: string };
        expiryDateTime: string;
      };
      const s = useEmulatorStore.getState();
      s.addLog(cid, {
        direction: "Rx",
        action: "ReserveNow",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const evseId = payload.evseId ?? 1;
      s.updateEVSE(cid, evseId, { status: "Reserved" });
      return { status: "Accepted" };
    });

    // ── CancelReservation ──
    this.client.handle("CancelReservation", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "CancelReservation",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── SendLocalList ──
    this.client.handle("SendLocalList", (ctx) => {
      const payload = ctx.params as {
        versionNumber: number;
        localAuthorizationList?: {
          idToken: { idToken: string };
          idTokenInfo?: { status: string };
        }[];
        updateType: string;
      };
      const s = useEmulatorStore.getState();
      s.addLog(cid, {
        direction: "Rx",
        action: "SendLocalList",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const list =
        payload.localAuthorizationList?.map((e) => ({
          idTag: e.idToken.idToken,
          idTagInfo: e.idTokenInfo
            ? { status: (e.idTokenInfo.status ?? "Accepted") as "Accepted" }
            : undefined,
        })) ?? [];
      s.setLocalAuthList(cid, list, payload.versionNumber);
      return { status: "Accepted" };
    });

    // ── GetLocalListVersion ──
    this.client.handle("GetLocalListVersion", (ctx) => {
      const s = useEmulatorStore.getState();
      const slot = s.chargers.find((c) => c.id === cid);
      s.addLog(cid, {
        direction: "Rx",
        action: "GetLocalListVersion",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { versionNumber: slot?.runtime.localAuthListVersion ?? 0 };
    });

    // ── UnlockConnector ──
    this.client.handle("UnlockConnector", (ctx) => {
      const payload = ctx.params as { evseId: number; connectorId: number };
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "UnlockConnector",
        payload,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Unlocked" };
    });

    // ── DataTransfer ──
    this.client.handle("DataTransfer", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "DataTransfer",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── GetLog ──
    this.client.handle("GetLog", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "GetLog",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted", filename: "emulator-log.txt" };
    });

    // ── InstallCertificate (simulated) ──
    this.client.handle("InstallCertificate", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "InstallCertificate",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── DeleteCertificate (simulated) ──
    this.client.handle("DeleteCertificate", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "DeleteCertificate",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── GetInstalledCertificateIds (simulated) ──
    this.client.handle("GetInstalledCertificateIds", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "GetInstalledCertificateIds",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted", certificateHashDataChain: [] };
    });

    // ── CertificateSigned (simulated) ──
    this.client.handle("CertificateSigned", (ctx) => {
      useEmulatorStore.getState().addLog(cid, {
        direction: "Rx",
        action: "CertificateSigned",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });
  }

  // ─── OCPP 2.x Outgoing Methods ────────────────────────────────────────────

  async sendBootNotification201() {
    if (!this.client) return;
    const { slot, store } = getSlotState(this.chargerId);
    const boot = slot.config.bootNotification;
    const payload = {
      reason: "PowerUp",
      chargingStation: {
        model: boot.chargePointModel,
        vendorName: boot.chargePointVendor,
        serialNumber: boot.chargePointSerialNumber || undefined,
        firmwareVersion: boot.firmwareVersion || undefined,
        modem:
          boot.iccid || boot.imsi
            ? { iccid: boot.iccid || undefined, imsi: boot.imsi || undefined }
            : undefined,
      },
    };

    try {
      if (slot.config.vendorConfig?.customDataStr) {
        const parsed = JSON.parse(slot.config.vendorConfig.customDataStr);
        if (Object.keys(parsed).length > 0) {
          (payload as any).customData = {
            vendorId: slot.config.vendorConfig.vendorId,
            ...parsed,
          };
        }
      }
    } catch (_) {}
    const msgId = nanoid(8);
    store.addLog(this.chargerId, {
      direction: "Tx",
      action: "BootNotification",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = (await this.client.call("BootNotification", payload)) as {
        status: string;
        currentTime: string;
        interval?: number;
      };
      store.addLog(this.chargerId, {
        direction: "Rx",
        action: "BootNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
      if (res.status === "Accepted") {
        const interval = res.interval ?? 300;
        store.setDeviceVariable(
          this.chargerId,
          "HeartbeatInterval",
          "Interval",
          String(interval),
        );
        this.startHeartbeatTimer(interval);
        // Send StatusNotification for each EVSE
        const evse =
          useEmulatorStore
            .getState()
            .chargers.find((c) => c.id === this.chargerId)?.runtime.evse ?? [];
        for (const e of evse) {
          for (const conn of e.connectors) {
            this.sendStatusNotification201(
              e.evseId,
              conn.connectorId,
              e.status,
            );
          }
        }
      }
    } catch (err) {
      store.addLog(this.chargerId, {
        direction: "Error",
        action: "BootNotification",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async sendTransactionEvent(
    trigger: "Started" | "Updated" | "Ended",
    evseId: number,
    reason?: string,
    meterValue?: number,
  ) {
    if (!this.client) return;
    const { slot, store } = getSlotState(this.chargerId);
    const connector = slot.runtime.connectors[evseId];
    const seq = store.bumpTransactionSeq(this.chargerId);
    const ts = new Date().toISOString();
    const payload: Record<string, unknown> = {
      eventType: trigger,
      seqNo: seq,
      timestamp: ts,
      triggerReason:
        reason ??
        (trigger === "Started"
          ? "Authorized"
          : trigger === "Ended"
          ? "Local"
          : "ChargingRateChanged"),
      transactionInfo: {
        transactionId: String(connector?.transactionId ?? `TXN-${nanoid(6)}`),
        chargingState:
          trigger === "Ended"
            ? "SuspendedEVSE"
            : trigger === "Started"
            ? "Charging"
            : "Charging",
      },
      evse: { id: evseId, connectorId: 1 },
      idToken: connector?.idTag
        ? { idToken: connector.idTag, type: "ISO14443" }
        : undefined,
    };
    if (meterValue !== undefined) {
      payload.meterValue = [
        {
          timestamp: ts,
          sampledValue: [
            {
              value: meterValue,
              measurand: "Energy.Active.Import.Register",
              unitOfMeasure: { unit: "Wh" },
            },
          ],
        },
      ];
    }
    const msgId = nanoid(8);
    store.addLog(this.chargerId, {
      direction: "Tx",
      action: "TransactionEvent",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("TransactionEvent", payload);
      store.addLog(this.chargerId, {
        direction: "Rx",
        action: "TransactionEventConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (err) {
      store.addLog(this.chargerId, {
        direction: "Error",
        action: "TransactionEvent",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async sendStatusNotification201(
    evseId: number,
    connectorId: number,
    status: string,
  ) {
    if (!this.client) return;
    const { store } = getSlotState(this.chargerId);
    const payload = {
      timestamp: new Date().toISOString(),
      connectorStatus: status,
      evseId,
      connectorId,
    };

    const { vendorConfig } = store.getSlot(this.chargerId)?.config ?? {};
    if (vendorConfig?.vendorErrorCode) {
      (payload as any).vendorErrorCode = vendorConfig.vendorErrorCode;
    }
    const msgId = nanoid(8);
    store.addLog(this.chargerId, {
      direction: "Tx",
      action: "StatusNotification",
      payload,
      ocppMessageId: msgId,
    });
    try {
      await this.client.call("StatusNotification", payload);
    } catch (err) {
      store.addLog(this.chargerId, {
        direction: "Error",
        action: "StatusNotification",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async sendAuthorize201(idToken: string, type = "ISO14443") {
    if (!this.client) return;
    const { store } = getSlotState(this.chargerId);
    const payload = { idToken: { idToken, type } };
    const msgId = nanoid(8);
    store.addLog(this.chargerId, {
      direction: "Tx",
      action: "Authorize",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("Authorize", payload);
      store.addLog(this.chargerId, {
        direction: "Rx",
        action: "AuthorizeConf",
        payload: res,
        ocppMessageId: msgId,
      });
      return res;
    } catch (err) {
      store.addLog(this.chargerId, {
        direction: "Error",
        action: "Authorize",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async startTransaction201(evseId: number, idTag: string) {
    if (!this.client) return;
    const { store } = getSlotState(this.chargerId);
    const txId = Date.now();
    store.updateConnector(this.chargerId, evseId, {
      inTransaction: true,
      transactionId: txId,
      idTag,
      startMeterValue:
        store.getSlot(this.chargerId)?.runtime.connectors[evseId]
          ?.currentMeterValue ?? 0,
    });
    store.updateEVSE(this.chargerId, evseId, { status: "Occupied" });
    this.sendStatusNotification201(evseId, 1, "Occupied");
    await this.sendTransactionEvent("Started", evseId, "Authorized");
    // Start meter timer
    const cfgSlot = useEmulatorStore
      .getState()
      .chargers.find((c) => c.id === this.chargerId);
    const meterInterval = parseInt(
      cfgSlot?.config.stationConfig.find(
        (k) => k.key === "MeterValueSampleInterval",
      )?.value ?? "60",
      10,
    );
    this.meterTimers[evseId] = setInterval(() => {
      const s = useEmulatorStore.getState();
      const cur = s.chargers.find((c) => c.id === this.chargerId)?.runtime
        .connectors[evseId];
      if (cur) {
        s.updateConnector(this.chargerId, evseId, {
          currentMeterValue:
            cur.currentMeterValue +
            (cfgSlot?.config.simulation.autoChargeMeterIncrement ?? 250) /
              (meterInterval / 10),
        });
      }
      this.sendMeterValues(evseId);
    }, meterInterval * 1000);
  }

  async stopTransaction201(evseId: number, reason = "Local") {
    if (!this.client) return;
    const { store } = getSlotState(this.chargerId);
    const snap = store.getSlot(this.chargerId)?.runtime.connectors[evseId];
    await this.sendTransactionEvent(
      "Ended",
      evseId,
      reason,
      snap?.currentMeterValue,
    );
    // Stop meter timer
    if (this.meterTimers[evseId]) {
      clearInterval(this.meterTimers[evseId]);
      delete this.meterTimers[evseId];
    }
    store.updateConnector(this.chargerId, evseId, {
      inTransaction: false,
      transactionId: null,
    });
    store.updateEVSE(this.chargerId, evseId, { status: "Available" });
    this.sendStatusNotification201(evseId, 1, "Available");
  }

  // ─── Outgoing Commands ─────────────────────────────────────────────────────

  async sendBootNotification() {
    if (!this.client) return;
    const { slot, store } = getSlotState(this.chargerId);
    const payload = { ...slot.config.bootNotification };
    const msgId = nanoid(8);
    store.addLog(this.chargerId, {
      direction: "Tx",
      action: "BootNotification",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = (await this.client.call("BootNotification", payload)) as {
        status: string;
        interval?: number;
      };
      store.addLog(this.chargerId, {
        direction: "Rx",
        action: "BootNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
      if (res.status === "Accepted") {
        const interval = res.interval ?? 300;
        store.updateStationConfigKey(
          this.chargerId,
          "HeartbeatInterval",
          String(interval),
        );
        this.startHeartbeatTimer(interval);
        const n =
          useEmulatorStore
            .getState()
            .chargers.find((c) => c.id === this.chargerId)?.config
            .numberOfConnectors ?? 1;
        for (let i = 1; i <= n; i++)
          this.sendStatusNotification(i, "Available");
      }
    } catch (err) {
      store.addLog(this.chargerId, {
        direction: "Error",
        action: "BootNotification",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  private startHeartbeatTimer(intervalSeconds: number) {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat(),
      intervalSeconds * 1000,
    );
  }

  async sendHeartbeat() {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "Heartbeat",
      payload: {},
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("Heartbeat", {});
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "HeartbeatConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "Heartbeat",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async sendStatusNotification(
    connectorId: number,
    status: string,
    errorCode: string = "NoError",
  ) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const vendorError = s.getSlot(this.chargerId)?.config.vendorConfig
      ?.vendorErrorCode;

    const payload = {
      connectorId,
      errorCode: vendorError || errorCode,
      status,
      timestamp: new Date().toISOString(),
    };
    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "StatusNotification",
      payload,
      ocppMessageId: msgId,
    });
    s.updateConnector(this.chargerId, connectorId, { status: status as any });
    try {
      const res = await this.client.call("StatusNotification", payload);
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "StatusNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "StatusNotification",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async authorize(_connectorId: number, idTag: string): Promise<boolean> {
    if (!this.client) return false;
    const s = useEmulatorStore.getState();
    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "Authorize",
      payload: { idTag },
      ocppMessageId: msgId,
    });
    try {
      const res = (await this.client.call("Authorize", { idTag })) as {
        idTagInfo: { status: string };
      };
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "AuthorizeConf",
        payload: res,
        ocppMessageId: msgId,
      });
      return res?.idTagInfo?.status === "Accepted";
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "Authorize",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
      return false;
    }
  }

  async startTransaction(connectorId: number, idTag?: string) {
    if (!this.client) return;
    const { slot, store } = getSlotState(this.chargerId);
    const connector = slot.runtime.connectors[connectorId];
    if (!connector) return;
    const tag = idTag ?? connector.idTag;
    const authorized = await this.authorize(connectorId, tag);
    if (!authorized) {
      store.addLog(this.chargerId, {
        direction: "System",
        action: "AuthFailed",
        payload: { message: "Authorization rejected" },
        ocppMessageId: nanoid(8),
      });
      return;
    }
    await this.sendStatusNotification(connectorId, "Preparing");
    const freshSlot = useEmulatorStore
      .getState()
      ?.chargers.find((c) => c.id === this.chargerId);
    if (!freshSlot) return;
    const payload = {
      connectorId,
      idTag: tag,
      meterStart: freshSlot.runtime.connectors[connectorId].startMeterValue,
      timestamp: new Date().toISOString(),
    };
    const txMsgId = nanoid(8);
    store.addLog(this.chargerId, {
      direction: "Tx",
      action: "StartTransaction",
      payload,
      ocppMessageId: txMsgId,
    });
    try {
      const res = (await this.client.call("StartTransaction", payload)) as {
        idTagInfo: { status: string };
        transactionId: number;
      };
      store.addLog(this.chargerId, {
        direction: "Rx",
        action: "StartTransactionConf",
        payload: res,
        ocppMessageId: txMsgId,
      });
      if (res?.idTagInfo?.status === "Accepted") {
        store.updateConnector(this.chargerId, connectorId, {
          inTransaction: true,
          transactionId: res.transactionId,
          idTag: tag,
        });
        await this.sendStatusNotification(connectorId, "Charging");
        const cfgSlot = useEmulatorStore
          .getState()
          ?.chargers.find((c) => c.id === this.chargerId);
        if (!cfgSlot) return;
        const meterInterval = parseInt(
          cfgSlot.config.stationConfig.find(
            (k: StationConfigKey) => k.key === "MeterValueSampleInterval",
          )?.value ?? "60",
          10,
        );
        this.meterTimers[connectorId] = setInterval(() => {
          const s = useEmulatorStore.getState();
          const current = s.chargers.find((c) => c.id === this.chargerId)
            ?.runtime.connectors[connectorId];
          if (current) {
            s.updateConnector(this.chargerId, connectorId, {
              currentMeterValue:
                current.currentMeterValue +
                cfgSlot.config.simulation.autoChargeMeterIncrement /
                  (meterInterval / 10),
            });
          }
          this.sendMeterValues(connectorId);
        }, meterInterval * 1000);
      } else {
        await this.sendStatusNotification(connectorId, "Available");
      }
    } catch (err) {
      store.addLog(this.chargerId, {
        direction: "Error",
        action: "StartTransaction",
        payload: { message: String(err) },
        ocppMessageId: txMsgId,
      });
    }
  }

  async sendMeterValues(connectorId: number) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const slot = s.chargers?.find((c) => c.id === this.chargerId);
    if (!slot) return;
    const connector = slot.runtime.connectors[connectorId];
    if (!connector?.inTransaction) return;

    const m = slot.config.simulation.measurands;
    const meterWh = connector.currentMeterValue;
    const targetWh = slot.config.simulation.autoChargeTargetKWh * 1000;
    const socPct = Math.min(100, Math.round((meterWh / targetWh) * 100));
    const powerW = 3000 + Math.floor(Math.random() * 2000);
    const voltV = 228 + Math.round(Math.random() * 4);
    const ampA = +(powerW / voltV).toFixed(1);
    const phases = m.threePhase ? ["L1", "L2", "L3"] : ["L1"];

    const sampledValues: Record<string, unknown>[] = [];

    if (m.energy)
      sampledValues.push({
        measurand: "Energy.Active.Import.Register",
        value: String(meterWh),
        unit: "Wh",
      });

    if (m.power)
      sampledValues.push({
        measurand: "Power.Active.Import",
        value: String(powerW),
        unit: "W",
      });

    if (m.voltage)
      phases.forEach((phase) =>
        sampledValues.push({
          measurand: "Voltage",
          phase,
          value: String(voltV),
          unit: "V",
        }),
      );

    if (m.current)
      phases.forEach((phase) =>
        sampledValues.push({
          measurand: "Current.Import",
          phase,
          value: String(ampA),
          unit: "A",
        }),
      );

    if (m.soc)
      sampledValues.push({
        measurand: "SoC",
        value: String(socPct),
        unit: "Percent",
        location: "EV",
      });

    if (m.temperature)
      sampledValues.push({
        measurand: "Temperature",
        value: String(25 + Math.floor(Math.random() * 10)),
        unit: "Celsius",
        location: "Body",
      });

    if (m.frequency)
      sampledValues.push({
        measurand: "Frequency",
        value: String((50 + (Math.random() - 0.5) * 0.2).toFixed(2)),
        unit: "Hz",
      });

    const payload = {
      connectorId,
      transactionId: connector.transactionId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: sampledValues,
        },
      ],
    };

    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "MeterValues",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("MeterValues", payload);
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "MeterValuesConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "MeterValues",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async stopTransaction(connectorId: number) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const slot = s.chargers?.find((c) => c.id === this.chargerId);
    if (!slot) return;
    const connector = slot.runtime.connectors[connectorId];
    if (!connector?.inTransaction) return;
    if (this.meterTimers[connectorId]) {
      clearInterval(this.meterTimers[connectorId]);
      delete this.meterTimers[connectorId];
    }
    await this.sendStatusNotification(connectorId, "Finishing");
    const payload = {
      transactionId: connector.transactionId,
      idTag: connector.idTag,
      meterStop: connector.currentMeterValue,
      timestamp: new Date().toISOString(),
      reason: connector.stopReason,
    };
    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "StopTransaction",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("StopTransaction", payload);
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "StopTransactionConf",
        payload: res,
        ocppMessageId: msgId,
      });
      useEmulatorStore.getState().updateConnector(this.chargerId, connectorId, {
        inTransaction: false,
        transactionId: null,
        startMeterValue: connector.currentMeterValue,
      });
      await this.sendStatusNotification(connectorId, "Available");
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "StopTransaction",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async sendDiagnosticsStatus(status: string) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const payload = { status };
    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "DiagnosticsStatusNotification",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call(
        "DiagnosticsStatusNotification",
        payload,
      );
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "DiagnosticsStatusNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (_) {}
  }

  async sendFirmwareStatus(status: string) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const payload = { status };
    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "FirmwareStatusNotification",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("FirmwareStatusNotification", payload);
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "FirmwareStatusNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (_) {}
  }

  startDiagnosticsUpload() {
    const s = useEmulatorStore.getState();
    const slot = s.chargers?.find((c) => c.id === this.chargerId);
    if (!slot) return;
    if (this.uploadTimer) clearInterval(this.uploadTimer);
    let secs = slot.config.simulation.diagnosticUploadTime;
    s.setIsUploading(this.chargerId, true);
    s.setUploadSecondsLeft(this.chargerId, secs);
    this.sendDiagnosticsStatus("Uploading");
    this.uploadTimer = setInterval(() => {
      secs -= 1;
      useEmulatorStore.getState().setUploadSecondsLeft(this.chargerId, secs);
      if (secs <= 0) {
        if (this.uploadTimer) clearInterval(this.uploadTimer);
        this.uploadTimer = null;
        useEmulatorStore.getState().setIsUploading(this.chargerId, false);
        const diagStatus = useEmulatorStore
          .getState()
          .chargers.find((c) => c.id === this.chargerId)?.config
          .simulation.diagnosticStatus;
        this.sendDiagnosticsStatus(diagStatus ?? "Uploaded");
      }
    }, 1000);
  }

  // ─── DataTransfer (CP → CSMS) ─────────────────────────────────────────────
  async sendDataTransfer(vendorId?: string, messageId?: string, data?: string) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const config = s.getSlot(this.chargerId)?.config.vendorConfig;

    const payload: { vendorId: string; messageId?: string; data?: string } = {
      vendorId: vendorId || config?.vendorId || "UnknownVendor",
    };
    if (messageId) payload.messageId = messageId;

    // Use explicitly passed data, OR fallback to vendorConfig custom data
    if (data) {
      payload.data = data;
    } else if (config?.customDataStr) {
      try {
        JSON.parse(config.customDataStr);
        payload.data = config.customDataStr;
      } catch (_) {
        payload.data = config.customDataStr;
      }
    }

    const msgId = nanoid(8);
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "DataTransfer",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("DataTransfer", payload);
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "DataTransferConf",
        payload: res,
      });
      return res;
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "DataTransfer",
        payload: { message: String(err) },
      });
    }
  }

  // ─── SecurityEventNotification (CP → CSMS) ────────────────────────────────
  async sendSecurityEventNotification(type: string, info?: string) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const payload = {
      type,
      timestamp: new Date().toISOString(),
      techInfo: info ?? "",
    };
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "SecurityEventNotification",
      payload,
    });
    try {
      const res = await this.client.call(
        "SecurityEventNotification" as any,
        payload as any,
      );
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "SecurityEventNotificationConf",
        payload: res,
      });
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "SecurityEventNotification",
        payload: { message: String(err) },
      });
    }
  }

  // ─── LogStatusNotification (CP → CSMS) ────────────────────────────────────
  async sendLogStatusNotification(status: string, requestId?: number) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    const payload: Record<string, unknown> = { status };
    if (requestId !== undefined) payload.requestId = requestId;
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "LogStatusNotification",
      payload,
    });
    try {
      const res = await this.client.call(
        "LogStatusNotification" as any,
        payload as any,
      );
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: "LogStatusNotificationConf",
        payload: res,
      });
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "LogStatusNotification",
        payload: { message: String(err) },
      });
    }
  }

  // ─── Auto Charge State Machine ─────────────────────────────────────────────
  async startAutoCharge(connectorId: number) {
    if (!this.client) return;
    const { slot, store } = getSlotState(this.chargerId);
    const conn = slot.runtime.connectors[connectorId];
    if (!conn || conn.inTransaction) return;

    store.addLog(this.chargerId, {
      direction: "System",
      action: "AutoCharge",
      payload: { connectorId, message: "Starting auto-charge sequence" },
    });

    await this.startTransaction(connectorId, conn.idTag);

    const freshSlot = useEmulatorStore
      .getState()
      .chargers.find((c) => c.id === this.chargerId);
    const updatedConn = freshSlot?.runtime.connectors[connectorId];
    if (!updatedConn?.inTransaction) {
      store.addLog(this.chargerId, {
        direction: "System",
        action: "AutoCharge",
        payload: {
          connectorId,
          message: "Auto-charge failed: transaction not started",
        },
      });
      return;
    }

    const {
      autoChargeDurationSec,
      autoChargeTargetKWh,
      autoChargeMeterIncrement,
    } = slot.config.simulation;
    const meterInterval = parseInt(
      slot.config.stationConfig.find(
        (k) => k.key === "MeterValueSampleInterval",
      )?.value ?? "60",
      10,
    );

    let elapsed = 0;
    const tickSec = Math.min(meterInterval, 10);
    this.autoChargeTimers[connectorId] = setInterval(() => {
      elapsed += tickSec;
      const s = useEmulatorStore.getState();
      const current = s.chargers.find((c) => c.id === this.chargerId)?.runtime
        .connectors[connectorId];
      if (!current?.inTransaction) {
        if (this.autoChargeTimers[connectorId]) {
          clearInterval(this.autoChargeTimers[connectorId]);
          delete this.autoChargeTimers[connectorId];
        }
        return;
      }
      const newMeter = current.currentMeterValue + autoChargeMeterIncrement;
      s.updateConnector(this.chargerId, connectorId, {
        currentMeterValue: newMeter,
      });
      const targetWh = autoChargeTargetKWh * 1000;
      if (newMeter >= targetWh || elapsed >= autoChargeDurationSec) {
        if (this.autoChargeTimers[connectorId]) {
          clearInterval(this.autoChargeTimers[connectorId]);
          delete this.autoChargeTimers[connectorId];
        }
        this.sendMeterValues(connectorId);
        setTimeout(() => {
          useEmulatorStore
            .getState()
            .updateConnector(this.chargerId, connectorId, {
              stopReason: "Local" as any,
            });
          this.stopTransaction(connectorId);
          useEmulatorStore.getState().addLog(this.chargerId, {
            direction: "System",
            action: "AutoCharge",
            payload: {
              connectorId,
              message: `Auto-charge complete: ${(newMeter / 1000).toFixed(
                1,
              )} kWh in ${elapsed}s`,
            },
          });
        }, 1000);
      }
    }, tickSec * 1000);
  }

  stopAutoCharge(connectorId: number) {
    if (this.autoChargeTimers[connectorId]) {
      clearInterval(this.autoChargeTimers[connectorId]);
      delete this.autoChargeTimers[connectorId];
    }
    const slot = useEmulatorStore
      .getState()
      .chargers.find((c) => c.id === this.chargerId);
    if (slot?.runtime.connectors[connectorId]?.inTransaction) {
      this.stopTransaction(connectorId);
    }
  }

  // ─── Raw OCPP Call (Message Composer) ──────────────────────────────────────
  async sendRawCall(action: string, payload: Record<string, unknown>) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    s.addLog(this.chargerId, { direction: "Tx", action, payload });
    try {
      const res = await this.client.call(action as any, payload as any);
      s.addLog(this.chargerId, {
        direction: "Rx",
        action: `${action}Conf`,
        payload: res,
      });
      return res;
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action,
        payload: { message: String(err) },
      });
    }
  }

  // ─── Raw String Injection (Chaos Monkey) ─────────────────────────────────
  sendRawString(raw: string) {
    if (!this.client) return;
    const s = useEmulatorStore.getState();
    s.addLog(this.chargerId, {
      direction: "Tx",
      action: "RawInjection",
      payload: { raw },
    });
    try {
      // Access the underlying WebSocket and send the raw string directly
      (this.client as any).ws?.send?.(raw);
    } catch (err) {
      s.addLog(this.chargerId, {
        direction: "Error",
        action: "RawInjection",
        payload: { message: String(err) },
      });
    }
  }

  // ─── Hardware Fault Injection ────────────────────────────────────────────
  async triggerFault(connectorId: number, errorCode: string) {
    const s = useEmulatorStore.getState();
    const slot = s.chargers.find((c) => c.id === this.chargerId);
    const connector = slot?.runtime.connectors[connectorId];

    // If there's an active transaction, stop it with reason "Other"
    if (connector?.inTransaction) {
      s.updateConnector(this.chargerId, connectorId, { stopReason: "Other" });
      await this.stopTransaction(connectorId);
    }

    // Set connector to Faulted
    s.updateConnector(this.chargerId, connectorId, { status: "Faulted" });

    // Send StatusNotification with the error code
    const { config } = getSlotState(this.chargerId);
    if (config.ocppVersion === "ocpp1.6") {
      await this.sendStatusNotification(connectorId, "Faulted", errorCode);
    } else {
      // OCPP 2.x
      if (this.client) {
        const payload = {
          timestamp: new Date().toISOString(),
          connectorStatus: "Faulted",
          evseId: connectorId,
          connectorId: 1,
        };
        s.addLog(this.chargerId, {
          direction: "Tx",
          action: "StatusNotification",
          payload: { ...payload, errorCode },
        });
        try {
          const res = await this.client.call(
            "StatusNotification" as any,
            payload as any,
          );
          s.addLog(this.chargerId, {
            direction: "Rx",
            action: "StatusNotificationConf",
            payload: res,
          });
        } catch (err) {
          s.addLog(this.chargerId, {
            direction: "Error",
            action: "StatusNotification",
            payload: { message: String(err) },
          });
        }
      }
    }
  }
}

// ─── Service Map (one OCPPService per charger slot) ───────────────────────────

const serviceMap = new Map<string, OCPPService>();

export function getService(chargerId: string): OCPPService {
  if (!serviceMap.has(chargerId)) {
    serviceMap.set(chargerId, new OCPPService(chargerId));
  }
  // biome-ignore lint/style/noNonNullAssertion: this is a map of chargerId to OCPPService
  return serviceMap.get(chargerId)!;
}

export function removeService(chargerId: string) {
  serviceMap.get(chargerId)?.disconnect();
  serviceMap.delete(chargerId);
}

/**
 * @deprecated Use getService(chargerId) instead.
 * Legacy export for components that haven't been updated yet.
 */
export function getActiveService(): OCPPService {
  const id = useEmulatorStore.getState().activeChargerId;
  return getService(id);
}

// Legacy singleton alias — HeaderBar and ConnectorPanel do
// import { ocppService } from "@/lib/ocppClient", so we export a proxy
// object that always delegates to the currently active charger's service.
export const ocppService = new Proxy({} as OCPPService, {
  get(_target, prop) {
    const id = useEmulatorStore.getState().activeChargerId;
    const svc = getService(id);
    const val = (svc as any)[prop];
    return typeof val === "function" ? val.bind(svc) : val;
  },
});
