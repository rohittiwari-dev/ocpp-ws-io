import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import { unchecked } from "../src/core/unchecked.js";
import { createValidator } from "../src/core/validation/validator.js";

/**
 * Strict mode never runs without validation (B5), strictModeValidators add to
 * the built-in validators (B9), and a protocol listed twice is a mistake (B6).
 */
const vendorValidator = createValidator("vendor-proto", [
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "urn:Ping.req",
    type: "object",
    properties: { n: { type: "number" } },
    required: ["n"],
    additionalProperties: false,
  },
]);
const endpoint = "ws://localhost:1";

describe("strict mode needs a validator for every strict protocol (B5)", () => {
  it("a server throws when one is missing, naming it and the way out", () => {
    expect(
      () =>
        new OCPPServer({ protocols: ["ocpp2.0", "ocpp1.6"], strictMode: true }),
    ).toThrow(/Missing strictMode validator for subprotocol "ocpp2\.0"/);
  });

  it("a client throws the same way", () => {
    expect(
      () =>
        new OCPPClient({
          identity: "CP1",
          endpoint,
          protocols: ["vendor-proto"],
          strictMode: true,
        }),
    ).toThrow(/Missing strictMode validator for subprotocol "vendor-proto"/);
  });

  it("is satisfied by a custom validator, or by limiting strictMode", () => {
    expect(
      () =>
        new OCPPServer({
          protocols: ["ocpp1.6", "vendor-proto"],
          strictMode: true,
          strictModeValidators: [vendorValidator],
        }),
    ).not.toThrow();
    expect(
      () =>
        new OCPPServer({
          protocols: ["ocpp2.0", "ocpp1.6"],
          strictMode: ["ocpp1.6"],
        }),
    ).not.toThrow();
  });

  it("reconfigure() checks too, and leaves the options unchanged when it throws", async () => {
    const server = new OCPPServer({ protocols: ["ocpp2.0", "ocpp1.6"] });
    expect(() => server.reconfigure({ strictMode: true })).toThrow(
      /Missing strictMode validator for subprotocol "ocpp2\.0"/,
    );
    // Nothing was applied: with strictMode on, any later reconfigure would
    // fail the same check.
    expect(() => server.reconfigure({ callTimeoutMs: 5000 })).not.toThrow();
    await server.close({ force: true });
  });
});

describe("strictModeValidators add to the built-in validators (B9)", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  it("a 1.6 connection is still validated when only a vendor validator is given", async () => {
    // The docs' own example: a vendor validator next to a standard protocol.
    const server = new OCPPServer({ protocols: ["ocpp1.6"], logging: false });
    servers.push(server);
    server.on("client", (c) =>
      c.handle(unchecked("BootNotification"), () => ({
        currentTime: new Date().toISOString(),
        interval: 300,
        status: "Accepted",
      })),
    );
    const http = await server.listen(0);
    const client = new OCPPClient({
      identity: "CP1",
      endpoint: `ws://localhost:${(http.address() as AddressInfo).port}`,
      protocols: ["ocpp1.6", "vendor-proto"],
      strictMode: true,
      strictModeValidators: [vendorValidator],
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    await client.connect();
    expect(client.protocol).toBe("ocpp1.6");

    // Invalid on purpose: 1.6 BootNotification requires vendor and model.
    await expect(
      client.call(unchecked("BootNotification"), {}),
    ).rejects.toThrow(/required property/);
  });
});

describe("a protocol listed twice is rejected (B6)", () => {
  const twice = ["ocpp1.6", "ocpp1.6"] as const;

  it("by the server", () => {
    expect(() => new OCPPServer({ protocols: [...twice] as never })).toThrow(
      /protocols lists "ocpp1\.6" more than once/,
    );
  });

  it("by the client and the browser client", () => {
    expect(
      () =>
        new OCPPClient({ identity: "CP1", endpoint, protocols: [...twice] as never }),
    ).toThrow(/protocols lists "ocpp1\.6" more than once/);
    expect(
      () =>
        new BrowserOCPPClient({
          identity: "CP1",
          endpoint,
          protocols: [...twice] as never,
        }),
    ).toThrow(/protocols lists "ocpp1\.6" more than once/);
  });

  it("by a route's config and by reconfigure()", async () => {
    const server = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });
    expect(() =>
      server.route("/x").config({ protocols: [...twice] as never }),
    ).toThrow(/protocols lists "ocpp1\.6" more than once/);
    expect(() => server.reconfigure({ protocols: [...twice] as never })).toThrow(
      /protocols lists "ocpp1\.6" more than once/,
    );
    await server.close({ force: true });
  });
});

describe("a route's strict mode needs validators too (B5)", () => {
  it("refuses a connection on a protocol it would leave unvalidated", async () => {
    const errors: string[] = [];
    const server = new OCPPServer({
      protocols: ["ocpp1.6", "vendor-proto"],
      logging: {
        logger: {
          debug() {},
          info() {},
          warn() {},
          error: (_m: string, meta?: Record<string, unknown>) =>
            errors.push(String(meta?.error ?? "")),
        },
      },
    });
    server.route("/strict/:identity").config({ strictMode: true });
    const http = await server.listen(0);
    const port = (http.address() as AddressInfo).port;
    const vendor = new OCPPClient({
      identity: "CP1",
      endpoint: `ws://localhost:${port}/strict`,
      protocols: ["vendor-proto"],
      reconnect: false,
      logging: false,
    });
    await expect(vendor.connect()).rejects.toThrow();
    expect(errors.join(" ")).toMatch(
      /Missing strictMode validator for subprotocol "vendor-proto"/,
    );

    // 1.6 has a built-in validator, so the same route takes it.
    const standard = new OCPPClient({
      identity: "CP2",
      endpoint: `ws://localhost:${port}/strict`,
      protocols: ["ocpp1.6"],
      reconnect: false,
      logging: false,
    });
    await expect(standard.connect()).resolves.toBeDefined();
    await standard.close({ force: true });
    await server.close({ force: true });
  });
});
