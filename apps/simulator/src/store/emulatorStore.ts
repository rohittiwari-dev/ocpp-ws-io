import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// ─── Connection / Connector Status Types ─────────────────────────────────────

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "faulted";

export type ConnectorStatus =
  | "Available"
  | "Preparing"
  | "Charging"
  | "SuspendedEV"
  | "SuspendedEVSE"
  | "Finishing"
  | "Reserved"
  | "Unavailable"
  | "Faulted";

export type StopReason =
  | "EmergencyStop"
  | "EVDisconnected"
  | "HardReset"
  | "Local"
  | "Other"
  | "PowerLoss"
  | "Reboot"
  | "Remote"
  | "SoftReset"
  | "UnlockCommand"
  | "DeAuthorized";

// ─── Sub-types ────────────────────────────────────────────────────────────────

export interface Reservation {
  reservationId: number;
  idTag: string;
  expiryDate: string;
  parentIdTag?: string;
}

export interface LocalAuthEntry {
  idTag: string;
  idTagInfo?: {
    status: "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx";
    expiryDate?: string;
    parentIdTag?: string;
  };
}

export interface ChargingProfile {
  chargingProfileId: number;
  transactionId?: number;
  stackLevel: number;
  chargingProfilePurpose:
    | "ChargePointMaxProfile"
    | "TxDefaultProfile"
    | "TxProfile";
  chargingProfileKind: "Absolute" | "Recurring" | "Relative";
  recurrencyKind?: "Daily" | "Weekly";
  validFrom?: string;
  validTo?: string;
  chargingSchedule: {
    duration?: number;
    startSchedule?: string;
    chargingRateUnit: "A" | "W";
    chargingSchedulePeriod: {
      startPeriod: number;
      limit: number;
      numberPhases?: number;
    }[];
    minChargingRate?: number;
  };
}

export interface ConnectorState {
  connectorId: number;
  status: ConnectorStatus;
  idTag: string;
  inTransaction: boolean;
  transactionId: number | null;
  startMeterValue: number;
  currentMeterValue: number;
  stopReason: StopReason;
  unlockStatus: "Unlocked" | "UnlockFailed";
  reservation: Reservation | null;
  chargingProfiles: ChargingProfile[];
}

export interface OCPPLog {
  id: string;
  timestamp: string;
  direction: "Tx" | "Rx" | "System" | "Error";
  action: string;
  payload: unknown;
  ocppMessageId?: string;
  rawMessage?: string;
}

export interface BootNotificationConfig {
  chargePointVendor: string;
  chargePointModel: string;
  chargePointSerialNumber: string;
  chargeBoxSerialNumber: string;
  firmwareVersion: string;
  iccid: string;
  imsi: string;
  meterType: string;
  meterSerialNumber: string;
}

export interface StationConfigKey {
  key: string;
  readonly: boolean;
  value: string;
}

export interface VendorConfig {
  vendorId: string;
  vendorErrorCode: string;
  customDataStr: string;
}

// ─── OCPP 2.x Types ──────────────────────────────────────────────────────────

export interface ComponentVariable {
  component: string; // e.g. "ChargingStation", "EVSE", "Connector"
  variable: string; // e.g. "AvailabilityState", "Model"
  value: string;
  mutability: "ReadOnly" | "ReadWrite";
}

export interface EVSEConnector {
  connectorId: number;
  type?: string; // e.g. "cType2", "cCCS2"
}

export interface EVSEState {
  evseId: number;
  status: "Available" | "Occupied" | "Reserved" | "Unavailable" | "Faulted";
  connectors: EVSEConnector[];
}

export interface MeasurandsConfig {
  energy: boolean;
  power: boolean;
  soc: boolean;
  voltage: boolean;
  current: boolean;
  temperature: boolean;
  frequency: boolean;
  threePhase: boolean;
}

