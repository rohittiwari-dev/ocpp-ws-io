import { BrowserOCPPClient } from "../../src/browser/client.js";
import { OCPPClient } from "../../src/client.js";
import { NOREPLY } from "../../src/types.js";

export async function emptyPayloadsMustBeObjects() {
  const options = {
    identity: "cp",
    endpoint: "ws://localhost:9220",
    protocols: ["ocpp1.6"] as const,
  };
  const node = new OCPPClient(options);
  const browser = new BrowserOCPPClient(options);
  for (const client of [node, browser]) {
    await client.call("Heartbeat", {});
    client.handle("StatusNotification", () => ({}));
    client.handle("StatusNotification", async () => ({}));
    client.handle("StatusNotification", () => NOREPLY);
    client.handle("StatusNotification", async () => NOREPLY);
    // @ts-expect-error an empty request cannot be a number
    await client.call("Heartbeat", 42);
    // @ts-expect-error or a string
    await client.call("Heartbeat", "invalid");
    // @ts-expect-error or an array
    await client.call("Heartbeat", []);
    // @ts-expect-error an empty response must also be an object
    client.handle("StatusNotification", () => 42);
    // @ts-expect-error awaiting a response cannot allow a primitive
    client.handle("StatusNotification", async () => 42);
    // @ts-expect-error an empty response cannot be an array
    client.handle("StatusNotification", () => []);
    // @ts-expect-error closed empty schemas still reject additional fields
    client.handle("StatusNotification", () => ({ extra: true }));
  }
}
