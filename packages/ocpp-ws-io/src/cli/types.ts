import type { AllMethodNames } from "../generated/index.js";
import type { OCPPRequestType, OCPPResponseType } from "../types/index.js";

/**
 * A value in a payload the CLI sends: JSON, or `undefined` for a field left
 * out, which `JSON.stringify` drops.
 */
export type OutgoingValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | OutgoingValue[]
  | { [key: string]: OutgoingValue };

/** A payload the CLI sends: a JSON object (OCPP-J §4.2). */
export type OutgoingPayload = { [key: string]: OutgoingValue };

/** A CALL frame as the CLI writes it: `[2, messageId, action, payload]`. */
export type CallFrame = [2, string, string, OutgoingPayload];

/** A connector status the simulator reports: OCPP 1.6's ChargePointStatus. */
export type ConnectorStatus = OCPPRequestType<
  "ocpp1.6",
  "StatusNotification"
>["status"];

/** A firmware status the simulator reports: 1.6's, all of which 2.x has. */
export type FirmwareStatus = OCPPRequestType<
  "ocpp1.6",
  "FirmwareStatusNotification"
>["status"];

/** A diagnostics upload status the simulator reports: 1.6's DiagnosticsStatus. */
export type DiagnosticsStatus = OCPPRequestType<
  "ocpp1.6",
  "DiagnosticsStatusNotification"
>["status"];

/** A log upload status as 2.0.1 and 2.1 report it in LogStatusNotification. */
export type UploadLogStatusV2 = OCPPRequestType<
  "ocpp2.0.1",
  "LogStatusNotification"
>["status"];

/** Why a 2.0.1 or 2.1 station booted, as its BootNotification says. */
export type BootReason = OCPPRequestType<
  "ocpp2.0.1",
  "BootNotification"
>["reason"];

/** A connector status as 2.0.1 and 2.1 report it, which has fewer states. */
export type ConnectorStatusV2 = OCPPRequestType<
  "ocpp2.0.1",
  "StatusNotification"
>["connectorStatus"];

/** One entry of a GetVariables or SetVariables request, as the simulator reads it. */
export interface VariableRequest {
  component?: OutgoingValue;
  variable?: { name?: string; [key: string]: OutgoingValue };
  /** The 1.6 name of a key, which the simulator also accepts. */
  key?: string;
  attributeValue?: string;
}

/** The protocols the simulator speaks. */
type SimulatorProtocol = "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1";

/**
 * A CSMS request for an action, in each version that defines the action, so
 * a field the versions name differently has to be read for each of them.
 */
type CsmsRequestFor<A extends string> = {
  [V in SimulatorProtocol]: A extends AllMethodNames<V>
    ? OCPPRequestType<V, A>
    : never;
}[SimulatorProtocol];

/** The CSMS requests the simulator answers, by action. */
export interface CsmsRequests {
  Reset: CsmsRequestFor<"Reset">;
  RemoteStartTransaction: CsmsRequestFor<"RemoteStartTransaction">;
  RemoteStopTransaction: CsmsRequestFor<"RemoteStopTransaction">;
  UnlockConnector: CsmsRequestFor<"UnlockConnector">;
  ChangeAvailability: CsmsRequestFor<"ChangeAvailability">;
  ClearCache: CsmsRequestFor<"ClearCache">;
  ChangeConfiguration: CsmsRequestFor<"ChangeConfiguration">;
  GetConfiguration: CsmsRequestFor<"GetConfiguration">;
  UpdateFirmware: CsmsRequestFor<"UpdateFirmware">;
  GetDiagnostics: CsmsRequestFor<"GetDiagnostics">;
  TriggerMessage: CsmsRequestFor<"TriggerMessage">;
  SetChargingProfile: CsmsRequestFor<"SetChargingProfile">;
  ClearChargingProfile: CsmsRequestFor<"ClearChargingProfile">;
  GetCompositeSchedule: CsmsRequestFor<"GetCompositeSchedule">;
  DataTransfer: CsmsRequestFor<"DataTransfer">;
  ReserveNow: CsmsRequestFor<"ReserveNow">;
  CancelReservation: CsmsRequestFor<"CancelReservation">;
  SendLocalList: CsmsRequestFor<"SendLocalList">;
  GetLocalListVersion: CsmsRequestFor<"GetLocalListVersion">;
  /** Also accepted with a 1.6-style `idTag` in place of the idToken. */
  RequestStartTransaction: CsmsRequestFor<"RequestStartTransaction"> & {
    idTag?: string;
  };
  RequestStopTransaction: CsmsRequestFor<"RequestStopTransaction">;
  GetVariables: { getVariableData?: VariableRequest[] };
  SetVariables: { setVariableData?: VariableRequest[] };
  GetReport: CsmsRequestFor<"GetReport">;
}

/** A CSMS call the simulator answers, its payload typed by its action. */
export type CsmsCall = {
  [A in keyof CsmsRequests]: { action: A; payload: CsmsRequests[A] };
}[keyof CsmsRequests];

/** A response the simulator reads, for an action named the same in 1.6 and 2.0.1. */
export type EitherResponse<M extends string> =
  | OCPPResponseType<"ocpp1.6", M>
  | OCPPResponseType<"ocpp2.0.1", M>;

/**
 * An Authorize response: 1.6 answers with `idTagInfo`, 2.0.1 with
 * `idTokenInfo`; the simulator reads the one its protocol uses.
 */
export type AuthorizeResponse = Partial<
  OCPPResponseType<"ocpp1.6", "Authorize">
> &
  Partial<OCPPResponseType<"ocpp2.0.1", "Authorize">>;

/** A metric or a piece of context in a report: written as text. */
export type ReportValue = string | number | boolean | null | undefined;

/** A message in a report's trace: a raw frame as sent, or a CALL frame. */
export type ReportMessage = string | CallFrame;