export interface SimulationConfig {
  diagnosticFileName: string;
  diagnosticUploadTime: number;
  diagnosticStatus: "Uploaded" | "UploadFailed";
  firmwareStatus: string;
  // Auto charging
  autoChargeTargetKWh: number;
  autoChargeDurationSec: number;
  autoChargeMeterIncrement: number;
  autoChargeSocEnabled: boolean;
  // Measurands
  measurands: MeasurandsConfig;
  // Response latency simulation
  responseDelayMs: number;
}

export interface EmulatorConfig {
  // Connection
  endpoint: string;
  chargePointId: string;
  ocppVersion: "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1";
  /** Only 0 (plain WS) and 1 (Basic Auth) are supported in browser */
  securityProfile: 0 | 1;
  basicAuthPassword: string;
  // Hardware Identity
  bootNotification: BootNotificationConfig;
  // Station Config
  stationConfig: StationConfigKey[];
  // Simulation
  simulation: SimulationConfig;
  // Connector defaults
  rfidTag: string;
  numberOfConnectors: 1 | 2;
  // Vendor Extensions
  vendorConfig: VendorConfig;
}

export interface ConfigProfile {
  name: string;
  config: EmulatorConfig;
  createdAt: string;
}

// ─── Per-Charger Runtime State ────────────────────────────────────────────────

export interface ChargerRuntimeState {
  status: ConnectionStatus;
  connectors: Record<number, ConnectorState>;
  logs: OCPPLog[];
  isUploading: boolean;
  uploadSecondsLeft: number;
  localAuthList: LocalAuthEntry[];
  localAuthListVersion: number;
  connectedAt: number | null;
  // Offline simulation
  offlineMode: boolean;
  offlineQueue: { action: string; payload: unknown; timestamp: string }[];
  // ── OCPP 2.x runtime ──
  deviceModel: ComponentVariable[];
  evse: EVSEState[];
  transactionSeq: number;
}

// ─── Charger Slot (one per tab) ───────────────────────────────────────────────

export interface ChargerSlot {
  id: string;
  label: string;
  config: EmulatorConfig;
  savedProfiles: ConfigProfile[];
  runtime: ChargerRuntimeState;
}

// ─── Store Shape ─────────────────────────────────────────────────────────────

export interface EmulatorStore {
  chargers: ChargerSlot[];
  activeChargerId: string;

  // ── Tab management ──
  addCharger: () => void;
  removeCharger: (id: string) => void;
  duplicateCharger: (id: string) => void;
  setActiveCharger: (id: string) => void;
  reorderChargers: (fromIndex: number, toIndex: number) => void;
  updateChargerLabel: (id: string, label: string) => void;

  // ── Per-charger config ──
  updateConfig: (id: string, cfg: Partial<EmulatorConfig>) => void;
  updateBootNotification: (
    id: string,
    fields: Partial<BootNotificationConfig>,
  ) => void;
  updateStationConfigKey: (id: string, key: string, value: string) => void;
  updateSimulation: (id: string, fields: Partial<SimulationConfig>) => void;
  updateVendorConfig: (id: string, fields: Partial<VendorConfig>) => void;

  // ── Per-charger runtime ──
  setStatus: (id: string, status: ConnectionStatus) => void;
  updateConnector: (
    id: string,
    connId: number,
    data: Partial<ConnectorState>,
  ) => void;
  resetConnector: (id: string, connId: number) => void;
  addLog: (id: string, log: Omit<OCPPLog, "id" | "timestamp">) => void;
  clearLogs: (id: string) => void;
  setIsUploading: (id: string, val: boolean) => void;
  setUploadSecondsLeft: (id: string, val: number) => void;
  setLocalAuthList: (
    id: string,
    list: LocalAuthEntry[],
    version: number,
  ) => void;
  setConnectedAt: (id: string, ts: number | null) => void;

  // ── Offline queueing ──
  toggleOfflineMode: (id: string) => void;
  addToOfflineQueue: (
    id: string,
    entry: { action: string; payload: unknown; timestamp: string },
  ) => void;
  clearOfflineQueue: (id: string) => void;

  // ── Per-charger profiles ──
  saveProfile: (id: string, name: string) => void;
  loadProfile: (id: string, name: string) => void;
  deleteProfile: (id: string, name: string) => void;

