import { createHash, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client.js";
import { RPCSecurityError } from "../src/errors.js";
import {
  type FlattenedJws,
  type SignedMessagesOptions,
  signedMessagesMiddleware,
  signedMessagesPlugin,
} from "../src/plugins/index.js";
import { OCPPServer } from "../src/server.js";
import type { JsonValue, LoggerLike, OCPPPlugin } from "../src/types.js";

/**
 * Signed messages (OCPP 2.0.1 Part 4 chapter 7, R13): `<Action>-Signed` with
 * the payload as a Flattened JWS whose protected header carries OCPPAction
 * and the message type. Receivers unwrap (§7.2 SHALL) and, with a key lookup,
 * verify; a reply to a signed request is signed. The charger here signs RS256
 * and the CSMS ES256, with the TLS test certificates.
 */
const fixtures = join(__dirname, "fixtures", "tls");
const read = (file: string) => readFileSync(join(fixtures, file), "utf8");
const ec = { privateKey: read("ecdsa.key"), certificate: read("ecdsa.crt") };
const rsa = { privateKey: read("rsa.key"), certificate: read("rsa.crt") };
const x5t = (pem: string) =>
  createHash("sha256")
    .update(new X509Certificate(pem).raw)
    .digest("base64url");
const certificates = new Map([
  [x5t(ec.certificate), ec.certificate],
  [x5t(rsa.certificate), rsa.certificate],
]);
const verify: SignedMessagesOptions["verify"] = (header) =>
  certificates.get(header["x5t#S256"] ?? "");

const b64 = (value: JsonValue) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
/** The signed params of a frame, as a copy; throws if they are not a JWS. */
function asJws(params: JsonValue): FlattenedJws {
  if (
    typeof params !== "object" ||
    params === null ||
    Array.isArray(params) ||
    typeof params.protected !== "string" ||
    typeof params.payload !== "string" ||
    typeof params.signature !== "string"
  ) {
    throw new Error(`Not a Flattened JWS: ${JSON.stringify(params)}`);
  }
  return {
    protected: params.protected,
    payload: params.payload,
    signature: params.signature,
  };
}

const unb64 = (part: string): JsonValue =>
  JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

const boot = {
  reason: "PowerUp",
  chargingStation: { model: "M1", vendorName: "V1" },
};

type Frame = JsonValue[];

describe("signed messages plugin", () => {
  const servers: OCPPServer[] = [];
  const clients: OCPPClient[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close({ force: true });
    for (const s of servers.splice(0)) await s.close({ force: true });
  });

  /**
   * A strict CSMS with the plugin, recording frames as they cross the wire
   * and the params its handlers receive.
   */
  async function start(
    csms: SignedMessagesOptions | null,
    protocol: "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1" = "ocpp2.0.1",
  ) {
    const errors: string[] = [];
    const logger: LoggerLike = {
      debug() {},
      info() {},
      warn() {},
      error(_message, meta) {
        errors.push(String(meta?.error));
      },
    };
    const server = new OCPPServer({
      protocols: [protocol],
      strictMode: true,
      logging: { logger },
    });
    servers.push(server);
    const wire = { in: [] as Frame[], out: [] as Frame[] };
    const recorder: OCPPPlugin = {
      name: "recorder",
      onBeforeReceive(_client, raw) {
        wire.in.push(JSON.parse(String(raw)));
        return undefined;
      },
      onBeforeSend(_client, message) {
        wire.out.push(JSON.parse(JSON.stringify(message)));
        return undefined;
      },
    };
    if (csms) server.plugin(signedMessagesPlugin(csms));
    server.plugin(recorder);
    const handled: Array<{ method: string; params: object }> = [];
    server.on("client", (c) => {
      c.handle("BootNotification", ({ params }) => {
        handled.push({ method: "BootNotification", params });
        return {
          currentTime: new Date().toISOString(),
          interval: 300,
          status: "Accepted",
        };
      });
      c.handle("Heartbeat", ({ params }) => {
        handled.push({ method: "Heartbeat", params });
        return { currentTime: new Date().toISOString() };
      });
      c.handle("NotifyPeriodicEventStream", ({ params }) => {
        handled.push({ method: "NotifyPeriodicEventStream", params });
      });
    });
    const http = await server.listen(0);
    const { port } = http.address() as AddressInfo;
    return { port, wire, handled, errors };
  }

  async function connect(
    port: number,
    charger: SignedMessagesOptions | null,
    protocol: "ocpp1.6" | "ocpp2.0.1" | "ocpp2.1" = "ocpp2.0.1",
  ) {
    const client = new OCPPClient({
      identity: "CP-1",
      endpoint: `ws://localhost:${port}`,
      protocols: [protocol],
      strictMode: true,
      reconnect: false,
      logging: false,
    });
    clients.push(client);
    if (charger) client.use(signedMessagesMiddleware(client, charger));
    await client.connect();
    return client;
  }

  /** The protected header and payload of a frame's JWS. */
  function opened(jws: JsonValue) {
    const { protected: header, payload } = jws as JsonValue & FlattenedJws;
    return { header: unb64(header), payload: unb64(payload) };
  }

  it("unwraps a signed call for the handler, and signs the reply to it", async () => {
    const { port, wire, handled } = await start({ ...ec, verify });
    const client = await connect(port, {
      ...rsa,
      sign: ["BootNotification"],
      verify,
    });

    const response = await client.call("BootNotification", boot);

    expect(response).toMatchObject({ status: "Accepted", interval: 300 });
    expect(handled).toEqual([{ method: "BootNotification", params: boot }]);

    const [type, id, action, jws] = wire.in[0];
    expect([type, action]).toEqual([2, "BootNotification-Signed"]);
    expect(Object.keys(jws as object).sort()).toEqual([
      "payload",
      "protected",
      "signature",
    ]);
    expect(opened(jws)).toEqual({
      header: {
        alg: "RS256",
        OCPPAction: "BootNotification",
        OCPPMessageTypedId: 2,
        "x5t#S256": x5t(rsa.certificate),
      },
      payload: boot,
    });

    const [replyType, replyId, replyJws] = wire.out[0];
    expect([replyType, replyId]).toEqual([3, id]);
    expect(opened(replyJws).header).toEqual({
      alg: "ES256",
      OCPPAction: "BootNotification",
      OCPPMessageTypedId: 3,
      "x5t#S256": x5t(ec.certificate),
    });
  });

  it("sends other calls, and the replies to them, unsigned", async () => {
    const { port, wire } = await start({ ...ec, verify });
    const client = await connect(port, { ...rsa, sign: ["BootNotification"] });

    await client.call("Heartbeat", {});

    expect(wire.in[0][2]).toBe("Heartbeat");
    expect(wire.in[0][3]).toEqual({});
    expect(Object.keys(wire.out[0][2] as object)).toEqual(["currentTime"]);
  });

  it("lets strict mode check the call unsigned, and sends nothing when it fails", async () => {
    const { port, wire } = await start({ ...ec, verify });
    const client = await connect(port, { ...rsa, sign: true });

    // BootNotification needs reason and chargingStation.
    await expect(client.call("BootNotification", {})).rejects.toThrow(
      /required property/,
    );
    expect(wire.in).toEqual([]);
  });

  it("signs what middleware registered after it made of the call and the reply", async () => {
    const { port, wire } = await start({ ...ec, verify });
    // On the CSMS, the "client" event comes after the plugins' onConnection,
    // so this middleware is registered after the plugin's.
    servers[servers.length - 1].on("client", (c) =>
      c.use(async (ctx, next) => {
        if (ctx.type === "outgoing_result") {
          ctx.payload = { ...(ctx.payload as object), interval: 60 };
        }
        return next();
      }),
    );
    const client = await connect(port, { ...rsa, sign: true, verify });
    client.use(async (ctx, next) => {
      if (ctx.type === "outgoing_call") {
        ctx.params = { ...boot, reason: "Triggered" };
      }
      return next();
    });

    const response = await client.call("BootNotification", boot);

    expect(opened(wire.in[0][3]).payload).toMatchObject({
      reason: "Triggered",
    });
    expect(opened(wire.out[0][2]).payload).toMatchObject({ interval: 60 });
    // The charger verified the signed reply and got the changed payload.
    expect(response).toMatchObject({ interval: 60 });
  });

  it("signs a SEND with message type 6 (OCPP 2.1)", async () => {
    const { port, wire, handled } = await start({ verify }, "ocpp2.1");
    const client = await connect(
      port,
      { ...ec, sign: ["NotifyPeriodicEventStream"] },
      "ocpp2.1",
    );
    const stream = {
      id: 1,
      pending: 0,
      basetime: new Date().toISOString(),
      data: [{ t: 0, v: "1" }],
    };

    await client.send("NotifyPeriodicEventStream", stream);
    await expect.poll(() => handled.length).toBe(1);

    expect(wire.in[0][0]).toBe(6);
    expect(opened(wire.in[0][3]).header).toMatchObject({
      OCPPAction: "NotifyPeriodicEventStream",
      OCPPMessageTypedId: 6,
    });
    expect(handled[0].params).toEqual(stream);
  });

  it("without verify, only unwraps: §7.2 makes checking the signature optional", async () => {
    const { port, handled } = await start({});
    const client = await connect(port, {
      sign: true,
      signer: { algorithm: "ES256", sign: () => Buffer.alloc(64) },
    });

    await client.call("BootNotification", boot);

    expect(handled).toEqual([{ method: "BootNotification", params: boot }]);
  });

  describe("with verify, refuses with SecurityError and does not run the handler", () => {
    const decoded = (part: string) => unb64(part) as { [key: string]: JsonValue };
    it.each<[string, (jws: FlattenedJws) => string | undefined, RegExp]>([
      [
        "a changed payload",
        (jws) => {
          jws.payload = b64({ ...boot, reason: "Triggered" });
          return undefined;
        },
        /does not verify/,
      ],
      [
        "a signature for another action",
        () => "Heartbeat-Signed",
        /is for "BootNotification", not Heartbeat/,
      ],
      [
        "alg none",
        (jws) => {
          jws.protected = b64({ ...decoded(jws.protected), alg: "none" });
          return undefined;
        },
        /alg "none" is not ES256, RS256 or RS384/,
      ],
      [
        "a critical header",
        (jws) => {
          jws.protected = b64({ ...decoded(jws.protected), crit: ["exp"] });
          return undefined;
        },
        /critical header/,
      ],
      [
        "another message type",
        (jws) => {
          jws.protected = b64({
            ...decoded(jws.protected),
            OCPPMessageTypedId: 6,
          });
          return undefined;
        },
        /message type 6, not 2/,
      ],
    ])("%s", async (_name, tamper, logged) => {
      const { port, handled, errors } = await start({ verify });
      const client = await connect(port, { ...ec, sign: true });
      // A hop in between: changes the signed frame after it was signed.
      client.use(async (ctx, next) => {
        if (ctx.type === "outgoing_call") {
          const signed = ctx.wrap;
          ctx.wrap = async (call) => {
            const wire = signed ? await signed(call) : call;
            const jws = asJws(wire.params);
            const method = tamper(jws);
            return { method: method ?? wire.method, params: { ...jws } };
          };
        }
        return next();
      });

      const error = await client
        .call("BootNotification", boot)
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(RPCSecurityError);
      expect(handled).toEqual([]);
      expect(errors.join("\n")).toMatch(logged);
    });
  });

  it("refuses an unsigned call that requireSignature covers", async () => {
    const { port, handled } = await start({
      verify,
      requireSignature: ["BootNotification"],
    });
    const client = await connect(port, null);

    const error = await client
      .call("BootNotification", boot)
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(RPCSecurityError);
    expect(handled).toEqual([]);
  });

  it("writes OCPPMessageTypeId when asked, and reads either spelling", async () => {
    const { port, wire, handled } = await start({ verify });
    const client = await connect(port, {
      ...ec,
      sign: true,
      messageTypeHeader: "OCPPMessageTypeId",
    });

    await client.call("BootNotification", boot);

    expect(opened(wire.in[0][3]).header).toMatchObject({
      OCPPMessageTypeId: 2,
    });
    expect(handled).toHaveLength(1);
  });

  it("rejects the call when the signed reply does not verify", async () => {
    // Names the EC certificate, so the key is found; the signature is junk.
    const { port } = await start({
      signer: {
        algorithm: "ES256",
        thumbprint: x5t(ec.certificate),
        sign: () => Buffer.alloc(64),
      },
    });
    const client = await connect(port, { ...rsa, sign: true, verify });

    const error = await client
      .call("BootNotification", boot)
      .catch((e: Error) => e);

    expect(error).toBeInstanceOf(RPCSecurityError);
    expect((error as Error).message).toMatch(/does not verify/);
  });

  it("leaves OCPP 1.6 alone: chapter 7 is 2.0.1 and 2.1 only", async () => {
    const { port, wire } = await start({ ...ec, verify }, "ocpp1.6");
    const client = await connect(port, { ...rsa, sign: true }, "ocpp1.6");

    await client.call("Heartbeat", {});

    expect(wire.in[0][2]).toBe("Heartbeat");
  });

  it("fails loudly on a DER-encoded ES256 signature", async () => {
    const { port, wire } = await start({ verify });
    const client = await connect(port, {
      sign: true,
      signer: { algorithm: "ES256", sign: () => Buffer.alloc(70) },
    });

    await expect(client.call("BootNotification", boot)).rejects.toThrow(
      /64 bytes, R \|\| S/,
    );
    expect(wire.in).toEqual([]);
  });

  it.each<[string, SignedMessagesOptions, RegExp]>([
    ["sign without a key", { sign: true }, /sign needs privateKey or signer/],
    ["requireSignature without verify", { requireSignature: true }, /needs verify/],
    [
      "an RSA key for ES256",
      { privateKey: rsa.privateKey, algorithm: "ES256" },
      /ES256 needs a P-256/,
    ],
    [
      "another key's certificate",
      { privateKey: ec.privateKey, certificate: rsa.certificate },
      /certificate does not belong to privateKey/,
    ],
    [
      "both a key and a signer",
      {
        privateKey: ec.privateKey,
        signer: { algorithm: "ES256", sign: () => Buffer.alloc(64) },
      },
      /either privateKey or signer/,
    ],
  ])("refuses options with %s", (_name, options, message) => {
    expect(() => signedMessagesPlugin(options)).toThrow(message);
  });
});
