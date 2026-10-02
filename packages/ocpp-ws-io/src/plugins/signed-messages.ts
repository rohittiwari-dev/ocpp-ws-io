import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
  X509Certificate,
} from "node:crypto";
import type { OCPPClient } from "../client.js";
import type { MiddlewareFunction } from "../middleware.js";
import {
  type JsonValue,
  MessageType,
  type MiddlewareContext,
  type OCPPPlugin,
} from "../types.js";
import { createRPCError } from "../util.js";

/** The JWS algorithms OCPP allows for signed messages (Part 4 §7.3). */
export type SignedMessageAlgorithm = "ES256" | "RS256" | "RS384";

/**
 * The JWS Protected Header of a signed message (Part 4 §7.1), as received.
 * The message type field is spelled `OCPPMessageTypedId` in the OCPP 2.0.1
 * text; some implementations write `OCPPMessageTypeId`. Either is read.
 */
export interface SignedMessageHeader {
  alg: string;
  OCPPAction: string;
  OCPPMessageTypedId?: number;
  OCPPMessageTypeId?: number;
  /** SHA-256 hash of the DER signing certificate, base64url (§7.4). */
  "x5t#S256"?: string;
  [name: string]: JsonValue | undefined;
}

/** A Flattened JWS JSON Serialization (RFC 7515 §7.2.2). */
export interface FlattenedJws {
  protected: string;
  payload: string;
  signature: string;
}

/**
 * Signs with a key the plugin cannot hold itself, such as one in an HSM or in
 * a calibrated measuring chip (§7.4).
 */
export interface SignedMessageSigner {
  algorithm: SignedMessageAlgorithm;
  /** x5t#S256 of the signing certificate, sent in the header (§7.4 SHOULD). */
  thumbprint?: string;
  /**
   * Signs the JWS signing input. An ES256 signature is the 64-byte R || S
   * pair (RFC 7518 §3.4), not DER.
   */
  sign(signingInput: Buffer): Buffer | Promise<Buffer>;
}

/** A key that verifies signatures: PEM (key or certificate), a KeyObject or a certificate. */
export type SignedMessageVerifyKey = string | KeyObject | X509Certificate;

/** Which actions an option applies to. */
export type SignedMessageActions =
  | boolean
  | readonly string[]
  | ((action: string) => boolean);

export interface SignedMessagesOptions {
  /**
   * The signing key, PEM or KeyObject. A P-256 EC key signs ES256 and an RSA
   * key RS256, unless `algorithm` says RS384.
   */
  privateKey?: string | KeyObject;
  algorithm?: SignedMessageAlgorithm;
  /**
   * The certificate of `privateKey`, PEM or X509Certificate. Its thumbprint is
   * sent as x5t#S256 so the receiver can find the key (§7.4).
   */
  certificate?: string | X509Certificate;
  /** Instead of `privateKey`: a signer of your own. */
  signer?: SignedMessageSigner;
  /**
   * Which outgoing calls and SENDs to sign. A reply to a signed request is
   * signed whenever there is a key, as §7.2 requires. CALLERRORs are never
   * signed: the format has no action for them.
   */
  sign?: SignedMessageActions;
  /**
   * Returns the key for a received signed message, found from its header
   * (usually `x5t#S256`), or undefined when there is none. Without `verify`,
   * signed messages are only unwrapped: §7.2 makes extracting the message
   * mandatory and checking the signature optional.
   */
  verify?: (
    header: SignedMessageHeader,
  ) =>
    | SignedMessageVerifyKey
    | undefined
    | Promise<SignedMessageVerifyKey | undefined>;
  /**
   * Actions that must arrive signed, including the replies to calls this
   * side signed; anything unsigned is refused with SecurityError. Needs
   * `verify`. Default: none.
   */
  requireSignature?: SignedMessageActions;
  /**
   * How the message type field is spelled in the headers this side writes.
   * Received headers may use either spelling.
   * @default "OCPPMessageTypedId" (the OCPP 2.0.1 Part 4 text)
   */
  messageTypeHeader?: "OCPPMessageTypedId" | "OCPPMessageTypeId";
}

