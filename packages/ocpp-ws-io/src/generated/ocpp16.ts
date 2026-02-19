// Auto-generated from ocpp1_6.json — DO NOT EDIT
/* eslint-disable */

// ═══ Shared Types ═══

export type CertificateSignedStatusEnumType = "Accepted" | "Rejected";

export type HashAlgorithmEnumType = "SHA256" | "SHA384" | "SHA512";

export interface CertificateHashDataType {
  hashAlgorithm: HashAlgorithmEnumType;
  issuerNameHash: string;
  issuerKeyHash: string;
  serialNumber: string;
}

export type DeleteCertificateStatusEnumType = "Accepted" | "Failed" | "NotFound";

export type MessageTriggerEnumType = "BootNotification" | "LogStatusNotification" | "FirmwareStatusNotification" | "Heartbeat" | "MeterValues" | "SignChargePointCertificate" | "StatusNotification";

export type TriggerMessageStatusEnumType = "Accepted" | "Rejected" | "NotImplemented";

export type CertificateUseEnumType = "CentralSystemRootCertificate" | "ManufacturerRootCertificate";

export type GetInstalledCertificateStatusEnumType = "Accepted" | "NotFound";

export type LogEnumType = "DiagnosticsLog" | "SecurityLog";

export interface LogParametersType {
  remoteLocation: string;
  oldestTimestamp?: string;
  latestTimestamp?: string;
}

export type LogStatusEnumType = "Accepted" | "Rejected" | "AcceptedCanceled";

export type InstallCertificateStatusEnumType = "Accepted" | "Failed" | "Rejected";

export type UploadLogStatusEnumType = "BadMessage" | "Idle" | "NotSupportedOperation" | "PermissionDenied" | "Uploaded" | "UploadFailure" | "Uploading";

export type GenericStatusEnumType = "Accepted" | "Rejected";

export type FirmwareStatusEnumType = "Downloaded" | "DownloadFailed" | "Downloading" | "DownloadScheduled" | "DownloadPaused" | "Idle" | "InstallationFailed" | "Installing" | "Installed" | "InstallRebooting" | "InstallScheduled" | "InstallVerificationFailed" | "InvalidSignature" | "SignatureVerified";

export interface FirmwareType {
  location: string;
  retrieveDateTime: string;
  installDateTime?: string;
  signingCertificate: string;
  signature: string;
}

export type UpdateFirmwareStatusEnumType = "Accepted" | "Rejected" | "AcceptedCanceled" | "InvalidCertificate" | "RevokedCertificate";

// ═══ Method Types ═══

export interface AuthorizeRequest {
  idTag: string;
}

export interface AuthorizeResponse {
  idTagInfo: { expiryDate?: string; parentIdTag?: string; status: "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx" };
}

export interface BootNotificationRequest {
  chargePointVendor: string;
  chargePointModel: string;
  chargePointSerialNumber?: string;
  chargeBoxSerialNumber?: string;
  firmwareVersion?: string;
  iccid?: string;
  imsi?: string;
  meterType?: string;
  meterSerialNumber?: string;
}

export interface BootNotificationResponse {
  status: "Accepted" | "Pending" | "Rejected";
  currentTime: string;
  interval: number;
}

export interface CancelReservationRequest {
  reservationId: number;
}

export interface CancelReservationResponse {
  status: "Accepted" | "Rejected";
}

export interface CertificateSignedRequest {
  certificateChain: string;
}

export interface CertificateSignedResponse {
  status: CertificateSignedStatusEnumType;
}

export interface ChangeAvailabilityRequest {
  connectorId: number;
  type: "Inoperative" | "Operative";
}

export interface ChangeAvailabilityResponse {
  status: "Accepted" | "Rejected" | "Scheduled";
}

export interface ChangeConfigurationRequest {
  key: string;
  value: string;
}

export interface ChangeConfigurationResponse {
  status: "Accepted" | "Rejected" | "RebootRequired" | "NotSupported";
}

export interface ClearCacheRequest {
}

export interface ClearCacheResponse {
  status: "Accepted" | "Rejected";
}

