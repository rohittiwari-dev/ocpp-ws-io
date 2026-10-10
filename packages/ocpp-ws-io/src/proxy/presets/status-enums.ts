/**
 * OCPP 1.6 status → OCPP 2.1 connectorStatus enum mapping.
 * Per OCPP 2.0.1 Part 2, Section K.10 — ConnectorStatusEnumType.
 */
export const statusMap16to21: Record<string, string> = {
  Available: "Available",
  Preparing: "Occupied",
  Charging: "Occupied",
  SuspendedEVSE: "Occupied",
  SuspendedEV: "Occupied",
  Finishing: "Occupied",
  Reserved: "Reserved",
  Unavailable: "Unavailable",
  Faulted: "Faulted",
};

/**
 * OCPP 2.1 connectorStatus → OCPP 1.6 status mapping (best-effort reverse).
 * 2.1 has fewer granular statuses, so some information is lost.
 */
export const statusMap21to16: Record<string, string> = {
  Available: "Available",
  Occupied: "Charging", // Best guess — could be Preparing/SuspendedEV/etc.
  Reserved: "Reserved",
  Unavailable: "Unavailable",
  Faulted: "Faulted",
};

/**
 * OCPP 2.1 operationalStatus → OCPP 1.6 availability type mapping.
 */
export const availabilityMap21to16: Record<string, string> = {
  Operative: "Available",
  Inoperative: "Unavailable",
};

/**
 * OCPP 1.6 availability type → OCPP 2.1 operationalStatus mapping.
 */
export const availabilityMap16to21: Record<string, string> = {
  Available: "Operative",
  Unavailable: "Inoperative",
};
