import {
  BrowserOCPPClient,
  type CallOptions,
  createRPCError,
  type OCPPResponseType,
} from "ocpp-ws-io/browser";

// This fixture uses package exports, never source paths. Run after building.
export async function frontEnd(): Promise<void> {
  const client = new BrowserOCPPClient({
    identity: "CP1",
    endpoint: "ws://localhost:9220",
    protocols: ["ocpp1.6"],
  });
  client.handle("Reset", () => ({ status: "Accepted" }));
  client.handle("UnlockConnector", () => {
    throw createRPCError("NotSupported", "fixed cables");
  });
  await client.connect();
  const options: CallOptions = { timeoutMs: 5000 };
  const boot: OCPPResponseType<"ocpp1.6", "BootNotification"> = await client.call(
    "BootNotification",
    { chargePointVendor: "Acme", chargePointModel: "X1" },
    options,
  );
  void boot.status;
}

// In a front end, timers are the DOM's: they return a number. Node's types
// (NodeJS.Timeout) must not reach this program through the package.
export const timer: number = setTimeout(() => {}, 0);
