import { createBoard } from "../board.js";
import type { BoardOptions } from "../types.js";

/**
 * Hono adapter — thin wrapper since board.ts is already Hono.
 * Usage:
 *   import { honoAdapter } from "ocpp-ws-board";
 *   const { subApp, plugin } = honoAdapter({ auth: { mode: "token", token: "secret" } });
 *   app.route("/ocpp-ws-io/ui", subApp);
 */
export function honoAdapter(options: BoardOptions) {
  const board = createBoard(options);
  return {
    subApp: board.app,
    plugin: board.plugin,
    store: board.store,
    cleanup: board.cleanup,
  };
}
