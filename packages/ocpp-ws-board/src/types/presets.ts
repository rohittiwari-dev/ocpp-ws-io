import type { CommandPreset } from "./operations";

const all = ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"];
export const COMMAND_PRESETS: CommandPreset[] = [
  {
    name: "Request heartbeat",
    method: "TriggerMessage",
    protocols: all,
    params: { requestedMessage: "Heartbeat" },
    description: "Ask the station to report its heartbeat.",
  },
  {
    name: "Request status",
    method: "TriggerMessage",
    protocols: all,
    params: { requestedMessage: "StatusNotification" },
    description: "Request current station status.",
  },
  {
    name: "Read configuration",
    method: "GetConfiguration",
    protocols: ["ocpp1.6"],
    params: {},
    description: "Read supported configuration keys.",
  },
  {
    name: "Change configuration",
    method: "ChangeConfiguration",
    protocols: ["ocpp1.6"],
    params: { key: "HeartbeatInterval", value: "60" },
    description:
      "Review the key and value before changing station configuration.",
  },
  {
    name: "Soft reset",
    method: "Reset",
    protocols: ["ocpp1.6"],
    params: { type: "Soft" },
    description: "Restart the station. Active charging may be interrupted.",
  },
  {
    name: "Reset when idle",
    method: "Reset",
    protocols: ["ocpp2.0.1", "ocpp2.1"],
    params: { type: "OnIdle" },
    description: "Request a restart when the station becomes idle.",
  },
  {
    name: "Read variables",
    method: "GetVariables",
    protocols: ["ocpp2.0.1", "ocpp2.1"],
    params: {
      getVariableData: [
        {
          component: { name: "OCPPCommCtrlr" },
          variable: { name: "HeartbeatInterval" },
        },
      ],
    },
    description:
      "Read device-model variables. Edit component and variable names as needed.",
  },
  {
    name: "Unlock connector",
    method: "UnlockConnector",
    protocols: ["ocpp1.6"],
    params: { connectorId: 1 },
    description: "Release the connector lock. Check the connector ID.",
  },
  {
    name: "Unlock connector",
    method: "UnlockConnector",
    protocols: ["ocpp2.0.1", "ocpp2.1"],
    params: { evseId: 1, connectorId: 1 },
    description: "Release the EVSE connector lock. Check both IDs.",
  },
  {
    name: "Set availability",
    method: "ChangeAvailability",
    protocols: ["ocpp1.6"],
    params: { connectorId: 0, type: "Operative" },
    description: "Set station or connector availability.",
  },
  {
    name: "Set availability",
    method: "ChangeAvailability",
    protocols: ["ocpp2.0.1", "ocpp2.1"],
    params: { operationalStatus: "Operative" },
    description: "Set station availability; optionally provide an EVSE.",
  },
  {
    name: "Clear cache",
    method: "ClearCache",
    protocols: all,
    params: {},
    description: "Clear cached authorization data on the station.",
  },
  {
    name: "Get charging profiles",
    method: "GetChargingProfiles",
    protocols: ["ocpp2.0.1", "ocpp2.1"],
    params: { requestId: 1, chargingProfile: {} },
    description: "Request installed charging profiles.",
  },
];
