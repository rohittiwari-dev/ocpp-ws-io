import type { IncomingMessage } from "node:http";
import type { OCPPPlugin, OCPPServer, OCPPServerStats } from "ocpp-ws-io";
import type { JsonObject, JsonValue } from "./index.js";

export interface BoardPluginInstance extends OCPPPlugin {
  serverRef?: OCPPServer;
  flush(): Promise<void>;
}
export interface CommandRequest {
  identity: string;
  method: string;
  params: JsonObject;
  timeoutMs: number;
  protocol: string;
}
export interface CommandRecord extends CommandRequest {
  id: string;
  timestamp: string;
  status: "pending" | "succeeded" | "failed";
  result?: JsonValue;
  error?: string;
  durationMs?: number;
  operator: string;
}
export interface ServerInfo {
  attached: boolean;
  state: string;
  stats: OCPPServerStats | null;
  adapterMetrics: JsonValue;
  protocols: string[];
  commandsEnabled: boolean;
}
export interface CommandPreset {
  name: string;
  method: string;
  protocols: string[];
  params: JsonObject;
  description: string;
}
export interface BoardEnvironment {
  Variables: { user: { id?: string; name: string } };
}

export interface BoardIncomingMessage extends IncomingMessage {
  body?: JsonValue;
}