export interface ClearChargingProfileRequest {
  id?: number;
  connectorId?: number;
  chargingProfilePurpose?: "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile";
  stackLevel?: number;
}

export interface ClearChargingProfileResponse {
  status: "Accepted" | "Unknown";
}

export interface DataTransferRequest {
  vendorId: string;
  messageId?: string;
  data?: string;
}

export interface DataTransferResponse {
  status: "Accepted" | "Rejected" | "UnknownMessageId" | "UnknownVendorId";
  data?: string;
}

export interface DeleteCertificateRequest {
  certificateHashData: CertificateHashDataType;
}

export interface DeleteCertificateResponse {
  status: DeleteCertificateStatusEnumType;
}

export interface DiagnosticsStatusNotificationRequest {
  status: "Idle" | "Uploaded" | "UploadFailed" | "Uploading";
}

export interface DiagnosticsStatusNotificationResponse {
}

export interface ExtendedTriggerMessageRequest {
  requestedMessage: MessageTriggerEnumType;
  connectorId?: number;
}

export interface ExtendedTriggerMessageResponse {
  status: TriggerMessageStatusEnumType;
}

export interface FirmwareStatusNotificationRequest {
  status: "Downloaded" | "DownloadFailed" | "Downloading" | "Idle" | "InstallationFailed" | "Installing" | "Installed";
}

export interface FirmwareStatusNotificationResponse {
}

export interface GetCompositeScheduleRequest {
  connectorId: number;
  duration: number;
  chargingRateUnit?: "A" | "W";
}

export interface GetCompositeScheduleResponse {
  status: "Accepted" | "Rejected";
  connectorId?: number;
  scheduleStart?: string;
  chargingSchedule?: { duration?: number; startSchedule?: string; chargingRateUnit: "A" | "W"; chargingSchedulePeriod: ({ startPeriod: number; limit: number; numberPhases?: number })[]; minChargingRate?: number };
}

export interface GetConfigurationRequest {
  key?: string[];
}

export interface GetConfigurationResponse {
  configurationKey?: ({ key: string; readonly: boolean; value?: string })[];
  unknownKey?: string[];
}

export interface GetDiagnosticsRequest {
  location: string;
  retries?: number;
  retryInterval?: number;
  startTime?: string;
  stopTime?: string;
}

export interface GetDiagnosticsResponse {
  fileName?: string;
}

export interface GetInstalledCertificateIdsRequest {
  certificateType: CertificateUseEnumType;
}

export interface GetInstalledCertificateIdsResponse {
  certificateHashData?: CertificateHashDataType[];
  status: GetInstalledCertificateStatusEnumType;
}

export interface GetLocalListVersionRequest {
}

export interface GetLocalListVersionResponse {
  listVersion: number;
}

export interface GetLogRequest {
  log: LogParametersType;
  logType: LogEnumType;
  requestId: number;
  retries?: number;
  retryInterval?: number;
}

export interface GetLogResponse {
  status: LogStatusEnumType;
  filename?: string;
}

export interface HeartbeatRequest {
}

export interface HeartbeatResponse {
  currentTime: string;
}

export interface InstallCertificateRequest {
  certificateType: CertificateUseEnumType;
  certificate: string;
}

export interface InstallCertificateResponse {
  status: InstallCertificateStatusEnumType;
}

export interface LogStatusNotificationRequest {
  status: UploadLogStatusEnumType;
  requestId?: number;
}

export interface LogStatusNotificationResponse {
}