  // ── Per-charger OCPP 2.x runtime ──
  updateEVSE: (
    id: string,
    evseId: number,
    data: Partial<Omit<EVSEState, "evseId">>,
  ) => void;
  setDeviceVariable: (
    id: string,
    component: string,
    variable: string,
    value: string,
  ) => void;
  bumpTransactionSeq: (id: string) => number;

  // ── Selector helper ──
  getSlot: (id: string) => ChargerSlot | undefined;
}

// ─── Compatibility shim – so existing components work with useActiveCharger ──

export type EmulatorState = ChargerSlot &
  ChargerRuntimeState & {
    // Bound actions (no id param, uses activeChargerId)
    updateConfig: (cfg: Partial<EmulatorConfig>) => void;
    updateBootNotification: (fields: Partial<BootNotificationConfig>) => void;
    updateStationConfigKey: (key: string, value: string) => void;
    updateSimulation: (fields: Partial<SimulationConfig>) => void;
    setStatus: (status: ConnectionStatus) => void;
    updateConnector: (connId: number, data: Partial<ConnectorState>) => void;
    resetConnector: (connId: number) => void;
    addLog: (log: Omit<OCPPLog, "id" | "timestamp">) => void;
    clearLogs: () => void;
    setIsUploading: (val: boolean) => void;
    setUploadSecondsLeft: (val: number) => void;
    setLocalAuthList: (list: LocalAuthEntry[], version: number) => void;
    setConnectedAt: (ts: number | null) => void;
    saveProfile: (name: string) => void;
    loadProfile: (name: string) => void;
    deleteProfile: (name: string) => void;
    updateEVSE: (
      evseId: number,
      data: Partial<Omit<EVSEState, "evseId">>,
    ) => void;
    setDeviceVariable: (
      component: string,
      variable: string,
      value: string,
    ) => void;
    bumpTransactionSeq: () => number;
  };

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_BOOT_NOTIFICATION: BootNotificationConfig = {
  chargePointVendor: "Elmo",
  chargePointModel: "Virtual-Emulator-1",
  chargePointSerialNumber: "elm.001.00",
  chargeBoxSerialNumber: "elm.001.00.01",
  firmwareVersion: "1.0.0",
  iccid: "",
  imsi: "",
  meterType: "ELM NQC-ACDC",
  meterSerialNumber: "elm.001.00.01",
};

export const DEFAULT_MEASURANDS: MeasurandsConfig = {
  energy: true,
  power: true,
  soc: false,
  voltage: false,
  current: false,
  temperature: false,
  frequency: false,
  threePhase: false,
};

