import { nanoid } from "nanoid";
import { BrowserOCPPClient } from "ocpp-ws-io/browser";
import {
  type ChargingProfile,
  type LocalAuthEntry,
  type StationConfigKey,
  useEmulatorStore,
} from "../store/emulatorStore";

type Timer = ReturnType<typeof setInterval>;

class OCPPService {
  private client: BrowserOCPPClient | null = null;
  private heartbeatTimer: Timer | null = null;
  private meterTimers: Record<number, Timer> = {};
  private uploadTimer: Timer | null = null;
  private reservationTimers: Record<number, Timer> = {};
  private autoChargeTimers: Record<number, Timer> = {};

  // ─── Connection ──────────────────────────────────────────────────────────

  async connect() {
    const { config, setStatus, addLog } = useEmulatorStore.getState();
    if (this.client) await this.disconnect();

    setStatus("connecting");

    try {
      this.client = new BrowserOCPPClient({
        endpoint: config.endpoint,
        identity: config.chargePointId,
        protocols: [config.ocppVersion],
        reconnect: true,
        maxReconnects: 5,
        logging: false,
        ...(config.securityProfile > 0 && config.basicAuthPassword
          ? { password: config.basicAuthPassword }
          : {}),
      });

      // ── Events (library uses 'open', 'close', 'error', 'connecting') ──
      this.client.on("open", () => {
        setStatus("connected");
        useEmulatorStore.getState().setConnectedAt(Date.now());
        addLog({
          direction: "System",
          action: "Connected",
          payload: { url: config.endpoint, protocol: config.ocppVersion },
        });
        this.sendBootNotification();
      });

      this.client.on("error", (err: Event | Error) => {
        setStatus("faulted");
        const message =
          err instanceof Error ? err.message : "WebSocket error event";
        addLog({
          direction: "Error",
          action: "WebSocket Error",
          payload: { message },
        });
      });

      this.client.on("close", (info: { code: number; reason: string }) => {
        setStatus("disconnected");
        useEmulatorStore.getState().setConnectedAt(null);
        this.clearAllTimers();
        addLog({
          direction: "System",
          action: "Disconnected",
          payload: { code: info.code, reason: info.reason },
        });
        // Reset connectors
        const { config: cfg, resetConnector } = useEmulatorStore.getState();
        for (let i = 1; i <= cfg.numberOfConnectors; i++) resetConnector(i);
      });

      this.client.on("connecting", (info: { url: string }) => {
        addLog({
          direction: "System",
          action: "Connecting",
          payload: { url: info.url },
        });
      });

      this.client.on(
        "reconnect",
        (info: { attempt: number; delay: number }) => {
          addLog({
            direction: "System",
            action: "Reconnecting",
            payload: info,
          });
        },
      );

      // Register CSMS handlers BEFORE connecting
      this.registerHandlers();

      // Async connect
      await this.client.connect();
    } catch (err: unknown) {
      setStatus("faulted");
      const msg =
        err instanceof Error ? err.message : "Failed to create client";
      useEmulatorStore.getState().addLog({
        direction: "Error",
        action: "Connect Failed",
        payload: { message: msg },
      });
    }
  }