export interface MeterValuesRequest {
  connectorId: number;
  transactionId?: number;
  meterValue: ({ timestamp: string; sampledValue: ({ value: string; context?: "Interruption.Begin" | "Interruption.End" | "Sample.Clock" | "Sample.Periodic" | "Transaction.Begin" | "Transaction.End" | "Trigger" | "Other"; format?: "Raw" | "SignedData"; measurand?: "Energy.Active.Export.Register" | "Energy.Active.Import.Register" | "Energy.Reactive.Export.Register" | "Energy.Reactive.Import.Register" | "Energy.Active.Export.Interval" | "Energy.Active.Import.Interval" | "Energy.Reactive.Export.Interval" | "Energy.Reactive.Import.Interval" | "Power.Active.Export" | "Power.Active.Import" | "Power.Offered" | "Power.Reactive.Export" | "Power.Reactive.Import" | "Power.Factor" | "Current.Import" | "Current.Export" | "Current.Offered" | "Voltage" | "Frequency" | "Temperature" | "SoC" | "RPM"; phase?: "L1" | "L2" | "L3" | "N" | "L1-N" | "L2-N" | "L3-N" | "L1-L2" | "L2-L3" | "L3-L1"; location?: "Cable" | "EV" | "Inlet" | "Outlet" | "Body"; unit?: "Wh" | "kWh" | "varh" | "kvarh" | "W" | "kW" | "VA" | "kVA" | "var" | "kvar" | "A" | "V" | "K" | "Celcius" | "Celsius" | "Fahrenheit" | "Percent" })[] })[];
}

export interface MeterValuesResponse {
}

export interface RemoteStartTransactionRequest {
  connectorId?: number;
  idTag: string;
  chargingProfile?: { chargingProfileId: number; transactionId?: number; stackLevel: number; chargingProfilePurpose: "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile"; chargingProfileKind: "Absolute" | "Recurring" | "Relative"; recurrencyKind?: "Daily" | "Weekly"; validFrom?: string; validTo?: string; chargingSchedule: { duration?: number; startSchedule?: string; chargingRateUnit: "A" | "W"; chargingSchedulePeriod: ({ startPeriod: number; limit: number; numberPhases?: number })[]; minChargingRate?: number } };
}

export interface RemoteStartTransactionResponse {
  status: "Accepted" | "Rejected";
}

export interface RemoteStopTransactionRequest {
  transactionId: number;
}

export interface RemoteStopTransactionResponse {
  status: "Accepted" | "Rejected";
}

export interface ReserveNowRequest {
  connectorId: number;
  expiryDate: string;
  idTag: string;
  parentIdTag?: string;
  reservationId: number;
}

export interface ReserveNowResponse {
  status: "Accepted" | "Faulted" | "Occupied" | "Rejected" | "Unavailable";
}

export interface ResetRequest {
  type: "Hard" | "Soft";
}

export interface ResetResponse {
  status: "Accepted" | "Rejected";
}

export interface SecurityEventNotificationRequest {
  type: string;
  timestamp: string;
  techInfo?: string;
}

export interface SecurityEventNotificationResponse {
}

export interface SendLocalListRequest {
  listVersion: number;
  localAuthorizationList?: ({ idTag: string; idTagInfo?: { expiryDate?: string; parentIdTag?: string; status: "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx" } })[];
  updateType: "Differential" | "Full";
}

export interface SendLocalListResponse {
  status: "Accepted" | "Failed" | "NotSupported" | "VersionMismatch";
}

export interface SetChargingProfileRequest {
  connectorId: number;
  csChargingProfiles: { chargingProfileId: number; transactionId?: number; stackLevel: number; chargingProfilePurpose: "ChargePointMaxProfile" | "TxDefaultProfile" | "TxProfile"; chargingProfileKind: "Absolute" | "Recurring" | "Relative"; recurrencyKind?: "Daily" | "Weekly"; validFrom?: string; validTo?: string; chargingSchedule: { duration?: number; startSchedule?: string; chargingRateUnit: "A" | "W"; chargingSchedulePeriod: ({ startPeriod: number; limit: number; numberPhases?: number })[]; minChargingRate?: number } };
}

export interface SetChargingProfileResponse {
  status: "Accepted" | "Rejected" | "NotSupported";
}

export interface SignCertificateRequest {
  csr: string;
}

export interface SignCertificateResponse {
  status: GenericStatusEnumType;
}

export interface SignedFirmwareStatusNotificationRequest {
  status: FirmwareStatusEnumType;
  requestId?: number;
}

export interface SignedFirmwareStatusNotificationResponse {
}