const DEFAULT_STATION_CONFIG: StationConfigKey[] = [
  // ── Core & Security ──
  { key: "AuthorizeRemoteTxRequests", readonly: true, value: "false" },
  { key: "SecurityProfile", readonly: false, value: "0" },
  { key: "AuthorizationKey", readonly: false, value: "" },
  { key: "CpoName", readonly: false, value: "ocpp-ws-io" },
  { key: "ResetRetries", readonly: false, value: "3" },
  { key: "WebSocketPingInterval", readonly: false, value: "600" },

  // ── Connection Diagnostics ──
  { key: "ConnectionTimeOut", readonly: false, value: "60" },
  { key: "HeartbeatInterval", readonly: false, value: "300" },
  { key: "TransactionMessageAttempts", readonly: false, value: "3" },
  { key: "TransactionMessageRetryInterval", readonly: false, value: "60" },

  // ── Smart Charging ──
  { key: "ChargeProfileMaxStackLevel", readonly: true, value: "1" },
  { key: "MaxChargingProfilesInstalled", readonly: true, value: "10" },
  {
    key: "ChargingScheduleAllowedChargingRateUnit",
    readonly: true,
    value: "Current,Power",
  },
  { key: "ChargingScheduleMaxPeriods", readonly: true, value: "1" },

  // ── Telemetry & Meter Values ──
  { key: "MeterValueSampleInterval", readonly: false, value: "60" },
  { key: "ClockAlignedDataInterval", readonly: true, value: "0" },
  { key: "MeterValuesAlignedData", readonly: true, value: "0" },
  {
    key: "MeterValuesSampledData",
    readonly: true,
    value: "Energy.Active.Import.Register,Power.Active.Import",
  },

  // ── Local Authorization ──
  { key: "LocalAuthListMaxLength", readonly: true, value: "100" },
  { key: "SendLocalListMaxLength", readonly: true, value: "10" },
  { key: "LocalAuthorizeOffline", readonly: true, value: "false" },
  { key: "LocalPreAuthorize", readonly: true, value: "false" },

  // ── Transaction & Feature Discovery ──
  { key: "GetConfigurationMaxKeys", readonly: true, value: "20" },
  { key: "NumberOfConnectors", readonly: true, value: "1" },
  { key: "ConnectorPhaseRotation", readonly: true, value: "Unknown" },
  {
    key: "SupportedFeatureProfiles",
    readonly: true,
    value:
      "Core,Reservation,SmartCharging,RemoteTrigger,LocalAuthListManagement",
  },
  { key: "StopTransactionOnEVSideDisconnect", readonly: true, value: "true" },
  { key: "StopTransactionOnInvalidId", readonly: true, value: "true" },
  { key: "StopTxnAlignedData", readonly: true, value: " " },
  { key: "StopTxnSampledData", readonly: true, value: " " },
  { key: "UnlockConnectorOnEVSideDisconnect", readonly: true, value: "true" },
];

const DEFAULT_SIMULATION: SimulationConfig = {
  diagnosticFileName: "diagnostics.csv",
  diagnosticUploadTime: 30,
  diagnosticStatus: "Uploaded",
  firmwareStatus: "Downloaded",
  autoChargeTargetKWh: 30,
  autoChargeDurationSec: 120,
  autoChargeMeterIncrement: 250,
  autoChargeSocEnabled: true,
  measurands: DEFAULT_MEASURANDS,
  responseDelayMs: 0,
};

const makeDefaultConfig = (index: number): EmulatorConfig => ({
  endpoint: "ws://localhost:9000",
  chargePointId: `CP-00${index}`,
  ocppVersion: "ocpp1.6",
  securityProfile: 0,
  basicAuthPassword: "",
  bootNotification: { ...DEFAULT_BOOT_NOTIFICATION },
  stationConfig: DEFAULT_STATION_CONFIG.map((k) => ({ ...k })),
  simulation: { ...DEFAULT_SIMULATION, measurands: { ...DEFAULT_MEASURANDS } },
  rfidTag: "DEADBEEF",
  numberOfConnectors: 1,
  vendorConfig: {
    vendorId: "VirtualVendor",
    vendorErrorCode: "",
    customDataStr: "{}",
  },
});

const makeDefaultConnector = (
  connId: number,
  rfidTag: string,
): ConnectorState => ({
  connectorId: connId,
  status: "Available",
  idTag: rfidTag,
  inTransaction: false,
  transactionId: null,
  startMeterValue: 0,
  currentMeterValue: 0,
  stopReason: "Remote",
  unlockStatus: "Unlocked",
  reservation: null,
  chargingProfiles: [],
});