const SIGNED_SUFFIX = "-Signed";
const HASH: Record<SignedMessageAlgorithm, string> = {
  ES256: "sha256",
  RS256: "sha256",
  RS384: "sha384",
};
/** Signed messages are defined by Part 4 of OCPP 2.0.1 and 2.1 only. */
const SIGNED_PROTOCOLS = new Set(["ocpp2.0.1", "ocpp2.1"]);
/** Bounds the IDs remembered per connection (unanswered calls, NOREPLY). */
const MAX_TRACKED_IDS = 1000;

interface ResolvedOptions {
  signer?: SignedMessageSigner;
  shouldSign: (action: string) => boolean;
  mustBeSigned: (action: string) => boolean;
  verify?: SignedMessagesOptions["verify"];
  messageTypeHeader: "OCPPMessageTypedId" | "OCPPMessageTypeId";
}

function isAlgorithm(alg: string): alg is SignedMessageAlgorithm {
  return alg === "ES256" || alg === "RS256" || alg === "RS384";
}

function matcher(actions: SignedMessageActions | undefined) {
  if (typeof actions === "function") return actions;
  if (Array.isArray(actions))
    return (action: string) => actions.includes(action);
  return () => actions === true;
}

/** Throws unless `key` can sign or verify `alg` (RFC 7518 §3.3, §3.4). */
function assertKeyFits(key: KeyObject, alg: SignedMessageAlgorithm): void {
  if (alg === "ES256") {
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new TypeError("ES256 needs a P-256 (prime256v1) EC key");
    }
  } else if (key.asymmetricKeyType !== "rsa") {
    throw new TypeError(`${alg} needs an RSA key`);
  }
}

function thumbprint(certificate: X509Certificate): string {
  return createHash("sha256").update(certificate.raw).digest("base64url");
}

function keySigner(options: SignedMessagesOptions): SignedMessageSigner {
  const raw = options.privateKey;
  if (raw === undefined) throw new TypeError("privateKey is missing");
  const key = typeof raw === "string" ? createPrivateKey(raw) : raw;
  if (key.type !== "private") {
    throw new TypeError("privateKey must be a private key");
  }
  const algorithm =
    options.algorithm ?? (key.asymmetricKeyType === "ec" ? "ES256" : "RS256");
  assertKeyFits(key, algorithm);

  let x5t: string | undefined;
  if (options.certificate !== undefined) {
    const certificate =
      typeof options.certificate === "string"
        ? new X509Certificate(options.certificate)
        : options.certificate;
    if (!certificate.checkPrivateKey(key)) {
      throw new TypeError("certificate does not belong to privateKey");
    }
    x5t = thumbprint(certificate);
  }

  return {
    algorithm,
    thumbprint: x5t,
    sign: (input) =>
      cryptoSign(
        HASH[algorithm],
        input,
        algorithm === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
      ),
  };
}

