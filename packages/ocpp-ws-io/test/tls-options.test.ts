import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import tls, { type SecureVersion } from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client/client.js";
import { OCPPServer } from "../src/server/server.js";
import { SecurityProfile, type TLSOptions } from "../src/types.js";

/**
 * TLS for security profiles 2 and 3. A CSMS "SHALL support at least the
 * following four cipher suites", two of which need an ECDSA certificate and
 * two an RSA one, so "the CSMS will have to provide 2 different certificates"
 * (2.0.1 Part 2 §A). The 1.6 security whitepaper lets legacy charge points
 * use TLS 1.0/1.1, which needs a lower minVersion than Node's default.
 *
 * The certificates under fixtures/tls are self-signed, for localhost, and
 * exist only for these tests.
 */
const fixture = (name: string) =>
  readFileSync(join(__dirname, "fixtures", "tls", name));
const RSA = { cert: fixture("rsa.crt"), key: fixture("rsa.key") };
const ECDSA = { cert: fixture("ecdsa.crt"), key: fixture("ecdsa.key") };

/** The four mandatory suites, by their OpenSSL names. */
const ECDSA_SUITES = [
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
];
const RSA_SUITES = ["AES128-GCM-SHA256", "AES256-GCM-SHA384"];

describe("TLS options", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  async function start(tlsOptions: TLSOptions) {
    const server = new OCPPServer({
      protocols: ["ocpp1.6"],
      securityProfile: SecurityProfile.TLS_BASIC_AUTH,
      requireBasicAuth: false,
      logging: false,
      tls: tlsOptions,
    });
    servers.push(server);
    const { port } = (await server.listen(0)).address() as AddressInfo;
    return { server, port };
  }

  /** Whether a TLS handshake succeeds with the given client limits. */
  function handshake(
    port: number,
    options: { ciphers?: string; maxVersion?: SecureVersion },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = tls.connect({
        host: "localhost",
        port,
        rejectUnauthorized: false,
        ...options,
      });
      socket.once("secureConnect", () => {
        socket.end();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  }

  it("serves all four mandatory suites with an RSA and an ECDSA certificate", async () => {
    const { port } = await start({
      cert: [RSA.cert, ECDSA.cert],
      key: [RSA.key, ECDSA.key],
    });

    for (const ciphers of [...ECDSA_SUITES, ...RSA_SUITES]) {
      expect(
        await handshake(port, { ciphers, maxVersion: "TLSv1.2" }),
        ciphers,
      ).toBe(true);
    }
  });

  it("cannot serve the ECDSA suites with an RSA certificate alone", async () => {
    const { port } = await start({ cert: RSA.cert, key: RSA.key });

    for (const ciphers of ECDSA_SUITES) {
      expect(await handshake(port, { ciphers, maxVersion: "TLSv1.2" })).toBe(
        false,
      );
    }
  });

  it("applies minVersion", async () => {
    const { port } = await start({ ...RSA, minVersion: "TLSv1.3" });

    expect(await handshake(port, { maxVersion: "TLSv1.2" })).toBe(false);
    expect(await handshake(port, {})).toBe(true);
  });

  it("applies ciphers", async () => {
    const { port } = await start({ ...RSA, ciphers: "AES128-GCM-SHA256" });

    expect(
      await handshake(port, {
        ciphers: "AES256-GCM-SHA384",
        maxVersion: "TLSv1.2",
      }),
    ).toBe(false);
    expect(
      await handshake(port, {
        ciphers: "AES128-GCM-SHA256",
        maxVersion: "TLSv1.2",
      }),
    ).toBe(true);
  });

  it("keeps minVersion and ciphers when updateTLS replaces only the certificate", async () => {
    const { server, port } = await start({ ...RSA, minVersion: "TLSv1.3" });

    server.updateTLS({ cert: RSA.cert, key: RSA.key });

    expect(await handshake(port, { maxVersion: "TLSv1.2" })).toBe(false);
  });

  it("lets updateTLS add a second certificate", async () => {
    const { server, port } = await start({ ...RSA });

    server.updateTLS({
      cert: [RSA.cert, ECDSA.cert],
      key: [RSA.key, ECDSA.key],
    });

    expect(
      await handshake(port, {
        ciphers: ECDSA_SUITES[0],
        maxVersion: "TLSv1.2",
      }),
    ).toBe(true);
  });

  it("passes ciphers through on the client", async () => {
    const { port } = await start({ ...RSA, ciphers: "AES128-GCM-SHA256" });
    const connectWith = async (ciphers: string) => {
      const client = new OCPPClient({
        identity: "CP-TLS",
        endpoint: `wss://localhost:${port}`,
        protocols: ["ocpp1.6"],
        securityProfile: SecurityProfile.TLS_BASIC_AUTH,
        password: "0123456789abcdef",
        reconnect: false,
        logging: false,
        tls: { ca: RSA.cert, ciphers, maxVersion: "TLSv1.2" },
      });
      clients.push(client);
      return client.connect().then(
        () => true,
        () => false,
      );
    };

    expect(await connectWith("AES256-GCM-SHA384")).toBe(false);
    expect(await connectWith("AES128-GCM-SHA256")).toBe(true);
  });
});
