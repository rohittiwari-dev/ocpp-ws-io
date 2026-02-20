import { createLoggingMiddleware, OCPPServer } from "ocpp-ws-io";

const server = new OCPPServer({
  logging: {
    prettify: true,
    exchangeLog: true,
  },
});

server.route("*").on("client", (client) => {
  client.log.info("Client connected", { path: client.handshake.params });
});

server.listen(8080);
