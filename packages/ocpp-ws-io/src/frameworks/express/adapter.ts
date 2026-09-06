import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { OCPPServer } from "../../server.js";
import { shouldHandleUpgrade } from "../base/utils.js";
import { createOcppExpressContext } from "./context.js";
import type { AttachOcppExpressOptions, OcppExpressBinding } from "./types.js";

export function attachOcppExpress(
  httpServer: HttpServer,
  server: OCPPServer,
  options: AttachOcppExpressOptions = {},
): OcppExpressBinding {
  const context = createOcppExpressContext(server);
  let disposed = false;

  const upgradeHandler = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    if (!shouldHandleUpgrade(req, options)) {
      // Node only closes an unhandled upgrade when NO 'upgrade' listener
      // exists — once one is registered it assumes a listener took ownership.
      // Returning here therefore left the socket open forever whenever this
      // was the only listener, leaking one fd per filtered-out upgrade. When
      // other listeners are attached, one of them may still want the socket,
      // so it is left alone.
      if (
        httpServer.listenerCount("upgrade") <= 1 &&
        typeof socket?.destroy === "function" &&
        !socket.destroyed
      ) {
        socket.destroy();
      }
      return;
    }
    server.handleUpgrade(req, socket, head);
  };

  httpServer.on("upgrade", upgradeHandler);

  const dispose = () => {
    if (disposed) return;
    httpServer.removeListener("upgrade", upgradeHandler);
    disposed = true;
  };

  return {
    server,
    httpServer,
    context,
    dispose,
    async close(closeOptions) {
      dispose();
      await server.close(closeOptions);

      if (options.closeHttpServer && httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      }
    },
  };
}