const makeDefaultRuntime = (rfidTag: string): ChargerRuntimeState => ({
  status: "disconnected",
  connectors: {
    1: makeDefaultConnector(1, rfidTag),
    2: makeDefaultConnector(2, rfidTag),
  },
  logs: [],
  isUploading: false,
  uploadSecondsLeft: 0,
  localAuthList: [],
  localAuthListVersion: 0,
  connectedAt: null,
  offlineMode: false,
  offlineQueue: [],
  // ── OCPP 2.x runtime defaults ──
  deviceModel: [
    // ── ChargingStation (Identity) ──
    {
      component: "ChargingStation",
      variable: "Model",
      value: "Virtual-Emulator-1",
      mutability: "ReadOnly",
    },
    {
      component: "ChargingStation",
      variable: "VendorName",
      value: "Elmo",
      mutability: "ReadOnly",
    },
    {
      component: "ChargingStation",
      variable: "FirmwareVersion",
      value: "1.0.0",
      mutability: "ReadOnly",
    },
    {
      component: "ChargingStation",
      variable: "SerialNumber",
      value: "elm.001.00",
      mutability: "ReadOnly",
    },
    {
      component: "ChargingStation",
      variable: "ChargeBoxSerialNumber",
      value: "elm.001.00.01",
      mutability: "ReadOnly",
    },

    // ── OCPPCommCtrlr (Networking) ──
    {
      component: "OCPPCommCtrlr",
      variable: "HeartbeatInterval",
      value: "300",
      mutability: "ReadWrite",
    },
    {
      component: "OCPPCommCtrlr",
      variable: "MessageTimeout",
      value: "60",
      mutability: "ReadWrite",
    },
    {
      component: "OCPPCommCtrlr",
      variable: "RetryBackOffRepeatTimes",
      value: "3",
      mutability: "ReadWrite",
    },
    {
      component: "OCPPCommCtrlr",
      variable: "WebSocketPingInterval",
      value: "600",
      mutability: "ReadWrite",
    },

    // ── AuthCtrlr (Authorization) ──
    {
      component: "AuthCtrlr",
      variable: "AuthorizeRemoteStart",
      value: "false",
      mutability: "ReadWrite",
    },
    {
      component: "AuthCtrlr",
      variable: "LocalAuthorizeOffline",
      value: "false",
      mutability: "ReadWrite",
    },
    {
      component: "AuthCtrlr",
      variable: "LocalPreAuthorize",
      value: "false",
      mutability: "ReadWrite",
    },

    // ── TxCtrlr (Transactions) ──
    {
      component: "TxCtrlr",
      variable: "EVConnectionTimeOut",
      value: "60",
      mutability: "ReadWrite",
    },
    {
      component: "TxCtrlr",
      variable: "StopTxOnEVSideDisconnect",
      value: "true",
      mutability: "ReadWrite",
    },
    {
      component: "TxCtrlr",
      variable: "StopTxOnInvalidId",
      value: "true",
      mutability: "ReadWrite",
    },

    // ── SampledDataCtrlr (Telemetry) ──
    {
      component: "SampledDataCtrlr",
      variable: "TxUpdatedInterval",
      value: "60",
      mutability: "ReadWrite",
    },
    {
      component: "SampledDataCtrlr",
      variable: "TxEndedInterval",
      value: "60",
      mutability: "ReadWrite",
    },

    // ── SecurityCtrlr (Basic Auth & TLS) ──
    {
      component: "SecurityCtrlr",
      variable: "BasicAuthPassword",
      value: "",
      mutability: "ReadWrite",
    },

    // ── Miscellaneous ──
    {
      component: "ClockAlignedDataInterval", // Legacy mapped
      variable: "Interval",
      value: "0",
      mutability: "ReadWrite",
    },
    {
      component: "AllowedChargingRateUnit",
      variable: "Actual",
      value: "W",
      mutability: "ReadOnly",
    },
  ],
  evse: [
    {
      evseId: 1,
      status: "Available",
      connectors: [{ connectorId: 1, type: "cType2" }],
    },
    {
      evseId: 2,
      status: "Available",
      connectors: [{ connectorId: 1, type: "cType2" }],
    },
  ],
  transactionSeq: 0,
});

export const makeDefaultSlot = (index: number): ChargerSlot => {
  const cfg = makeDefaultConfig(index);
  return {
    id: nanoid(8),
    label: `Charger ${index}`,
    config: cfg,
    savedProfiles: [],
    runtime: makeDefaultRuntime(cfg.rfidTag),
  };
};

// ─── Store ────────────────────────────────────────────────────────────────────

const updateSlot = (
  chargers: ChargerSlot[],
  id: string,
  updater: (slot: ChargerSlot) => ChargerSlot,
): ChargerSlot[] => chargers.map((c) => (c.id === id ? updater(c) : c));

