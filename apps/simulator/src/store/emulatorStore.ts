import { nanoid } from "nanoid";
import { create } from "zustand";
import { persist } from "zustand/middleware";

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
}

export interface EmulatorConfig {
  // Connection
  endpoint: string;
  chargePointId: string;
  ocppVersion: "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1";
  securityProfile: 0 | 1 | 2 | 3;
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
}

export interface ConfigProfile {
  name: string;
  config: EmulatorConfig;
  createdAt: string;
}

export interface EmulatorState {
  config: EmulatorConfig;
  updateConfig: (newConfig: Partial<EmulatorConfig>) => void;
  updateBootNotification: (fields: Partial<BootNotificationConfig>) => void;
  updateStationConfigKey: (key: string, value: string) => void;
  updateSimulation: (fields: Partial<SimulationConfig>) => void;

  status: ConnectionStatus;
  setStatus: (status: ConnectionStatus) => void;

  connectors: Record<number, ConnectorState>;
  updateConnector: (id: number, data: Partial<ConnectorState>) => void;
  resetConnector: (id: number) => void;

  logs: OCPPLog[];
  addLog: (log: Omit<OCPPLog, "id" | "timestamp">) => void;
  clearLogs: () => void;

  // Diagnostics upload simulation
  isUploading: boolean;
  uploadSecondsLeft: number;
  setIsUploading: (val: boolean) => void;
  setUploadSecondsLeft: (val: number) => void;

  // Local auth list
  localAuthList: LocalAuthEntry[];
  localAuthListVersion: number;
  setLocalAuthList: (list: LocalAuthEntry[], version: number) => void;

  // Connection uptime
  connectedAt: number | null;
  setConnectedAt: (ts: number | null) => void;

  // Config profiles
  savedProfiles: ConfigProfile[];
  saveProfile: (name: string) => void;
  loadProfile: (name: string) => void;
  deleteProfile: (name: string) => void;
}

