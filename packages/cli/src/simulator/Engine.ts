import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface EngineConfig {
  endpoint: string;
  identity: string;
  protocol: string;
}

export class SimulatorEngine extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: EngineConfig;
  private pendingRequests = new Map<
    string,
    {
      resolve: (value?: any) => void;
      reject: (reason?: any) => void;
      timer: NodeJS.Timeout;
    }
  >();

  private heartbeatIntervalTrigger: NodeJS.Timeout | null = null;
  private autoMeterValuesTrigger: NodeJS.Timeout | null = null;
  private hardwareLoopTrigger: NodeJS.Timeout | null = null;

  // Basic Connector State
  public connectorState:
    | "Available"
    | "Preparing"
    | "Charging"
    | "Finishing"
    | "Faulted" = "Available";
  public activeTransactionId: number | null = null;
  public activeIdTag: string | null = null;

  // Live Hardware Metrics
  public meterWh: number = 0;
  public livePowerW: number = 0;
  public liveVoltage: number = 240;
  public liveCurrent: number = 0;
  public liveSoc: number = 45;
  public liveTemp: number = 30;

  private engineState: "POWER_ON" | "IDLE" | "CHARGING" | "FAULTED" =
    "POWER_ON";
  private configurations = new Map<string, string>();

  constructor(config: EngineConfig) {
    super();
    this.config = config;
  }

  public async start(): Promise<void> {
    this.emit(
      "log",
      `Simulator engine spinning up for ${this.config.identity}...`,
      "info",
    );
    await this.connect();
  }

  public stop(): void {
    if (this.heartbeatIntervalTrigger)
      clearInterval(this.heartbeatIntervalTrigger);
    if (this.autoMeterValuesTrigger) clearInterval(this.autoMeterValuesTrigger);
    if (this.hardwareLoopTrigger) clearInterval(this.hardwareLoopTrigger);

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    this.pendingRequests.forEach(({ reject, timer }) => {
      clearTimeout(timer);
      reject(new Error("Simulator stopping"));
    });
    this.pendingRequests.clear();
  }

  private connect(): Promise<void> {
    return new Promise((resolve, _reject) => {
      const url = `${this.config.endpoint}/${this.config.identity}`;
      this.emit(
        "log",
        `Connecting to ${url} using ${this.config.protocol}...`,
        "info",
      );

      this.ws = new WebSocket(url, [this.config.protocol]);

      this.ws.on("open", async () => {
        this.emit("log", "WebSocket Connected.", "success");
        this.startHardwareLoop();
        resolve();
        await this.runBootSequence();
      });

      this.ws.on("message", (data) => {
        this.handleIncomingMessage(data.toString());
      });

      this.ws.on("error", (err) => {
        this.emit("log", `WebSocket Error: ${err.message}`, "error");
      });

      this.ws.on("close", (code, reason) => {
        this.emit(
          "log",
          `WebSocket closed: ${code} - ${reason.toString() || "No reason"}`,
          "warn",
        );
        // Basic auto-reconnect logic
        if (this.engineState !== "POWER_ON") {
          this.emit("log", "Attempting to reconnect in 5 seconds...", "warn");
          setTimeout(() => this.connect(), 5000);
        }
      });
    });
  }

  private async runBootSequence() {
    this.engineState = "POWER_ON";
    this.emit("log", "Sending BootNotification...", "info");

    try {
      const response = await this.sendCall("BootNotification", {
        chargePointVendor: "OCPP-WS-IO CLI",
        chargePointModel: "VirtualSimulator-v1",
        chargePointSerialNumber: "SIM-001",
        firmwareVersion: "1.0.0-alpha",
      });

      if (response.status === "Accepted") {
        this.emit("log", "BootNotification Accepted.", "success");
        const interval = response.interval || 300;

        // Start Heartbeat
        this.emit(
          "log",
          `Heartbeat interval set to ${interval} seconds.`,
          "info",
        );
        this.heartbeatIntervalTrigger = setInterval(() => {
          this.sendCall("Heartbeat", {}).catch((e) =>
            this.emit("log", `Heartbeat fail: ${e.message}`, "error"),
          );
        }, interval * 1000);

        this.engineState = "IDLE";
        this.emit("log", "Entering IDLE state...", "info");

        // Initial Status Notification
        await this.updateConnectorState("Available");

        // TODO: Send StatusNotification loop here.
        this.emit(
          "log",
          "Simulator automated loop running. Waiting for commands. (Press Ctrl+C to stop)",
          "info",
        );
      } else {
        this.emit(
          "log",
          `BootNotification ${response.status}. Will retry in 10 seconds...`,
          "warn",
        );
        setTimeout(() => this.runBootSequence(), 10000);
      }
    } catch (err) {
      this.emit(
        "log",
        `BootSequence failed: ${(err as Error).message}`,
        "error",
      );
      setTimeout(() => this.runBootSequence(), 10000);
    }
  }

  private handleIncomingMessage(raw: string) {
    try {
      const parsed = JSON.parse(raw);
      const [typeId, messageId] = parsed;

      // Type 3 = CALLRESULT
      if (typeId === 3) {
        const payload = parsed[2];
        const pending = this.pendingRequests.get(messageId);
        if (pending) {
          clearTimeout(pending.timer);
          pending.resolve(payload);
          this.pendingRequests.delete(messageId);
        }
      }
      // Type 4 = CALLERROR
      else if (typeId === 4) {
        const [, , errorCode, errorDesc] = parsed;
        const pending = this.pendingRequests.get(messageId);
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`[${errorCode}] ${errorDesc}`));
          this.pendingRequests.delete(messageId);
        }
      }
      // Type 2 = CALL (CSMS request)
      else if (typeId === 2) {
        const action = parsed[2];
        const payload = parsed[3];
        this.handleCSMSCall(messageId, action, payload);
      }
    } catch (_e) {
      this.emit("log", "Failed to parse incoming WS message.", "error");
    }
  }

  private handleCSMSCall(
    messageId: string,
    action: string,
    payload: Record<string, string>,
  ) {
    this.emit("log", `[CSMS Request] ${action}`, "info");

    switch (action) {
      case "Reset":
        this.emit("log", `CSMS requested ${payload.type} Reset.`, "warn");
        this.sendCallResult(messageId, { status: "Accepted" });
        setTimeout(() => {
          this.emit("log", "Simulating reboot...", "info");
          this.stop();
          this.start();
        }, 2000);
        break;

      case "RemoteStartTransaction":
        this.emit(
          "log",
          `CSMS requested RemoteStart for tag ${payload.idTag}`,
          "info",
        );
        if (
          this.connectorState === "Available" ||
          this.connectorState === "Preparing"
        ) {
          this.sendCallResult(messageId, { status: "Accepted" });
          this.activeIdTag = payload.idTag;
          this.startTransaction().catch((e) =>
            this.emit("log", e.message, "error"),
          );
        } else {
          this.sendCallResult(messageId, { status: "Rejected" });
        }
        break;

      case "RemoteStopTransaction":
        this.emit(
          "log",
          `CSMS requested RemoteStop for transaction ${payload.transactionId}`,
          "info",
        );
        if (this.activeTransactionId === Number(payload.transactionId)) {
          this.sendCallResult(messageId, { status: "Accepted" });
          this.stopTransaction().catch((e) =>
            this.emit("log", e.message, "error"),
          );
        } else {
          this.sendCallResult(messageId, { status: "Rejected" });
        }
        break;

      case "UnlockConnector":
        this.emit(
          "log",
          `CSMS requested Unlock for connector ${payload.connectorId}`,
          "info",
        );
        if (this.engineState === "CHARGING") {
          this.sendCallResult(messageId, { status: "UnlockFailed" });
        } else {
          this.sendCallResult(messageId, { status: "Unlocked" });
        }
        break;

      case "ChangeAvailability":
        this.emit(
          "log",
          `CSMS requested ChangeAvailability to ${payload.type}`,
          "info",
        );
        this.sendCallResult(messageId, { status: "Accepted" });
        if (payload.type === "Inoperative") {
          this.updateConnectorState("Faulted").catch(() => {});
        } else {
          this.updateConnectorState("Available").catch(() => {});
        }
        break;

      case "ClearCache":
        this.emit("log", "CSMS requested ClearCache.", "info");
        this.sendCallResult(messageId, { status: "Accepted" });
        break;

      case "ChangeConfiguration":
        this.emit(
          "log",
          `CSMS requested ChangeConfiguration: ${payload.key} = ${payload.value}`,
          "info",
        );
        this.configurations.set(payload.key, payload.value);
        this.sendCallResult(messageId, { status: "Accepted" });
        break;

      case "GetConfiguration": {
        this.emit("log", "CSMS requested GetConfiguration", "info");
        const keys = payload.key || [];
        const configurationKey = [];
        const unknownKey = [];

        if (keys.length === 0) {
          // Return all
          for (const [k, v] of this.configurations.entries()) {
            configurationKey.push({ key: k, readonly: false, value: v });
          }
        } else {
          for (const k of keys) {
            if (this.configurations.has(k)) {
              configurationKey.push({
                key: k,
                readonly: false,
                value: this.configurations.get(k),
              });
            } else {
              unknownKey.push(k);
            }
          }
        }
        this.sendCallResult(messageId, { configurationKey, unknownKey });
        break;
      }

      case "SetChargingProfile":
      case "ClearChargingProfile":
      case "GetCompositeSchedule":
      case "ReserveNow":
      case "CancelReservation":
      case "SendLocalList":
      case "GetLocalListVersion":
      case "UpdateFirmware":
      case "GetDiagnostics":
      case "TriggerMessage":
      case "DataTransfer":
        this.emit(
          "log",
          `CSMS requested ${action}. Stubbing 'Accepted' response...`,
          "warn",
        );
        // Generic Acceptance Stub for complex 1.6 flows
        this.sendCallResult(messageId, { status: "Accepted" });
        break;

      default:
        this.emit("log", `Unhandled action from CSMS: ${action}`, "warn");
        // Send NotImplemented CallError
        this.ws?.send(
          JSON.stringify([
            4,
            messageId,
            "NotImplemented",
            "Automated simulator hasn't implemented this action yet",
            {},
          ]),
        );
        break;
    }
  }

  // ── Dispatch Methods (Interactive UI hooks) ────────────────

  public async updateConnectorState(
    status: "Available" | "Preparing" | "Charging" | "Finishing" | "Faulted",
  ): Promise<void> {
    this.connectorState = status;
    try {
      if (this.config.protocol.startsWith("ocpp2")) {
        // OCPP 2.0.1+ payload
        await this.sendCall("StatusNotification", {
          timestamp: new Date().toISOString(),
          connectorStatus:
            status === "Preparing" ||
            status === "Charging" ||
            status === "Finishing"
              ? "Occupied"
              : status,
          evseId: 1,
          connectorId: 1,
        });
      } else {
        // OCPP 1.6 payload
        await this.sendCall("StatusNotification", {
          connectorId: 1,
          errorCode: "NoError",
          status: status,
        });
      }
      this.emit("log", `StatusNotification (${status}) Accepted.`, "success");
    } catch (err: any) {
      this.emit("log", `StatusNotification failed: ${err.message}`, "error");
    }
  }

  public async authorize(idTag: string): Promise<void> {
    this.emit("log", `Sending Authorize for ${idTag}...`, "info");
    try {
      const payload = this.config.protocol.startsWith("ocpp2")
        ? { idToken: { idToken: idTag, type: "ISO14443" } }
        : { idTag };

      const response = await this.sendCall("Authorize", payload);

      const status = this.config.protocol.startsWith("ocpp2")
        ? response.idTokenInfo?.status
        : response.idTagInfo?.status;

      this.emit("log", `Authorize Response: ${status}`, "success");
      if (status === "Accepted") {
        this.activeIdTag = idTag;
        await this.updateConnectorState("Preparing");
      }
    } catch (err) {
      this.emit("log", `Authorize failed: ${(err as Error).message}`, "error");
    }
  }

  public async startTransaction(): Promise<void> {
    if (
      this.connectorState !== "Preparing" &&
      this.connectorState !== "Available"
    ) {
      this.emit(
        "log",
        "Must be in Preparing or Available state to start transaction.",
        "error",
      );
      return;
    }
    const idTag = this.activeIdTag || "DEADBEEF";
    this.emit("log", `Starting Transaction for ${idTag}...`, "info");
    try {
      if (this.config.protocol.startsWith("ocpp2")) {
        this.activeTransactionId = Math.floor(Math.random() * 1000000);
        await this.sendCall("TransactionEvent", {
          eventType: "Started",
          timestamp: new Date().toISOString(),
          triggerReason: "CablePluggedIn",
          seqNo: 1,
          transactionInfo: {
            transactionId: this.activeTransactionId.toString(),
          },
          idToken: { idToken: idTag, type: "ISO14443" },
          evse: { id: 1, connectorId: 1 },
          meterValue: [
            {
              timestamp: new Date().toISOString(),
              sampledValue: [{ value: this.meterWh }],
            },
          ],
        });
      } else {
        const response = await this.sendCall("StartTransaction", {
          connectorId: 1,
          idTag,
          meterStart: this.meterWh,
          timestamp: new Date().toISOString(),
        });
        this.activeTransactionId = response.transactionId;
      }

      this.emit(
        "log",
        `Transaction ${this.activeTransactionId} Started.`,
        "success",
      );

      this.engineState = "CHARGING";
      await this.updateConnectorState("Charging");

      this.autoMeterValuesTrigger = setInterval(() => {
        this.triggerMeterValues();
      }, 10000);
    } catch (err) {
      this.emit(
        "log",
        `StartTransaction failed: ${(err as Error).message}`,
        "error",
      );
    }
  }

  public async triggerMeterValues(): Promise<void> {
    if (!this.activeTransactionId) {
      this.emit(
        "log",
        "No active transaction to send MeterValues for.",
        "warn",
      );
      return;
    }

    // Force a minor power increment just for the generic update pulse
    this.livePowerW = 5000 + (Math.random() * 200 - 100);
    this.meterWh += 14;

    try {
      if (this.config.protocol.startsWith("ocpp2")) {
        await this.sendCall("TransactionEvent", {
          eventType: "Updated",
          timestamp: new Date().toISOString(),
          triggerReason: "MeterValuePeriodic",
          seqNo: 2,
          transactionInfo: {
            transactionId: this.activeTransactionId.toString(),
          },
          evse: { id: 1, connectorId: 1 },
          meterValue: [
            {
              timestamp: new Date().toISOString(),
              sampledValue: [
                {
                  value: this.meterWh,
                  context: "Sample.Periodic",
                  measurand: "Energy.Active.Import.Register",
                },
                {
                  value: this.livePowerW,
                  context: "Sample.Periodic",
                  measurand: "Power.Active.Import",
                },
              ],
            },
          ],
        });
      } else {
        await this.sendCall("MeterValues", {
          connectorId: 1,
          transactionId: this.activeTransactionId,
          meterValue: [
            {
              timestamp: new Date().toISOString(),
              sampledValue: [
                {
                  value: this.meterWh.toFixed(2),
                  context: "Sample.Periodic",
                  format: "Raw",
                  measurand: "Energy.Active.Import.Register",
                  location: "Outlet",
                  unit: "Wh",
                },
                {
                  value: this.livePowerW.toFixed(2),
                  context: "Sample.Periodic",
                  format: "Raw",
                  measurand: "Power.Active.Import",
                  location: "Outlet",
                  unit: "W",
                },
              ],
            },
          ],
        });
      }
      this.emit("log", "MeterValues transmitted", "info");
    } catch (err: any) {
      this.emit("log", `MeterValues failed: ${err.message}`, "error");
    }
  }

  public async stopTransaction(): Promise<void> {
    if (!this.activeTransactionId) {
      this.emit("log", "No active transaction to stop.", "error");
      return;
    }

    this.emit(
      "log",
      `Stopping Transaction ${this.activeTransactionId}...`,
      "info",
    );
    if (this.autoMeterValuesTrigger) {
      clearInterval(this.autoMeterValuesTrigger);
      this.autoMeterValuesTrigger = null;
    }

    try {
      if (this.config.protocol.startsWith("ocpp2")) {
        await this.sendCall("TransactionEvent", {
          eventType: "Ended",
          timestamp: new Date().toISOString(),
          triggerReason: "RemoteStop",
          seqNo: 3,
          transactionInfo: {
            transactionId: this.activeTransactionId.toString(),
            stoppedReason: "Local",
          },
          idToken: {
            idToken: this.activeIdTag || "DEADBEEF",
            type: "ISO14443",
          },
          evse: { id: 1, connectorId: 1 },
          meterValue: [
            {
              timestamp: new Date().toISOString(),
              sampledValue: [{ value: this.meterWh }],
            },
          ],
        });
      } else {
        await this.sendCall("StopTransaction", {
          transactionId: this.activeTransactionId,
          idTag: this.activeIdTag || undefined,
          meterStop: this.meterWh,
          timestamp: new Date().toISOString(),
          reason: "Local",
        });
      }
      this.emit(
        "log",
        `Transaction ${this.activeTransactionId} Stopped.`,
        "success",
      );

      this.activeTransactionId = null;
      this.activeIdTag = null;
      this.livePowerW = 0;
      this.engineState = "IDLE";

      await this.updateConnectorState("Finishing");
      setTimeout(() => this.updateConnectorState("Available"), 2000);
    } catch (err) {
      this.emit(
        "log",
        `StopTransaction failed: ${(err as Error).message}`,
        "error",
      );
    }
  }

  // ── Network Layer ────────────────────────────────────────────────

  // Helper for sending 2-CALL messages
  private sendCall(
    action: string,
    payload: Record<string, unknown>,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("WebSocket not open"));
      }

      const messageId = crypto.randomUUID();
      const message = [2, messageId, action, payload];

      const timer = setTimeout(() => {
        this.pendingRequests.delete(messageId);
        reject(
          new Error(`Timeout waiting for CALLRESULT for action: ${action}`),
        );
      }, 15000);

      this.pendingRequests.set(messageId, { resolve, reject, timer });

      // Log outbound message
      if (action !== "Heartbeat") {
        this.emit("log", `[REQ] ${action}`, "info");
      }

      this.ws.send(JSON.stringify(message));
    });
  }

  private sendCallResult(messageId: string, payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const message = [3, messageId, payload];
    this.ws.send(JSON.stringify(message));
  }

  // ── Hardware Simulation Loop ─────────────────────────────────────

  private startHardwareLoop() {
    this.hardwareLoopTrigger = setInterval(() => {
      // Fluctuate temp slightly between 28 and 35
      this.liveTemp += Math.random() - 0.5;
      if (this.liveTemp > 35) this.liveTemp = 35;
      if (this.liveTemp < 20) this.liveTemp = 20;

      // Update current based on active power
      this.liveCurrent = this.livePowerW / this.liveVoltage;

      // SoC climbs if charging
      if (this.engineState === "CHARGING") {
        this.liveSoc += this.livePowerW / 50000; // Rough mock calculation for soc climb
        if (this.liveSoc > 100) this.liveSoc = 100;

        // Auto-stop at 100%
        if (this.liveSoc >= 100 && this.activeTransactionId) {
          this.emit(
            "log",
            "SoC reached 100%. Auto-stopping transaction.",
            "warn",
          );
          this.stopTransaction();
        }
      }

      this.emit("metrics", {
        power: this.livePowerW,
        voltage: this.liveVoltage,
        current: this.liveCurrent,
        temp: this.liveTemp,
        soc: this.liveSoc,
        energy: this.meterWh,
      });
    }, 1000);
  }
}