function resolveOptions(options: SignedMessagesOptions): ResolvedOptions {
  if (options.signer && options.privateKey !== undefined) {
    throw new TypeError("Pass either privateKey or signer, not both");
  }
  const signer =
    options.signer ??
    (options.privateKey !== undefined ? keySigner(options) : undefined);
  if (options.sign && !signer) {
    throw new TypeError("sign needs privateKey or signer");
  }
  if (options.requireSignature && !options.verify) {
    // Requiring a signature nobody checks would accept any forged one.
    throw new TypeError("requireSignature needs verify");
  }
  return {
    signer,
    shouldSign: matcher(options.sign),
    mustBeSigned: matcher(options.requireSignature),
    verify: options.verify,
    messageTypeHeader: options.messageTypeHeader ?? "OCPPMessageTypedId",
  };
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFlattenedJws(value: JsonValue): value is JsonValue & FlattenedJws {
  return (
    isObject(value) &&
    typeof value.protected === "string" &&
    typeof value.payload === "string" &&
    typeof value.signature === "string"
  );
}

/** Decodes a base64url JSON object, or throws FormatViolation. */
function decodeObject(
  part: string,
  what: string,
): { [key: string]: JsonValue } {
  let value: JsonValue;
  try {
    value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw createRPCError(
      "FormatViolation",
      `Signed message: ${what} is not JSON`,
    );
  }
  if (!isObject(value)) {
    throw createRPCError(
      "FormatViolation",
      `Signed message: ${what} is not a JSON object`,
    );
  }
  return value;
}

function toPublicKey(key: SignedMessageVerifyKey): KeyObject {
  if (key instanceof X509Certificate) return key.publicKey;
  if (typeof key === "string") {
    return key.includes("BEGIN CERTIFICATE")
      ? new X509Certificate(key).publicKey
      : createPublicKey(key);
  }
  return key.type === "private" ? createPublicKey(key) : key;
}

function securityError(message: string) {
  return createRPCError("SecurityError", `Signed message: ${message}`);
}

/** Wraps a payload in its signed form (§7.1). */
async function seal(
  config: ResolvedOptions,
  signer: SignedMessageSigner,
  payload: JsonValue,
  action: string,
  messageType: number,
): Promise<FlattenedJws> {
  const header: { [key: string]: JsonValue } = {
    alg: signer.algorithm,
    OCPPAction: action,
    [config.messageTypeHeader]: messageType,
  };
  if (signer.thumbprint) header["x5t#S256"] = signer.thumbprint;

  const protectedPart = Buffer.from(JSON.stringify(header)).toString(
    "base64url",
  );
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = await signer.sign(
    Buffer.from(`${protectedPart}.${payloadPart}`, "ascii"),
  );
  if (signer.algorithm === "ES256" && signature.length !== 64) {
    throw new Error(
      `An ES256 signature is 64 bytes, R || S (RFC 7518 §3.4); the signer returned ${signature.length}. DER-encoded?`,
    );
  }
  return {
    protected: protectedPart,
    payload: payloadPart,
    signature: signature.toString("base64url"),
  };
}

/**
 * Extracts the message from its signed form (§7.2), checking the signature
 * first when there is a `verify` lookup.
 */
async function open(
  config: ResolvedOptions,
  jws: JsonValue,
  action: string,
  messageType: number,
): Promise<{ [key: string]: JsonValue }> {
  if (!isFlattenedJws(jws)) {
    throw createRPCError(
      "FormatViolation",
      "Signed message: the payload is not a Flattened JWS",
    );
  }
  const header = decodeObject(jws.protected, "the protected header");
  const payload = decodeObject(jws.payload, "the payload");
  if (!config.verify) return payload;

  const alg = header.alg;
  if (typeof alg !== "string" || !isAlgorithm(alg)) {
    throw securityError(
      `alg ${JSON.stringify(alg)} is not ES256, RS256 or RS384`,
    );
  }
  // RFC 7515 §4.1.11: an unknown critical header voids the signature, and
  // OCPP defines none.
  const crit = header.crit;
  if (crit !== undefined && !(Array.isArray(crit) && crit.length === 0)) {
    throw securityError("critical header parameters are not supported");
  }
  // Binds the signature to this frame: a signature lifted from another
  // action or message type does not verify here.
  if (header.OCPPAction !== action) {
    throw securityError(
      `the header is for ${JSON.stringify(header.OCPPAction)}, not ${action}`,
    );
  }
  const type = header.OCPPMessageTypedId ?? header.OCPPMessageTypeId;
  if (type !== messageType) {
    throw securityError(
      `the header is for message type ${JSON.stringify(type)}, not ${messageType}`,
    );
  }

  const found = await config.verify({
    ...header,
    alg,
    OCPPAction: action,
  });
  if (found === undefined) {
    throw securityError(
      `no key to verify it (x5t#S256 ${JSON.stringify(header["x5t#S256"] ?? null)})`,
    );
  }
  const key = toPublicKey(found);
  try {
    assertKeyFits(key, alg);
  } catch (err) {
    throw securityError((err as Error).message);
  }
  const valid = cryptoVerify(
    HASH[alg],
    Buffer.from(`${jws.protected}.${jws.payload}`, "ascii"),
    alg === "ES256" ? { key, dsaEncoding: "ieee-p1363" } : key,
    Buffer.from(jws.signature, "base64url"),
  );
  if (!valid) throw securityError("the signature does not verify");
  return payload;
}

function createMiddleware(
  client: Pick<OCPPClient, "protocol">,
  config: ResolvedOptions,
): MiddlewareFunction<MiddlewareContext> {
  // Requests that arrived signed, awaiting this side's reply (§7.2), and
  // calls this side signed, awaiting the peer's. Bounded: a NOREPLY handler
  // or an unanswered call never clears its entry.
  const signedRequests = new Set<string>();
  const signedCalls = new Set<string>();
  const remember = (ids: Set<string>, id: string) => {
    ids.add(id);
    if (ids.size > MAX_TRACKED_IDS) {
      ids.delete(ids.values().next().value as string);
    }
  };

  return async (ctx, next) => {
    if (!SIGNED_PROTOCOLS.has(client.protocol ?? "")) return next();

    // Parsed from JSON on the way in, and JSON-serialized on the way out.
    switch (ctx.type) {
      case "incoming_call": {
        const messageType = ctx.unconfirmed
          ? MessageType.SEND
          : MessageType.CALL;
        if (ctx.method.endsWith(SIGNED_SUFFIX)) {
          const action = ctx.method.slice(0, -SIGNED_SUFFIX.length);
          ctx.params = await open(
            config,
            ctx.params as JsonValue,
            action,
            messageType,
          );
          ctx.method = action;
          if (config.signer && !ctx.unconfirmed) {
            remember(signedRequests, ctx.messageId);
          }
        } else if (config.mustBeSigned(ctx.method)) {
          throw securityError(`${ctx.method} must be signed`);
        }
        break;
      }
      case "outgoing_result": {
        if (signedRequests.delete(ctx.messageId) && config.signer) {
          ctx.payload = await seal(
            config,
            config.signer,
            ctx.payload as JsonValue,
            ctx.method,
            MessageType.CALLRESULT,
          );
        }
        break;
      }
      case "outgoing_error":
        signedRequests.delete(ctx.messageId);
        break;
      case "outgoing_call": {
        if (config.signer && config.shouldSign(ctx.method)) {
          ctx.params = await seal(
            config,
            config.signer,
            ctx.params as JsonValue,
            ctx.method,
            ctx.unconfirmed ? MessageType.SEND : MessageType.CALL,
          );
          ctx.method = `${ctx.method}${SIGNED_SUFFIX}`;
          if (!ctx.unconfirmed) remember(signedCalls, ctx.messageId);
        }
        break;
      }
      case "incoming_result": {
        const signedCall = signedCalls.delete(ctx.messageId);
        const payload = ctx.payload as JsonValue;
        if (signedCall && isFlattenedJws(payload)) {
          ctx.payload = await open(
            config,
            payload,
            ctx.method,
            MessageType.CALLRESULT,
          );
        } else if (signedCall && config.mustBeSigned(ctx.method)) {
          throw securityError(`the reply to ${ctx.method} must be signed`);
        }
        break;
      }
      case "incoming_error":
        signedCalls.delete(ctx.messageId);
        break;
    }
    return next();
  };
}

/**
 * Signed messages (OCPP 2.0.1 / 2.1 Part 4 chapter 7) for the server's charger
 * connections. Received `<Action>-Signed` messages are unwrapped before
 * validation and routing (§7.2) and, with `verify`, checked first; `sign`
 * picks the calls to send signed, and replies to signed requests are signed
 * (§7.2). Applies to ocpp2.0.1 and ocpp2.1 connections; others pass through.
 *
 * Node only: it uses `node:crypto`.
 *
 * @example
 * server.plugin(signedMessagesPlugin({
 *   privateKey: csmsKeyPem,
 *   certificate: csmsCertPem,
 *   sign: ["SetChargingProfile"],
 *   verify: (header) => certificatesByThumbprint.get(header["x5t#S256"] ?? ""),
 * }));
 */
export function signedMessagesPlugin(
  options: SignedMessagesOptions,
): OCPPPlugin {
  const config = resolveOptions(options);
  return {
    name: "signed-messages",
    onConnection(client) {
      client.use(createMiddleware(client, config));
    },
  };
}

/**
 * The same as {@link signedMessagesPlugin}, for a Node client (a charging
 * station): `client.use(signedMessagesMiddleware(client, options))`.
 */
export function signedMessagesMiddleware(
  client: Pick<OCPPClient, "protocol">,
  options: SignedMessagesOptions,
): MiddlewareFunction<MiddlewareContext> {
  return createMiddleware(client, resolveOptions(options));
}