const DEFAULT_BOOT_NOTIFICATION: BootNotificationConfig = {
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

const DEFAULT_STATION_CONFIG: StationConfigKey[] = [
  { key: "AuthorizeRemoteTxRequests", readonly: true, value: "false" },
  { key: "ClockAlignedDataInterval", readonly: true, value: "0" },
  { key: "ConnectionTimeOut", readonly: false, value: "60" },
  { key: "GetConfigurationMaxKeys", readonly: true, value: "0" },
  { key: "HeartbeatInterval", readonly: false, value: "300" },
  { key: "LocalAuthorizeOffline", readonly: true, value: "false" },
  { key: "LocalPreAuthorize", readonly: true, value: "false" },
  { key: "MeterValuesAlignedData", readonly: true, value: "0" },
  {
    key: "MeterValuesSampledData",
    readonly: true,
    value: "Energy.Active.Import.Register,Power.Active.Import",
  },
  { key: "MeterValueSampleInterval", readonly: false, value: "60" },
  { key: "NumberOfConnectors", readonly: true, value: "1" },
  { key: "ConnectorPhaseRotation", readonly: true, value: "Unknown" },
  {
    key: "SupportedFeatureProfiles",
    readonly: true,
    value: "Core,Reservation,SmartCharging,RemoteTrigger",
  },
  { key: "ResetRetries", readonly: false, value: "3" },
  { key: "TransactionMessageAttempts", readonly: false, value: "3" },
  { key: "TransactionMessageRetryInterval", readonly: false, value: "60" },
  { key: "StopTransactionOnEVSideDisconnect", readonly: true, value: "true" },
  { key: "StopTransactionOnInvalidId", readonly: true, value: "true" },
  { key: "StopTxnAlignedData", readonly: true, value: " " },
  { key: "StopTxnSampledData", readonly: true, value: " " },
  { key: "UnlockConnectorOnEVSideDisconnect", readonly: true, value: "true" },
  { key: "ChargeProfileMaxStackLevel", readonly: true, value: "1" },
  {
    key: "ChargingScheduleAllowedChargingRateUnit",
    readonly: true,
    value: "Current",
  },
  { key: "ChargingScheduleMaxPeriods", readonly: true, value: "1" },
  { key: "MaxChargingProfilesInstalled", readonly: true, value: "1" },
  { key: "WebSocketPingInterval", readonly: false, value: "600" },
];

const makeDefaultConnector = (id: number, rfidTag: string): ConnectorState => ({
  connectorId: id,
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

const DEFAULT_CONFIG: EmulatorConfig = {
  endpoint: "ws://localhost:9000",
  chargePointId: "CP-001",
  ocppVersion: "ocpp1.6",
  securityProfile: 0,
  basicAuthPassword: "",
  bootNotification: DEFAULT_BOOT_NOTIFICATION,
  stationConfig: DEFAULT_STATION_CONFIG,
  simulation: {
    diagnosticFileName: "diagnostics.csv",
    diagnosticUploadTime: 30,
    diagnosticStatus: "Uploaded",
    firmwareStatus: "Downloaded",
    autoChargeTargetKWh: 30,
    autoChargeDurationSec: 120,
    autoChargeMeterIncrement: 250,
    autoChargeSocEnabled: true,
  },
  rfidTag: "DEADBEEF",
  numberOfConnectors: 1,
};

export const useEmulatorStore = create<EmulatorState>()(
  persist(
    (set, _get) => ({
      config: DEFAULT_CONFIG,
      updateConfig: (newConfig) =>
        set((s) => ({ config: { ...s.config, ...newConfig } })),
      updateBootNotification: (fields) =>
        set((s) => ({
          config: {
            ...s.config,
            bootNotification: { ...s.config.bootNotification, ...fields },
          },
        })),
      updateStationConfigKey: (key, value) =>
        set((s) => ({
          config: {
            ...s.config,
            stationConfig: s.config.stationConfig.map((k: StationConfigKey) =>
              k.key === key ? { ...k, value } : k,
            ),
          },
        })),
      updateSimulation: (fields) =>
        set((s) => ({
          config: {
            ...s.config,
            simulation: { ...s.config.simulation, ...fields },
          },
        })),

      status: "disconnected",
      setStatus: (status) => set({ status }),

      connectors: {
        1: makeDefaultConnector(1, DEFAULT_CONFIG.rfidTag),
        2: makeDefaultConnector(2, DEFAULT_CONFIG.rfidTag),
      },
      updateConnector: (id, data) =>
        set((s) => ({
          connectors: {
            ...s.connectors,
            [id]: { ...s.connectors[id], ...data },
          },
        })),
      resetConnector: (id) =>
        set((s) => ({
          connectors: {
            ...s.connectors,
            [id]: makeDefaultConnector(id, s.config.rfidTag),
          },
        })),

      logs: [],
      addLog: (log) =>
        set((s) => {
          // Build OCPP-style raw message from real protocol data
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
          return {
            logs: [
              {
                ...log,
                id: nanoid(),
                timestamp: new Date().toISOString(),
                rawMessage,
              },
              ...s.logs,
            ].slice(0, 500),
          };
        }),
      clearLogs: () => set({ logs: [] }),

      isUploading: false,
      uploadSecondsLeft: 0,
      setIsUploading: (val) => set({ isUploading: val }),
      setUploadSecondsLeft: (val) => set({ uploadSecondsLeft: val }),

      localAuthList: [],
      localAuthListVersion: 0,
      setLocalAuthList: (list, version) =>
        set({ localAuthList: list, localAuthListVersion: version }),

      connectedAt: null,
      setConnectedAt: (ts) => set({ connectedAt: ts }),

      savedProfiles: [],
      saveProfile: (name) =>
        set((s) => ({
          savedProfiles: [
            ...s.savedProfiles.filter((p: ConfigProfile) => p.name !== name),
            {
              name,
              config: JSON.parse(JSON.stringify(s.config)),
              createdAt: new Date().toISOString(),
            },
          ],
        })),
      loadProfile: (name) =>
        set((s) => {
          const profile = s.savedProfiles.find(
            (p: ConfigProfile) => p.name === name,
          );
          if (!profile) return s;
          return { config: JSON.parse(JSON.stringify(profile.config)) };
        }),
      deleteProfile: (name) =>
        set((s) => ({
          savedProfiles: s.savedProfiles.filter(
            (p: ConfigProfile) => p.name !== name,
          ),
        })),
    }),
    {
      name: "ocpp-emulator-storage",
      version: 2,
      // Only persist config, not runtime state
      partialize: (s) => ({ config: s.config, savedProfiles: s.savedProfiles }),
      // Deep-merge persisted config with defaults so new fields never crash
      merge: (persisted: any, currentState: EmulatorState) => {
        if (!persisted || !persisted.config) return currentState;
        const pc = persisted.config;
        return {
          ...currentState,
          savedProfiles: Array.isArray(persisted.savedProfiles)
            ? persisted.savedProfiles
            : [],
          config: {
            ...DEFAULT_CONFIG,
            ...pc,
            bootNotification: {
              ...DEFAULT_BOOT_NOTIFICATION,
              ...(pc.bootNotification ?? {}),
            },
            stationConfig:
              Array.isArray(pc.stationConfig) && pc.stationConfig.length > 0
                ? pc.stationConfig
                : DEFAULT_STATION_CONFIG,
            simulation: {
              ...DEFAULT_CONFIG.simulation,
              ...(pc.simulation ?? {}),
            },
          },
        };
      },
    },
  ),
);
