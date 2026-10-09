import { BrowserOCPPClient } from "../../src/browser/client.js";
import { OCPPClient } from "../../src/client.js";
import { OCPPServer } from "../../src/server.js";

const endpoint = "ws://localhost:9220";

export function dataTransferHandlers() {
  const client = new OCPPClient({ identity: "CP1", endpoint });
  client.handle(
    "DataTransfer",
    async ({ messageId, method, params, protocol, signal, unconfirmed }) => {
      console.log({ messageId, method, params, protocol, signal, unconfirmed });
      return { status: "Accepted" as const };
    },
  );

  const c201 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp2.0.1"] });
  c201.handle("DataTransfer", async () => ({ status: "Accepted" as const }));
  c201.handle("ocpp2.0.1", "DataTransfer", async ({ params }) => ({
    status: "Accepted" as const,
    data: params.data,
  }));
  // @ts-expect-error DataTransfer still rejects extra response fields.
  c201.handle("DataTransfer", async () => ({ status: "Accepted" as const, bogus: true }));
  // @ts-expect-error Nested schema fields remain checked.
  c201.handle("DataTransfer", async () => ({ status: "Accepted" as const, statusInfo: { reasonCode: "x", bogus: true } }));
  // @ts-expect-error DataTransfer still requires a valid status.
  c201.handle("DataTransfer", async () => ({ status: "Invalid" as const }));

  const c16 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp1.6"] });
  c16.handle("DataTransfer", async () => ({ status: "Accepted" as const }));
  // @ts-expect-error OCPP 1.6 data must remain a string.
  c16.handle("DataTransfer", async () => ({ status: "Accepted" as const, data: { value: 1 } }));

  const c21 = new OCPPClient({ identity: "CP1", endpoint, protocols: ["ocpp2.1"] });
  c21.handle("DataTransfer", async () => ({ status: "Accepted" as const }));

  const browser = new BrowserOCPPClient({ identity: "CP1", endpoint });
  browser.handle("DataTransfer", async () => ({ status: "Accepted" as const }));

  const server = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1", "ocpp2.1"] });
  server.on("client", (connection) => {
    connection.handle("DataTransfer", async () => ({ status: "Accepted" as const }));
  });
}