  async disconnect() {
    try {
      await this.client?.close({ code: 1000, reason: "User disconnect" });
    } catch (_) {
      /* ignore close errors */
    }
    this.client = null;
    this.clearAllTimers();
    useEmulatorStore.getState().setStatus("disconnected");
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
  //     Handlers receive { params, messageId, method, protocol, signal }
  //     They must return the response payload.

  private registerHandlers() {
    if (!this.client) return;

    // ── Reset ──
    this.client.handle("Reset", (ctx) => {
      const payload = ctx.params as { type: string };
      const { addLog } = useEmulatorStore.getState();
      addLog({
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
      const { addLog, connectors } = useEmulatorStore.getState();
      const connId = payload.connectorId ?? 1;
      addLog({
        direction: "Rx",
        action: "RemoteStartTransaction",
        payload,
        ocppMessageId: ctx.messageId,
      });
      if (connectors[connId]?.inTransaction) return { status: "Rejected" };
      setTimeout(() => this.startTransaction(connId, payload.idTag), 500);
      return { status: "Accepted" };
    });

    // ── RemoteStopTransaction ──
    this.client.handle("RemoteStopTransaction", (ctx) => {
      const payload = ctx.params as { transactionId: number };
      const { addLog, connectors, config } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "RemoteStopTransaction",
        payload,
        ocppMessageId: ctx.messageId,
      });
      let connId: number | null = null;
      for (let i = 1; i <= config.numberOfConnectors; i++) {
        if (connectors[i]?.transactionId === payload.transactionId) {
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
      const { addLog, connectors, isUploading, config } =
        useEmulatorStore.getState();
      const connId = payload.connectorId ?? 1;
      addLog({
        direction: "Rx",
        action: "TriggerMessage",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const { requestedMessage } = payload;
      if (
        requestedMessage === "MeterValues" &&
        !connectors[connId]?.inTransaction
      )
        return { status: "Rejected" };
      setTimeout(() => {
        if (requestedMessage === "Heartbeat") this.sendHeartbeat();
        else if (requestedMessage === "BootNotification")
          this.sendBootNotification();
        else if (requestedMessage === "StatusNotification")
          this.sendStatusNotification(
            connId,
            connectors[connId]?.status ?? "Available",
          );
        else if (requestedMessage === "MeterValues")
          this.sendMeterValues(connId);
        else if (requestedMessage === "DiagnosticsStatusNotification") {
          this.sendDiagnosticsStatus(isUploading ? "Uploading" : "Idle");
        } else if (requestedMessage === "FirmwareStatusNotification") {
          this.sendFirmwareStatus(config.simulation.firmwareStatus);
        }
      }, 200);
      return { status: "Accepted" };
    });

    // ── GetConfiguration ──
    this.client.handle("GetConfiguration", (ctx) => {
      const payload = ctx.params as { key?: string[] };
      const { addLog, config } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "GetConfiguration",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const keys = payload?.key;
      const configurationKey = keys?.length
        ? config.stationConfig.filter((k: StationConfigKey) =>
            keys.includes(k.key),
          )
        : config.stationConfig;
      const unknownKey = keys?.length
        ? keys.filter(
            (k: string) =>
              !config.stationConfig.find(
                (sc: StationConfigKey) => sc.key === k,
              ),
          )
        : [];
      return { configurationKey, unknownKey };
    });

    // ── ChangeConfiguration ──
    this.client.handle("ChangeConfiguration", (ctx) => {
      const payload = ctx.params as { key: string; value: string };
      const { addLog, config, updateStationConfigKey } =
        useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "ChangeConfiguration",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const found = config.stationConfig.find(
        (k: StationConfigKey) => k.key === payload.key,
      );
      if (!found) return { status: "NotSupported" };
      if (found.readonly) return { status: "Rejected" };
      updateStationConfigKey(payload.key, payload.value);
      return { status: "Accepted" };
    });

    // ── UnlockConnector ──
    this.client.handle("UnlockConnector", (ctx) => {
      const payload = ctx.params as { connectorId: number };
      const { addLog, connectors } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "UnlockConnector",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const connector = connectors[payload.connectorId];
      return { status: connector?.unlockStatus ?? "UnlockFailed" };
    });

    // ── GetDiagnostics ──
    this.client.handle("GetDiagnostics", (ctx) => {
      const { addLog, config } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "GetDiagnostics",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      this.startDiagnosticsUpload();
      return { fileName: config.simulation.diagnosticFileName };
    });

    // ── UpdateFirmware ──
    this.client.handle("UpdateFirmware", (ctx) => {
      const { addLog } = useEmulatorStore.getState();
      addLog({
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
      useEmulatorStore.getState().addLog({
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
      const { addLog, updateConnector } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "ChangeAvailability",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const newStatus =
        payload.type === "Inoperative" ? "Unavailable" : "Available";
      if (payload.connectorId === 0) {
        // All connectors
        const { config } = useEmulatorStore.getState();
        for (let i = 1; i <= config.numberOfConnectors; i++) {
          updateConnector(i, { status: newStatus as any });
          this.sendStatusNotification(i, newStatus);
        }
      } else {
        updateConnector(payload.connectorId, { status: newStatus as any });
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
      const { addLog, connectors, updateConnector } =
        useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "ReserveNow",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const conn = connectors[payload.connectorId];
      if (!conn) return { status: "Rejected" };
      if (conn.inTransaction) return { status: "Occupied" };
      if (conn.status === "Faulted") return { status: "Faulted" };
      if (conn.status === "Unavailable") return { status: "Unavailable" };
      // Set reservation
      updateConnector(payload.connectorId, {
        status: "Reserved",
        reservation: {
          reservationId: payload.reservationId,
          idTag: payload.idTag,
          expiryDate: payload.expiryDate,
          parentIdTag: payload.parentIdTag,
        },
      });
      this.sendStatusNotification(payload.connectorId, "Reserved");
      // Auto-expire reservation
      const expiryMs = new Date(payload.expiryDate).getTime() - Date.now();
      if (expiryMs > 0) {
        this.reservationTimers[payload.connectorId] = setTimeout(() => {
          const { connectors: c } = useEmulatorStore.getState();
          if (
            c[payload.connectorId]?.reservation?.reservationId ===
            payload.reservationId
          ) {
            useEmulatorStore.getState().updateConnector(payload.connectorId, {
              status: "Available",
              reservation: null,
            });
            this.sendStatusNotification(payload.connectorId, "Available");
            useEmulatorStore.getState().addLog({
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
      const { addLog, connectors, updateConnector, config } =
        useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "CancelReservation",
        payload,
        ocppMessageId: ctx.messageId,
      });
      for (let i = 1; i <= config.numberOfConnectors; i++) {
        if (
          connectors[i]?.reservation?.reservationId === payload.reservationId
        ) {
          updateConnector(i, { status: "Available", reservation: null });
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
      const { addLog, connectors, updateConnector } =
        useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "SetChargingProfile",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const conn = connectors[payload.connectorId];
      if (!conn && payload.connectorId !== 0) return { status: "Rejected" };
      // Store profile (replace existing with same id + stackLevel)
      const profile = payload.csChargingProfiles;
      const targetId = payload.connectorId === 0 ? 1 : payload.connectorId;
      const existing = (connectors[targetId]?.chargingProfiles ?? []).filter(
        (p) =>
          !(
            p.chargingProfileId === profile.chargingProfileId &&
            p.stackLevel === profile.stackLevel
          ),
      );
      updateConnector(targetId, { chargingProfiles: [...existing, profile] });
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
      const { addLog, connectors, updateConnector, config } =
        useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "ClearChargingProfile",
        payload,
        ocppMessageId: ctx.messageId,
      });
      let found = false;
      for (let i = 1; i <= config.numberOfConnectors; i++) {
        if (
          payload.connectorId !== undefined &&
          payload.connectorId !== i &&
          payload.connectorId !== 0
        )
          continue;
        const profiles = connectors[i]?.chargingProfiles ?? [];
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
          updateConnector(i, { chargingProfiles: filtered });
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
      const { addLog, connectors } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "GetCompositeSchedule",
        payload,
        ocppMessageId: ctx.messageId,
      });
      const conn = connectors[payload.connectorId];
      if (!conn || conn.chargingProfiles.length === 0)
        return { status: "Rejected" };
      // Return the highest stack-level profile's schedule
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
      const { addLog, localAuthList, localAuthListVersion, setLocalAuthList } =
        useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "SendLocalList",
        payload,
        ocppMessageId: ctx.messageId,
      });
      if (
        payload.listVersion <= localAuthListVersion &&
        payload.updateType === "Differential"
      ) {
        return { status: "VersionMismatch" };
      }
      const newEntries = payload.localAuthorizationList ?? [];
      if (payload.updateType === "Full") {
        setLocalAuthList(newEntries, payload.listVersion);
      } else {
        // Differential: merge entries
        const merged = [...localAuthList];
        newEntries.forEach((entry) => {
          const idx = merged.findIndex((e) => e.idTag === entry.idTag);
          if (idx >= 0) merged[idx] = entry;
          else merged.push(entry);
        });
        setLocalAuthList(merged, payload.listVersion);
      }
      return { status: "Accepted" };
    });

    // ── GetLocalListVersion ──
    this.client.handle("GetLocalListVersion", (ctx) => {
      const { addLog, localAuthListVersion } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "GetLocalListVersion",
        payload: {},
        ocppMessageId: ctx.messageId,
      });
      return { listVersion: localAuthListVersion };
    });

    // ── DataTransfer (CSMS → CP) ──
    this.client.handle("DataTransfer", (ctx) => {
      const payload = ctx.params as {
        vendorId: string;
        messageId?: string;
        data?: string;
      };
      const { addLog } = useEmulatorStore.getState();
      addLog({
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
      const { addLog, connectors, isUploading, config } =
        useEmulatorStore.getState();
      const connId = payload.connectorId ?? 1;
      addLog({
        direction: "Rx",
        action: "ExtendedTriggerMessage",
        payload,
        ocppMessageId: ctx.messageId,
      });
      setTimeout(() => {
        const msg = payload.requestedMessage;
        if (msg === "BootNotification") this.sendBootNotification();
        else if (msg === "Heartbeat") this.sendHeartbeat();
        else if (msg === "StatusNotification")
          this.sendStatusNotification(
            connId,
            connectors[connId]?.status ?? "Available",
          );
        else if (msg === "MeterValues" && connectors[connId]?.inTransaction)
          this.sendMeterValues(connId);
        else if (msg === "FirmwareStatusNotification")
          this.sendFirmwareStatus(config.simulation.firmwareStatus);
        else if (msg === "LogStatusNotification")
          this.sendDiagnosticsStatus(isUploading ? "Uploading" : "Idle");
      }, 200);
      return { status: "Accepted" };
    });

    // ── GetLog ──
    this.client.handle("GetLog", (ctx) => {
      const { addLog, config } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "GetLog",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      this.startDiagnosticsUpload();
      return {
        status: "Accepted",
        filename: config.simulation.diagnosticFileName,
      };
    });

    // ── SignedUpdateFirmware ──
    this.client.handle("SignedUpdateFirmware", (ctx) => {
      const { addLog } = useEmulatorStore.getState();
      addLog({
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
      const { addLog } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "InstallCertificate",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── DeleteCertificate ──
    this.client.handle("DeleteCertificate", (ctx) => {
      const { addLog } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "DeleteCertificate",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });

    // ── GetInstalledCertificateIds ──
    this.client.handle("GetInstalledCertificateIds", (ctx) => {
      const { addLog } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "GetInstalledCertificateIds",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted", certificateHashData: [] };
    });

    // ── CertificateSigned ──
    this.client.handle("CertificateSigned", (ctx) => {
      const { addLog } = useEmulatorStore.getState();
      addLog({
        direction: "Rx",
        action: "CertificateSigned",
        payload: ctx.params,
        ocppMessageId: ctx.messageId,
      });
      return { status: "Accepted" };
    });
  }

  // ─── Outgoing Commands ─────────────────────────────────────────────────────

  async sendBootNotification() {
    if (!this.client) return;
    const { addLog, config } = useEmulatorStore.getState();
    const payload = { ...config.bootNotification };
    const msgId = nanoid(8);
    addLog({
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
      addLog({
        direction: "Rx",
        action: "BootNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
      if (res.status === "Accepted") {
        const interval = res.interval ?? 300;
        useEmulatorStore
          .getState()
          .updateStationConfigKey("HeartbeatInterval", String(interval));
        this.startHeartbeatTimer(interval);
        const { config: cfg } = useEmulatorStore.getState();
        for (let i = 1; i <= cfg.numberOfConnectors; i++)
          this.sendStatusNotification(i, "Available");
      }
    } catch (err) {
      addLog({
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
    const { addLog } = useEmulatorStore.getState();
    const msgId = nanoid(8);
    addLog({
      direction: "Tx",
      action: "Heartbeat",
      payload: {},
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("Heartbeat", {});
      addLog({
        direction: "Rx",
        action: "HeartbeatConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (err) {
      addLog({
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
    const { addLog, updateConnector } = useEmulatorStore.getState();
    const payload = {
      connectorId,
      errorCode,
      status,
      timestamp: new Date().toISOString(),
    };
    const msgId = nanoid(8);
    addLog({
      direction: "Tx",
      action: "StatusNotification",
      payload,
      ocppMessageId: msgId,
    });
    updateConnector(connectorId, { status: status as any });
    try {
      const res = await this.client.call("StatusNotification", payload);
      addLog({
        direction: "Rx",
        action: "StatusNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (err) {
      addLog({
        direction: "Error",
        action: "StatusNotification",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async authorize(_connectorId: number, idTag: string): Promise<boolean> {
    if (!this.client) return false;
    const { addLog } = useEmulatorStore.getState();
    const msgId = nanoid(8);
    addLog({
      direction: "Tx",
      action: "Authorize",
      payload: { idTag },
      ocppMessageId: msgId,
    });
    try {
      const res = (await this.client.call("Authorize", { idTag })) as {
        idTagInfo: { status: string };
      };
      addLog({
        direction: "Rx",
        action: "AuthorizeConf",
        payload: res,
        ocppMessageId: msgId,
      });
      return res?.idTagInfo?.status === "Accepted";
    } catch (err) {
      addLog({
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
    const { addLog, connectors, updateConnector } = useEmulatorStore.getState();
    const connector = connectors[connectorId];
    if (!connector) return;
    const tag = idTag ?? connector.idTag;
    const authorized = await this.authorize(connectorId, tag);
    if (!authorized) {
      addLog({
        direction: "System",
        action: "AuthFailed",
        payload: { message: "Authorization rejected" },
        ocppMessageId: nanoid(8),
      });
      return;
    }
    await this.sendStatusNotification(connectorId, "Preparing");
    const payload = {
      connectorId,
      idTag: tag,
      meterStart: connector.startMeterValue,
      timestamp: new Date().toISOString(),
    };
    const txMsgId = nanoid(8);
    addLog({
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
      addLog({
        direction: "Rx",
        action: "StartTransactionConf",
        payload: res,
        ocppMessageId: txMsgId,
      });
      if (res?.idTagInfo?.status === "Accepted") {
        updateConnector(connectorId, {
          inTransaction: true,
          transactionId: res.transactionId,
          idTag: tag,
        });
        await this.sendStatusNotification(connectorId, "Charging");
        const { config } = useEmulatorStore.getState();
        const meterInterval = parseInt(
          config.stationConfig.find(
            (k: StationConfigKey) => k.key === "MeterValueSampleInterval",
          )?.value ?? "60",
          10,
        );
        this.meterTimers[connectorId] = setInterval(() => {
          useEmulatorStore.getState().updateConnector(connectorId, {
            currentMeterValue:
              useEmulatorStore.getState().connectors[connectorId]
                .currentMeterValue + 50,
          });
          this.sendMeterValues(connectorId);
        }, meterInterval * 1000);
      } else {
        await this.sendStatusNotification(connectorId, "Available");
      }
    } catch (err) {
      addLog({
        direction: "Error",
        action: "StartTransaction",
        payload: { message: String(err) },
        ocppMessageId: txMsgId,
      });
    }
  }

  async sendMeterValues(connectorId: number) {
    if (!this.client) return;
    const { addLog, connectors } = useEmulatorStore.getState();
    const connector = connectors[connectorId];
    if (!connector?.inTransaction) return;
    const payload = {
      connectorId,
      transactionId: connector.transactionId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [
            {
              measurand: "Energy.Active.Import.Register",
              value: String(connector.currentMeterValue),
              unit: "Wh",
            },
            {
              measurand: "Power.Active.Import",
              value: String(Math.floor(Math.random() * 4000) + 3000),
              unit: "W",
            },
            { measurand: "Voltage", phase: "L1", value: "220", unit: "V" },
            {
              measurand: "Current.Import",
              phase: "L1",
              value: String((Math.random() * 10 + 5).toFixed(1)),
              unit: "A",
            },
            ...(useEmulatorStore.getState().config.simulation
              .autoChargeSocEnabled
              ? [
                  {
                    measurand: "SoC",
                    value: String(
                      Math.min(
                        100,
                        Math.round(
                          (connector.currentMeterValue /
                            (useEmulatorStore.getState().config.simulation
                              .autoChargeTargetKWh *
                              1000)) *
                            100,
                        ),
                      ),
                    ),
                    unit: "Percent",
                    location: "EV",
                  },
                  {
                    measurand: "Temperature",
                    value: String(25 + Math.floor(Math.random() * 10)),
                    unit: "Celsius",
                    location: "Body",
                  },
                ]
              : []),
          ],
        },
      ],
    };
    const msgId = nanoid(8);
    addLog({
      direction: "Tx",
      action: "MeterValues",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("MeterValues", payload);
      addLog({
        direction: "Rx",
        action: "MeterValuesConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (err) {
      addLog({
        direction: "Error",
        action: "MeterValues",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async stopTransaction(connectorId: number) {
    if (!this.client) return;
    const { addLog, connectors, updateConnector } = useEmulatorStore.getState();
    const connector = connectors[connectorId];
    if (!connector?.inTransaction) return;
    // Stop meter timer immediately
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
    addLog({
      direction: "Tx",
      action: "StopTransaction",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("StopTransaction", payload);
      addLog({
        direction: "Rx",
        action: "StopTransactionConf",
        payload: res,
        ocppMessageId: msgId,
      });
      updateConnector(connectorId, {
        inTransaction: false,
        transactionId: null,
        startMeterValue: connector.currentMeterValue,
      });
      await this.sendStatusNotification(connectorId, "Available");
    } catch (err) {
      addLog({
        direction: "Error",
        action: "StopTransaction",
        payload: { message: String(err) },
        ocppMessageId: msgId,
      });
    }
  }

  async sendDiagnosticsStatus(status: string) {
    if (!this.client) return;
    const { addLog } = useEmulatorStore.getState();
    const payload = { status };
    const msgId = nanoid(8);
    addLog({
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
      addLog({
        direction: "Rx",
        action: "DiagnosticsStatusNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (_) {}
  }

  async sendFirmwareStatus(status: string) {
    if (!this.client) return;
    const { addLog } = useEmulatorStore.getState();
    const payload = { status };
    const msgId = nanoid(8);
    addLog({
      direction: "Tx",
      action: "FirmwareStatusNotification",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("FirmwareStatusNotification", payload);
      addLog({
        direction: "Rx",
        action: "FirmwareStatusNotificationConf",
        payload: res,
        ocppMessageId: msgId,
      });
    } catch (_) {}
  }

  startDiagnosticsUpload() {
    const { config, setIsUploading, setUploadSecondsLeft } =
      useEmulatorStore.getState();
    if (this.uploadTimer) clearInterval(this.uploadTimer);
    let secs = config.simulation.diagnosticUploadTime;
    setIsUploading(true);
    setUploadSecondsLeft(secs);
    this.sendDiagnosticsStatus("Uploading");
    this.uploadTimer = setInterval(() => {
      secs -= 1;
      setUploadSecondsLeft(secs);
      if (secs <= 0) {
        if (this.uploadTimer) clearInterval(this.uploadTimer);
        this.uploadTimer = null;
        setIsUploading(false);
        const { config: cfg } = useEmulatorStore.getState();
        this.sendDiagnosticsStatus(cfg.simulation.diagnosticStatus);
      }
    }, 1000);
  }

  // ─── DataTransfer (CP → CSMS) ─────────────────────────────────────────────
  async sendDataTransfer(vendorId: string, messageId?: string, data?: string) {
    if (!this.client) return;
    const { addLog } = useEmulatorStore.getState();
    const payload: { vendorId: string; messageId?: string; data?: string } = {
      vendorId,
    };
    if (messageId) payload.messageId = messageId;
    if (data) payload.data = data;
    const msgId = nanoid(8);
    addLog({
      direction: "Tx",
      action: "DataTransfer",
      payload,
      ocppMessageId: msgId,
    });
    try {
      const res = await this.client.call("DataTransfer", payload);
      addLog({ direction: "Rx", action: "DataTransferConf", payload: res });
      return res;
    } catch (err) {
      addLog({
        direction: "Error",
        action: "DataTransfer",
        payload: { message: String(err) },
      });
    }
  }

  // ─── SecurityEventNotification (CP → CSMS) ────────────────────────────────
  async sendSecurityEventNotification(type: string, info?: string) {
    if (!this.client) return;
    const { addLog } = useEmulatorStore.getState();
    const payload = {
      type,
      timestamp: new Date().toISOString(),
      techInfo: info ?? "",
    };
    addLog({ direction: "Tx", action: "SecurityEventNotification", payload });
    try {
      const res = await this.client.call(
        "SecurityEventNotification" as any,
        payload as any,
      );
      addLog({
        direction: "Rx",
        action: "SecurityEventNotificationConf",
        payload: res,
      });
    } catch (err) {
      addLog({
        direction: "Error",
        action: "SecurityEventNotification",
        payload: { message: String(err) },
      });
    }
  }

  // ─── LogStatusNotification (CP → CSMS) ────────────────────────────────────
  async sendLogStatusNotification(status: string, requestId?: number) {
    if (!this.client) return;
    const { addLog } = useEmulatorStore.getState();
    const payload: Record<string, unknown> = { status };
    if (requestId !== undefined) payload.requestId = requestId;
    addLog({ direction: "Tx", action: "LogStatusNotification", payload });
    try {
      const res = await this.client.call(
        "LogStatusNotification" as any,
        payload as any,
      );
      addLog({
        direction: "Rx",
        action: "LogStatusNotificationConf",
        payload: res,
      });
    } catch (err) {
      addLog({
        direction: "Error",
        action: "LogStatusNotification",
        payload: { message: String(err) },
      });
    }
  }

  // ─── Auto Charge State Machine ─────────────────────────────────────────────
  // Simulates: Preparing → Authorize → StartTx → Charging → periodic meter → StopTx → Available
  async startAutoCharge(connectorId: number) {
    if (!this.client) return;
    const { connectors, config, addLog } = useEmulatorStore.getState();
    const conn = connectors[connectorId];
    if (!conn || conn.inTransaction) return;

    addLog({
      direction: "System",
      action: "AutoCharge",
      payload: { connectorId, message: "Starting auto-charge sequence" },
    });

    // Step 1: Authorize + StartTx
    await this.startTransaction(connectorId, conn.idTag);

    // Verify TX actually started
    const updated = useEmulatorStore.getState().connectors[connectorId];
    if (!updated?.inTransaction) {
      addLog({
        direction: "System",
        action: "AutoCharge",
        payload: {
          connectorId,
          message: "Auto-charge failed: transaction not started",
        },
      });
      return;
    }

    // Step 2: Schedule auto-stop
    const {
      autoChargeDurationSec,
      autoChargeTargetKWh,
      autoChargeMeterIncrement,
    } = config.simulation;
    const meterInterval = parseInt(
      config.stationConfig.find((k) => k.key === "MeterValueSampleInterval")
        ?.value ?? "60",
      10,
    );

    // Increment meter on interval
    let elapsed = 0;
    const tickSec = Math.min(meterInterval, 10);
    this.autoChargeTimers[connectorId] = setInterval(() => {
      elapsed += tickSec;
      const { connectors: c, updateConnector: uc } =
        useEmulatorStore.getState();
      const current = c[connectorId];
      if (!current?.inTransaction) {
        // TX was stopped externally
        if (this.autoChargeTimers[connectorId]) {
          clearInterval(this.autoChargeTimers[connectorId]);
          delete this.autoChargeTimers[connectorId];
        }
        return;
      }

      // Increment meter
      const newMeter = current.currentMeterValue + autoChargeMeterIncrement;
      uc(connectorId, { currentMeterValue: newMeter });

      // Check completion
      const targetWh = autoChargeTargetKWh * 1000;
      if (newMeter >= targetWh || elapsed >= autoChargeDurationSec) {
        if (this.autoChargeTimers[connectorId]) {
          clearInterval(this.autoChargeTimers[connectorId]);
          delete this.autoChargeTimers[connectorId];
        }
        this.sendMeterValues(connectorId);
        setTimeout(() => {
          uc(connectorId, { stopReason: "Local" as any });
          this.stopTransaction(connectorId);
          useEmulatorStore.getState().addLog({
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
    const { connectors } = useEmulatorStore.getState();
    if (connectors[connectorId]?.inTransaction) {
      this.stopTransaction(connectorId);
    }
  }

  // ─── Raw OCPP Call (Message Composer) ──────────────────────────────────────
  async sendRawCall(action: string, payload: Record<string, unknown>) {
    if (!this.client) return;
    const { addLog } = useEmulatorStore.getState();
    addLog({ direction: "Tx", action, payload });
    try {
      const res = await this.client.call(action as any, payload as any);
      addLog({ direction: "Rx", action: `${action}Conf`, payload: res });
      return res;
    } catch (err) {
      addLog({ direction: "Error", action, payload: { message: String(err) } });
    }
  }
}

export const ocppService = new OCPPService();
