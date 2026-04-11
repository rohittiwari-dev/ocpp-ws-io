import { createBoard } from "../board.js";
import type { BoardOptions } from "../types.js";

/**
 * Express/Connect adapter.
 * Usage:
 *   import { expressAdapter } from "ocpp-ws-board";
 *   app.use("/ocpp-ws-io/ui", expressAdapter({ auth: { mode: "token", token: "secret" } }));
 */
export function expressAdapter(options: BoardOptions) {
  const board = createBoard(options);

  // Return both the middleware handler and the plugin
  const handler = async (req: any, res: any) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const honoReq = new Request(url.toString(), {
      method: req.method,
      headers: req.headers as any,
      body: req.method !== "GET" && req.method !== "HEAD" ? req : undefined,
    });

    const response = await board.app.fetch(honoReq);

    res.status(response.status);
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            res.end();
            break;
          }
          res.write(value);
        }
      };
      pump().catch(() => res.end());
    } else {
      const text = await response.text();
      res.end(text);
    }
  };

  return {
    handler,
    plugin: board.plugin,
    store: board.store,
    cleanup: board.cleanup,
  };
}
