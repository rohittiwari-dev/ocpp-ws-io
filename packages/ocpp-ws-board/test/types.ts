import { OCPPServer } from "ocpp-ws-io";
import type { OCPPProtocolProxy } from "ocpp-ws-io/proxy";
import type { SmartChargingEngine } from "ocpp-ws-io/smart-charge";
import type { BoardStorageAdapter, JsonValue } from "../dist/index.js";
import { createBoard } from "../dist/index.js";
export function verifyBindings(
  store: BoardStorageAdapter,
  engine: SmartChargingEngine,
  proxy: OCPPProtocolProxy,
) {
  const board = createBoard({ auth: { mode: "none" }, store });
  new OCPPServer({ protocols: ["ocpp1.6"] }).plugin(board.plugin);
  new OCPPServer({ protocols: ["ocpp2.0.1"] }).plugin(board.plugin);
  new OCPPServer({ protocols: ["ocpp2.1"] }).plugin(board.plugin);
  board.connectSmartCharge(engine)();
  board.connectProxy(proxy)();
  const data: JsonValue = { station: "CP", values: [1, true, null] };
  return data;
}