export interface SignedUpdateFirmwareRequest {
  retries?: number;
  retryInterval?: number;
  requestId: number;
  firmware: FirmwareType;
}

export interface SignedUpdateFirmwareResponse {
  status: UpdateFirmwareStatusEnumType;
}

export interface StartTransactionRequest {
  connectorId: number;
  idTag: string;
  meterStart: number;
  reservationId?: number;
  timestamp: string;
}

export interface StartTransactionResponse {
  idTagInfo: { expiryDate?: string; parentIdTag?: string; status: "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx" };
  transactionId: number;
}

export interface StatusNotificationRequest {
  connectorId: number;
  errorCode: "ConnectorLockFailure" | "EVCommunicationError" | "GroundFailure" | "HighTemperature" | "InternalError" | "LocalListConflict" | "NoError" | "OtherError" | "OverCurrentFailure" | "PowerMeterFailure" | "PowerSwitchFailure" | "ReaderFailure" | "ResetFailure" | "UnderVoltage" | "OverVoltage" | "WeakSignal";
  info?: string;
  status: "Available" | "Preparing" | "Charging" | "SuspendedEVSE" | "SuspendedEV" | "Finishing" | "Reserved" | "Unavailable" | "Faulted";
  timestamp?: string;
  vendorId?: string;
  vendorErrorCode?: string;
}

export interface StatusNotificationResponse {
}

export interface StopTransactionRequest {
  idTag?: string;
  meterStop: number;
  timestamp: string;
  transactionId: number;
  reason?: "EmergencyStop" | "EVDisconnected" | "HardReset" | "Local" | "Other" | "PowerLoss" | "Reboot" | "Remote" | "SoftReset" | "UnlockCommand" | "DeAuthorized";
  transactionData?: ({ timestamp: string; sampledValue: ({ value: string; context?: "Interruption.Begin" | "Interruption.End" | "Sample.Clock" | "Sample.Periodic" | "Transaction.Begin" | "Transaction.End" | "Trigger" | "Other"; format?: "Raw" | "SignedData"; measurand?: "Energy.Active.Export.Register" | "Energy.Active.Import.Register" | "Energy.Reactive.Export.Register" | "Energy.Reactive.Import.Register" | "Energy.Active.Export.Interval" | "Energy.Active.Import.Interval" | "Energy.Reactive.Export.Interval" | "Energy.Reactive.Import.Interval" | "Power.Active.Export" | "Power.Active.Import" | "Power.Offered" | "Power.Reactive.Export" | "Power.Reactive.Import" | "Power.Factor" | "Current.Import" | "Current.Export" | "Current.Offered" | "Voltage" | "Frequency" | "Temperature" | "SoC" | "RPM"; phase?: "L1" | "L2" | "L3" | "N" | "L1-N" | "L2-N" | "L3-N" | "L1-L2" | "L2-L3" | "L3-L1"; location?: "Cable" | "EV" | "Inlet" | "Outlet" | "Body"; unit?: "Wh" | "kWh" | "varh" | "kvarh" | "W" | "kW" | "VA" | "kVA" | "var" | "kvar" | "A" | "V" | "K" | "Celcius" | "Celsius" | "Fahrenheit" | "Percent" })[] })[];
}

export interface StopTransactionResponse {
  idTagInfo?: { expiryDate?: string; parentIdTag?: string; status: "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx" };
}

export interface TriggerMessageRequest {
  requestedMessage: "BootNotification" | "DiagnosticsStatusNotification" | "FirmwareStatusNotification" | "Heartbeat" | "MeterValues" | "StatusNotification";
  connectorId?: number;
}

export interface TriggerMessageResponse {
  status: "Accepted" | "Rejected" | "NotImplemented";
}

export interface UnlockConnectorRequest {
  connectorId: number;
}

export interface UnlockConnectorResponse {
  status: "Unlocked" | "UnlockFailed" | "NotSupported";
}

export interface UpdateFirmwareRequest {
  location: string;
  retries?: number;
  retrieveDate: string;
  retryInterval?: number;
}

