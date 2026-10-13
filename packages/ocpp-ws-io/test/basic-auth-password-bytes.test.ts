import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client/client.js";
import { buildWsOptions } from "../src/client/ws-options.js";
import { OCPPServer } from "../src/server/server.js";
import { SecurityProfile } from "../src/types/protocol.js";

/**
 * A Basic Auth password reaches the server as the bytes the client was given
 * (O30). The option takes a Buffer, and OCPP 1.6's AuthorizationKey is binary
 * (the 1.6-J errata, §3.10, describe it as the hexadecimal representation of
 * the password). The client built the header from `password.toString()`,
 * which decodes the bytes as UTF-8, so every byte that is not valid UTF-8
 * arrived as EF BF BD.
 */

const servers: OCPPServer[] = [];
const clients: OCPPClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close({ force: true }).catch(() => {});
  for (const s of servers.splice(0)) await s.close({ force: true });
});

/** Connects with `password` on profile 1; returns the password the server parsed. */
async function passwordSeenByServer(password: string | Buffer): Promise<Buffer | undefined> {
  const server = new OCPPServer({
    logging: false,
    protocols: ["ocpp1.6"],
    securityProfile: SecurityProfile.BASIC_AUTH,
  });
  servers.push(server);
  let seen: Buffer | undefined;
  server.auth((ctx) => {
    seen = ctx.handshake.password;
    ctx.accept();
  });
  const { port } = (await server.listen(0)).address() as AddressInfo;
  const client = new OCPPClient({
    endpoint: `ws://localhost:${port}`,
    identity: "CP-1",
    protocols: ["ocpp1.6"],
    securityProfile: SecurityProfile.BASIC_AUTH,
    password,
    reconnect: false,
    logging: false,
  });
  clients.push(client);
  await client.connect();
  return seen;
}

describe("a Basic Auth password's bytes", () => {
  it("arrive as sent from a Buffer that is not valid UTF-8", async () => {
    // 20 bytes, as a 1.6 AuthorizationKey: 0x9f and 0xff are never valid UTF-8.
    const key = Buffer.from("9f00ff10a1b2c3d4e5f60718293a4b5c6d7e8f90", "hex");
    const seen = await passwordSeenByServer(key);
    expect(seen?.toString("hex")).toBe(key.toString("hex"));
  });

  it("arrive as sent from a Buffer containing a colon", async () => {
    const key = Buffer.from([0x3a, 0x80, 0x3a, 0xfe]);
    const seen = await passwordSeenByServer(key);
    expect(seen?.toString("hex")).toBe(key.toString("hex"));
  });

  it("are a string's UTF-8 bytes, as before", async () => {
    const seen = await passwordSeenByServer("pässwörd:42");
    expect(seen?.toString("utf8")).toBe("pässwörd:42");
  });
});

/**
 * A password is sent whenever it is set (O31). The client added the header
 * only on security profile 1 or 2 and dropped the password on the others
 * without a word, so code moved over from a library that sends it whenever it
 * is set connected without credentials. The server parses it on every profile.
 */
describe("the Authorization header", () => {
  const expected = `Basic ${Buffer.from("CP-1:hunter2").toString("base64")}`;
  const headerFor = (securityProfile: SecurityProfile, password?: string) =>
    buildWsOptions(
      { identity: "CP-1", endpoint: "ws://localhost:9220", securityProfile, password },
      "CP-1",
    ).headers?.Authorization;

  it.each([
    ["NONE", SecurityProfile.NONE],
    ["BASIC_AUTH", SecurityProfile.BASIC_AUTH],
    ["TLS_BASIC_AUTH", SecurityProfile.TLS_BASIC_AUTH],
    ["TLS_CLIENT_CERT", SecurityProfile.TLS_CLIENT_CERT],
  ] as const)("is sent on profile %s when a password is set", (_name, profile) => {
    expect(headerFor(profile, "hunter2")).toBe(expected);
  });

  it("is not sent without a password", () => {
    expect(headerFor(SecurityProfile.BASIC_AUTH)).toBeUndefined();
  });

  it("brings the password to a server with no security profile set", async () => {
    const server = new OCPPServer({ logging: false, protocols: ["ocpp1.6"] });
    servers.push(server);
    let seen: Buffer | undefined;
    server.auth((ctx) => {
      seen = ctx.handshake.password;
      ctx.accept();
    });
    const { port } = (await server.listen(0)).address() as AddressInfo;
    const client = new OCPPClient({
      endpoint: `ws://localhost:${port}`,
      identity: "CP-1",
      protocols: ["ocpp1.6"],
      password: "hunter2",
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    await client.connect();
    expect(seen?.toString("utf8")).toBe("hunter2");
  });
});