const updateRuntime = (
  chargers: ChargerSlot[],
  id: string,
  updater: (r: ChargerRuntimeState) => ChargerRuntimeState,
): ChargerSlot[] =>
  updateSlot(chargers, id, (slot) => ({
    ...slot,
    runtime: updater(slot.runtime),
  }));

export const useEmulatorStore = create<EmulatorStore>()(
  persist(
    (set, get) => ({
      chargers: [makeDefaultSlot(1)],
      activeChargerId: "",

      getSlot: (id) => get().chargers.find((c) => c.id === id),

      // ── Tab management ──────────────────────────────────────────────────────

      addCharger: () =>
        set((s) => {
          const next = makeDefaultSlot(s.chargers.length + 1);
          return { chargers: [...s.chargers, next], activeChargerId: next.id };
        }),

      removeCharger: (id) =>
        set((s) => {
          if (s.chargers.length <= 1) return s;
          const filtered = s.chargers.filter((c) => c.id !== id);
          const activeId =
            s.activeChargerId === id
              ? (filtered[filtered.length - 1]?.id ?? "")
              : s.activeChargerId;
          return { chargers: filtered, activeChargerId: activeId };
        }),

      duplicateCharger: (id) =>
        set((s) => {
          const src = s.chargers.find((c) => c.id === id);
          if (!src) return s;
          const dup: ChargerSlot = {
            ...JSON.parse(JSON.stringify(src)),
            id: nanoid(8),
            label: `${src.label} (copy)`,
            runtime: makeDefaultRuntime(src.config.rfidTag),
          };
          return {
            chargers: [...s.chargers, dup],
            activeChargerId: dup.id,
          };
        }),

      setActiveCharger: (id) => set({ activeChargerId: id }),

      reorderChargers: (fromIndex, toIndex) =>
        set((s) => {
          const arr = [...s.chargers];
          const [moved] = arr.splice(fromIndex, 1);
          arr.splice(toIndex, 0, moved);
          return { chargers: arr };
        }),

      updateChargerLabel: (id, label) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({ ...slot, label })),
        })),

      // ── Config ──────────────────────────────────────────────────────────────

      updateConfig: (id, cfg) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({
            ...slot,
            config: { ...slot.config, ...cfg },
          })),
        })),

      updateBootNotification: (id, fields) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({
            ...slot,
            config: {
              ...slot.config,
              bootNotification: {
                ...slot.config.bootNotification,
                ...fields,
              },
            },
          })),
        })),

      updateStationConfigKey: (id, key, value) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({
            ...slot,
            config: {
              ...slot.config,
              stationConfig: slot.config.stationConfig.map((k) =>
                k.key === key ? { ...k, value } : k,
              ),
            },
          })),
        })),

      updateSimulation: (id, fields) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({
            ...slot,
            config: {
              ...slot.config,
              simulation: { ...slot.config.simulation, ...fields },
            },
          })),
        })),

      updateVendorConfig: (id, fields) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({
            ...slot,
            config: {
              ...slot.config,
              vendorConfig: { ...slot.config.vendorConfig, ...fields },
            },
          })),
        })),

      // ── Runtime ─────────────────────────────────────────────────────────────

      setStatus: (id, status) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({ ...r, status })),
        })),

      updateConnector: (id, connId, data) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            connectors: {
              ...r.connectors,
              [connId]: { ...r.connectors[connId], ...data },
            },
          })),
        })),

      resetConnector: (id, connId) =>
        set((s) => {
          const slot = s.chargers.find((c) => c.id === id);
          if (!slot) return s;
          return {
            chargers: updateRuntime(s.chargers, id, (r) => ({
              ...r,
              connectors: {
                ...r.connectors,
                [connId]: makeDefaultConnector(connId, slot.config.rfidTag),
              },
            })),
          };
        }),

      addLog: (id, log) =>
        set((s) => {
          const typeId =
            log.direction === "Tx" ? 2 : log.direction === "Rx" ? 3 : 0;
          const rawMessage =
            log.rawMessage ??
            JSON.stringify(
              typeId > 0 && log.ocppMessageId
                ? [typeId, log.ocppMessageId, log.action, log.payload ?? {}]
                : typeId > 0
                  ? [typeId, log.action, log.payload ?? {}]
                  : [log.action, log.payload ?? {}],
            );
          const entry: OCPPLog = {
            ...log,
            id: nanoid(),
            timestamp: new Date().toISOString(),
            rawMessage,
          };
          return {
            chargers: updateRuntime(s.chargers, id, (r) => ({
              ...r,
              logs: [entry, ...r.logs].slice(0, 500),
            })),
          };
        }),

      clearLogs: (id) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({ ...r, logs: [] })),
        })),

      setIsUploading: (id, val) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            isUploading: val,
          })),
        })),

      setUploadSecondsLeft: (id, val) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            uploadSecondsLeft: val,
          })),
        })),

      setLocalAuthList: (id, list, version) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            localAuthList: list,
            localAuthListVersion: version,
          })),
        })),

      setConnectedAt: (id, ts) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            connectedAt: ts,
          })),
        })),

      // ── Offline queueing ────────────────────────────────────────────────────

      toggleOfflineMode: (id) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            offlineMode: !r.offlineMode,
          })),
        })),

      addToOfflineQueue: (id, entry) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            offlineQueue: [...r.offlineQueue, entry],
          })),
        })),

      clearOfflineQueue: (id) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            offlineQueue: [],
          })),
        })),

      // ── Profiles ────────────────────────────────────────────────────────────

      saveProfile: (id, name) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({
            ...slot,
            savedProfiles: [
              ...slot.savedProfiles.filter((p) => p.name !== name),
              {
                name,
                config: JSON.parse(JSON.stringify(slot.config)),
                createdAt: new Date().toISOString(),
              },
            ],
          })),
        })),

      loadProfile: (id, name) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => {
            const profile = slot.savedProfiles.find((p) => p.name === name);
            if (!profile) return slot;
            return {
              ...slot,
              config: JSON.parse(JSON.stringify(profile.config)),
            };
          }),
        })),

      deleteProfile: (id, name) =>
        set((s) => ({
          chargers: updateSlot(s.chargers, id, (slot) => ({
            ...slot,
            savedProfiles: slot.savedProfiles.filter((p) => p.name !== name),
          })),
        })),

      // ── OCPP 2.x runtime actions ──────────────────────────────────────────

      updateEVSE: (id, evseId, data) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => ({
            ...r,
            evse: r.evse.map((e) =>
              e.evseId === evseId ? { ...e, ...data } : e,
            ),
          })),
        })),

      setDeviceVariable: (id, component, variable, value) =>
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => {
            const exists = r.deviceModel.some(
              (v) => v.component === component && v.variable === variable,
            );
            return {
              ...r,
              deviceModel: exists
                ? r.deviceModel.map((v) =>
                    v.component === component && v.variable === variable
                      ? { ...v, value }
                      : v,
                  )
                : [
                    ...r.deviceModel,
                    { component, variable, value, mutability: "ReadWrite" },
                  ],
            };
          }),
        })),

      bumpTransactionSeq: (id) => {
        let seq = 0;
        set((s) => ({
          chargers: updateRuntime(s.chargers, id, (r) => {
            seq = r.transactionSeq + 1;
            return { ...r, transactionSeq: seq };
          }),
        }));
        return seq;
      },
    }),
    {
      name: "ocpp-emulator-storage",
      version: 3,
      // Only persist config + profiles per charger slot — NOT runtime state (logs/connectors)
      partialize: (s) => ({
        chargers: s.chargers.map((c) => ({
          id: c.id,
          label: c.label,
          config: c.config,
          savedProfiles: c.savedProfiles,
        })),
        activeChargerId: s.activeChargerId,
      }),
      // Restore runtime state with defaults when loading from storage
      merge: (persisted: any, currentState: EmulatorStore) => {
        if (!persisted) return currentState;

        // v1/v2 migration: had flat config, not chargers[]
        if (!Array.isArray(persisted.chargers)) {
          const legacyConfig = persisted.config;
          const slot = makeDefaultSlot(1);
          if (legacyConfig) {
            slot.config = {
              ...makeDefaultConfig(1),
              ...legacyConfig,
              // Downgrade unsupported security profiles
              securityProfile:
                legacyConfig.securityProfile > 1
                  ? 0
                  : (legacyConfig.securityProfile ?? 0),
              bootNotification: {
                ...DEFAULT_BOOT_NOTIFICATION,
                ...(legacyConfig.bootNotification ?? {}),
              },
              stationConfig:
                Array.isArray(legacyConfig.stationConfig) &&
                legacyConfig.stationConfig.length > 0
                  ? legacyConfig.stationConfig
                  : DEFAULT_STATION_CONFIG,
              simulation: {
                ...DEFAULT_SIMULATION,
                ...(legacyConfig.simulation ?? {}),
                measurands: {
                  ...DEFAULT_MEASURANDS,
                  ...(legacyConfig.simulation?.measurands ?? {}),
                },
              },
              vendorConfig: {
                vendorId: "VirtualVendor",
                vendorErrorCode: "",
                customDataStr: "{}",
                ...(legacyConfig.vendorConfig ?? {}),
              },
            };
            slot.savedProfiles = Array.isArray(persisted.savedProfiles)
              ? persisted.savedProfiles
              : [];
          }
          return {
            ...currentState,
            chargers: [
              { ...slot, runtime: makeDefaultRuntime(slot.config.rfidTag) },
            ],
            activeChargerId: slot.id,
          };
        }

        // v3 restore
        const restoredChargers: ChargerSlot[] = persisted.chargers.map(
          (c: Partial<ChargerSlot>) => {
            const cfg = makeDefaultConfig(1);
            const mergedConfig: EmulatorConfig = {
              ...cfg,
              ...(c.config ?? {}),
              securityProfile:
                (c.config?.securityProfile ?? 0) > 1
                  ? 0
                  : (c.config?.securityProfile ?? 0),
              bootNotification: {
                ...DEFAULT_BOOT_NOTIFICATION,
                ...(c.config?.bootNotification ?? {}),
              },
              stationConfig:
                Array.isArray(c.config?.stationConfig) &&
                c.config?.stationConfig.length > 0
                  ? c.config?.stationConfig
                  : DEFAULT_STATION_CONFIG,
              simulation: {
                ...DEFAULT_SIMULATION,
                ...(c.config?.simulation ?? {}),
                measurands: {
                  ...DEFAULT_MEASURANDS,
                  ...(c.config?.simulation?.measurands ?? {}),
                },
              },
              vendorConfig: {
                vendorId: "VirtualVendor",
                vendorErrorCode: "",
                customDataStr: "{}",
                ...(c.config?.vendorConfig ?? {}),
              },
            };
            return {
              id: c.id ?? nanoid(8),
              label: c.label ?? "Charger",
              config: mergedConfig,
              savedProfiles: Array.isArray(c.savedProfiles)
                ? c.savedProfiles
                : [],
              runtime: makeDefaultRuntime(mergedConfig.rfidTag),
            };
          },
        );

        const validChargers =
          restoredChargers.length > 0 ? restoredChargers : [makeDefaultSlot(1)];
        const activeId =
          persisted.activeChargerId &&
          validChargers.some((c) => c.id === persisted.activeChargerId)
            ? persisted.activeChargerId
            : validChargers[0].id;

        return {
          ...currentState,
          chargers: validChargers,
          activeChargerId: activeId,
        };
      },
    },
  ),
);

// ─── Init active charger after hydration ─────────────────────────────────────
// Called once on app boot to set activeChargerId if empty (first load)
export function initActiveCharger() {
  const s = useEmulatorStore.getState();
  if (!s.activeChargerId && s.chargers.length > 0) {
    useEmulatorStore.setState({ activeChargerId: s.chargers[0].id });
  }
}