export interface UpdateFirmwareResponse {
}

// ═══ Method Map ═══

export interface OCPP16Methods {
  Authorize: { request: AuthorizeRequest; response: AuthorizeResponse };
  BootNotification: { request: BootNotificationRequest; response: BootNotificationResponse };
  CancelReservation: { request: CancelReservationRequest; response: CancelReservationResponse };
  CertificateSigned: { request: CertificateSignedRequest; response: CertificateSignedResponse };
  ChangeAvailability: { request: ChangeAvailabilityRequest; response: ChangeAvailabilityResponse };
  ChangeConfiguration: { request: ChangeConfigurationRequest; response: ChangeConfigurationResponse };
  ClearCache: { request: ClearCacheRequest; response: ClearCacheResponse };
  ClearChargingProfile: { request: ClearChargingProfileRequest; response: ClearChargingProfileResponse };
  DataTransfer: { request: DataTransferRequest; response: DataTransferResponse };
  DeleteCertificate: { request: DeleteCertificateRequest; response: DeleteCertificateResponse };
  DiagnosticsStatusNotification: { request: DiagnosticsStatusNotificationRequest; response: DiagnosticsStatusNotificationResponse };
  ExtendedTriggerMessage: { request: ExtendedTriggerMessageRequest; response: ExtendedTriggerMessageResponse };
  FirmwareStatusNotification: { request: FirmwareStatusNotificationRequest; response: FirmwareStatusNotificationResponse };
  GetCompositeSchedule: { request: GetCompositeScheduleRequest; response: GetCompositeScheduleResponse };
  GetConfiguration: { request: GetConfigurationRequest; response: GetConfigurationResponse };
  GetDiagnostics: { request: GetDiagnosticsRequest; response: GetDiagnosticsResponse };
  GetInstalledCertificateIds: { request: GetInstalledCertificateIdsRequest; response: GetInstalledCertificateIdsResponse };
  GetLocalListVersion: { request: GetLocalListVersionRequest; response: GetLocalListVersionResponse };
  GetLog: { request: GetLogRequest; response: GetLogResponse };
  Heartbeat: { request: HeartbeatRequest; response: HeartbeatResponse };
  InstallCertificate: { request: InstallCertificateRequest; response: InstallCertificateResponse };
  LogStatusNotification: { request: LogStatusNotificationRequest; response: LogStatusNotificationResponse };
  MeterValues: { request: MeterValuesRequest; response: MeterValuesResponse };
  RemoteStartTransaction: { request: RemoteStartTransactionRequest; response: RemoteStartTransactionResponse };
  RemoteStopTransaction: { request: RemoteStopTransactionRequest; response: RemoteStopTransactionResponse };
  ReserveNow: { request: ReserveNowRequest; response: ReserveNowResponse };
  Reset: { request: ResetRequest; response: ResetResponse };
  SecurityEventNotification: { request: SecurityEventNotificationRequest; response: SecurityEventNotificationResponse };
  SendLocalList: { request: SendLocalListRequest; response: SendLocalListResponse };
  SetChargingProfile: { request: SetChargingProfileRequest; response: SetChargingProfileResponse };
  SignCertificate: { request: SignCertificateRequest; response: SignCertificateResponse };
  SignedFirmwareStatusNotification: { request: SignedFirmwareStatusNotificationRequest; response: SignedFirmwareStatusNotificationResponse };
  SignedUpdateFirmware: { request: SignedUpdateFirmwareRequest; response: SignedUpdateFirmwareResponse };
  StartTransaction: { request: StartTransactionRequest; response: StartTransactionResponse };
  StatusNotification: { request: StatusNotificationRequest; response: StatusNotificationResponse };
  StopTransaction: { request: StopTransactionRequest; response: StopTransactionResponse };
  TriggerMessage: { request: TriggerMessageRequest; response: TriggerMessageResponse };
  UnlockConnector: { request: UnlockConnectorRequest; response: UnlockConnectorResponse };
  UpdateFirmware: { request: UpdateFirmwareRequest; response: UpdateFirmwareResponse };
}
