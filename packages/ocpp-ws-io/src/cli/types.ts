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

/** One entry of a GetVariables or SetVariables request, as the simulator reads it. */
export interface VariableRequest {
  component?: OutgoingValue;
  variable?: { name?: string; [key: string]: OutgoingValue };
  /** The 1.6 name of a key, which the simulator also accepts. */
  key?: string;
  attributeValue?: string;
}

/**
 * The fields of a CSMS request the simulator reads, for every action it
 * answers. Which ones a request has depends on its action and protocol.
 */
export interface CsmsRequest {
  type?: string;
  idTag?: string;
  idToken?: { idToken: string };
  transactionId?: number | string;
  connectorId?: number;
  /** ChangeConfiguration's key, or GetConfiguration's list of them. */
  key?: string | string[];
  value?: string;
  requestedMessage?: string;
  reservationId?: number;
  requestId?: number;
  getVariableData?: VariableRequest[];
  setVariableData?: VariableRequest[];
}

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
