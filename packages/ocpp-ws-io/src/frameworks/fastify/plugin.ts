import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { OCPPServer } from "../../server.js";
import { BaseOcppContext } from "../base/context.js";
import { shouldHandleUpgrade } from "../base/utils.js";
import type { OcppFastifyContext, OcppFastifyPluginOptions } from "./types.js";

class DefaultOcppFastifyContext
  extends BaseOcppContext
  implements OcppFastifyContext {}

export function createOcppFastifyContext(
  server: OCPPServer,
): OcppFastifyContext {
  return new DefaultOcppFastifyContext(server);
}

const ocppPlugin: FastifyPluginAsync<OcppFastifyPluginOptions> = async (
  fastify,
  options,
) => {
  const { ocppServer } = options;

  if (!ocppServer) {
    throw new Error("ocppServer is required in OcppFastifyPluginOptions");
  }

  const context = createOcppFastifyContext(ocppServer);

  // Decorate the request
  fastify.decorateRequest("ocpp", null as any);

  // Inject context on every request
  fastify.addHook("onRequest", async (request: FastifyRequest) => {
    request.ocpp = context;
  });

  // Attach to the upgrade event directly on the http.Server
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
        fastify.server.listenerCount("upgrade") <= 1 &&
        typeof socket?.destroy === "function" &&
        !socket.destroyed
      ) {
        socket.destroy();
      }
      return;
    }
    ocppServer.handleUpgrade(req, socket, head);
  };

  fastify.server.on("upgrade", upgradeHandler);

  // Close the OCPP server when Fastify closes
  fastify.addHook("onClose", async () => {
    fastify.server.removeListener("upgrade", upgradeHandler);
    await context.close();
  });
};

export const ocppFastifyPlugin = fp(ocppPlugin, {
  fastify: "4.x || 5.x",
  name: "ocpp-fastify",
});
