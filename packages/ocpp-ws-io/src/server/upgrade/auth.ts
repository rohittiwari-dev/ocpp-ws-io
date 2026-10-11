import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { HandshakeRejection } from "../../core/errors.js";
import { abortHandshake } from "../../core/ws-util.js";
import type {
  AuthAccept,
  AuthCallback,
  AuthContext,
  ConnectionContext,
  ConnectionMiddleware,
} from "../../types/auth.js";
import type { HandshakeInfo, IdentityLookup } from "../../types/handshake.js";
import type { SessionData } from "../../types/session.js";
import { executeMiddlewareChain } from "../router.js";
import type { UpgradeContext } from "./context.js";

/** RFC 9110 §15.5.2: every 401 carries a challenge; OCPP uses Basic Auth. */
export const BASIC_AUTH_CHALLENGE = 'Basic realm="ocpp-ws-io", charset="UTF-8"';

/** A handshake past the route, identity and credential checks. */
export interface AuthRequest {
  readonly req: IncomingMessage;
  readonly socket: Duplex;
  readonly handshake: HandshakeInfo;
  readonly identity: string;
  readonly pathname: string;
  /** The subprotocols the charger offered. */
  readonly protocols: Set<string>;
  /** The protocol negotiation chose; accept({ protocol }) can change it. */
  readonly selectedProtocol: string | undefined;
  readonly authCallback: AuthCallback | undefined;
  readonly middlewares: readonly ConnectionMiddleware[];
  readonly isKnownIdentity: IdentityLookup | undefined;
}

/** What auth settled on for a connection it let through. */
export interface AuthOutcome {
  /** The middleware context; its state seeds the session. */
  readonly ctx: ConnectionContext | undefined;
  /** What the auth callback passed to accept(). */
  readonly acceptOptions: AuthAccept | undefined;
  readonly selectedProtocol: string | undefined;
  /** accept() chose a protocol the charger did not offer. */
  readonly protocolRefused: boolean;
}

/**
 * Run the identity lookup, the middleware and the auth callback, under the
 * handshake timeout and aborted if the socket goes. Null when the handshake
 * ended there: refused, failed or abandoned, with its socket answered or
 * destroyed.
 */
export async function authenticate(
  server: UpgradeContext,
  {
    req,
    socket,
    handshake,
    identity,
    pathname,
    protocols,
    selectedProtocol: negotiatedProtocol,
    authCallback: matchedHandler,
    middlewares: matchedMiddlewares,
    isKnownIdentity,
  }: AuthRequest,
): Promise<AuthOutcome | null> {
  let ctx: ConnectionContext | undefined;
  let acceptOptions: AuthAccept | undefined;
  let selectedProtocol = negotiatedProtocol;
  let protocolRefused = false;

  const ac = new AbortController();

  // Socket lifecycle → abort on premature close / error
  const onSocketGone = () => {
    ac.abort(new Error("Socket closed during handshake"));
  };
  socket.on("close", onSocketGone);
  socket.on("error", onSocketGone);
  socket.on("end", onSocketGone);

  // Handshake timeout guard
  const timeoutMs = server.handshakeTimeoutMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      ac.abort(new Error("Handshake timeout"));
    }, timeoutMs);
  }

  try {
    ctx = {
      handshake,
      state: {},
      reject: (code = 401, message = "Unauthorized") => {
        throw new HandshakeRejection(code, message);
      },
      next: async (_payload?: SessionData) => {}, // Bound dynamically inside executeMiddlewareChain
    };

    const chain = [...matchedMiddlewares];
    let authCalled = false;

    // OCPP-J §3.2: an identity the CSMS does not recognize SHOULD get 404.
    // First in the chain, so middleware and auth never see one, and inside
    // it, so the handshake timeout and socket-close abort apply.
    if (isKnownIdentity) {
      chain.unshift(async (c) => {
        const aborted = new Promise<never>((_, reject) => {
          ac.signal.addEventListener("abort", () => reject(ac.signal.reason), {
            once: true,
          });
        });
        // Settles after the lookup when the handshake ends later on.
        aborted.catch(() => {});
        // A lookup that throws is an outage, not an unknown charger: it
        // reaches the catch below, which logs it and answers 500.
        const known = await Promise.race([
          Promise.resolve(isKnownIdentity(identity, c.handshake)),
          aborted,
        ]);
        if (!known) {
          c.reject(404, "Unknown charging station");
          return;
        }
        await c.next();
      });
    }

    // Push the Auth check as the terminal handler of the middleware chain
    chain.push(async (c) => {
      authCalled = true;
      // Without an auth callback the negotiated protocol stands. This used
      // to take the charger's first offer, so with middleware but no auth
      // callback a server could end up speaking a version it does not
      // support.
      if (matchedHandler) {
        acceptOptions = await new Promise<AuthAccept | undefined>(
          (resolve, reject) => {
            let settled = false;

            const accept = (opts?: AuthAccept) => {
              if (settled) return;
              settled = true;
              if (opts?.protocol) {
                // RFC 6455 §4.2.2: the server may only pick a protocol
                // the client offered; the client fails any other.
                if (protocols.has(opts.protocol)) {
                  selectedProtocol = opts.protocol;
                } else {
                  server.logger?.warn?.(
                    "accept() chose a subprotocol the charger did not offer",
                    { identity, protocol: opts.protocol },
                  );
                  selectedProtocol = undefined;
                  protocolRefused = true;
                }
              }
              resolve(opts);
            };

            const rejectAuth = (
              code = 401,
              message = "Unauthorized",
            ): never => {
              const rejection = new HandshakeRejection(code, message);
              if (!settled) {
                settled = true;
                reject(rejection);
              }
              throw rejection;
            };

            // Guard: already aborted before we even start
            if (ac.signal.aborted) {
              reject(ac.signal.reason);
              return;
            }

            ac.signal.addEventListener(
              "abort",
              () => {
                if (!settled) {
                  settled = true;
                  reject(ac.signal.reason);
                }
              },
              { once: true },
            );

            server.logger?.debug?.("Executing auth callback", {
              identity,
              pathname,
            });

            const authCtx: AuthContext = {
              handshake,
              state: c.state,
              reject: rejectAuth,
              signal: ac.signal,
              accept,
            };

            // Awaited, so an async callback's failure is handled here: the
            // promise it returns used to be dropped, so a throw, or the
            // throw inside reject(), was an unhandled rejection that ended
            // the process.
            const callback = matchedHandler!;
            const run = async () => {
              try {
                await callback(authCtx);
              } catch (err) {
                if (!settled) {
                  settled = true;
                  reject(err);
                } else if (!(err instanceof HandshakeRejection)) {
                  server.logger?.error?.(
                    "Auth callback threw after accepting or rejecting",
                    {
                      identity,
                      error: err instanceof Error ? err.message : String(err),
                    },
                  );
                }
              }
            };
            void run();
          },
        );
      }
    });

    // Execute dynamic middleware pipeline
    await executeMiddlewareChain(chain, ctx);

    if (!authCalled) {
      throw new Error(
        "Connection middleware ended without calling next() or reject()",
      );
    }
  } catch (err) {
    if (ac.signal.aborted) {
      const reason = err instanceof Error ? err.message : "Unknown abort";
      server.logger?.warn?.("Handshake aborted", {
        identity,
        reason,
      });
      // Emit security event for upgrade aborts
      const secEvtAbort = {
        type: "UPGRADE_ABORTED" as const,
        identity,
        ip: req.socket.remoteAddress,
        timestamp: new Date().toISOString(),
        details: { reason },
      };
      server.emitSecurityEvent(secEvtAbort);
      server.emitUpgradeAborted({
        identity,
        reason,
        socket,
        request: req,
      });
      if (!socket.destroyed) socket.destroy();
      return null;
    }

    if (err instanceof HandshakeRejection) {
      // ctx.reject(code, message): the status and message the developer
      // chose. Only an HTTP error status can end a handshake.
      let code = err.code;
      if (!Number.isInteger(code) || code < 400 || code > 599) {
        server.logger?.warn?.(
          "reject() needs an HTTP status from 400 to 599; answered 500",
          { identity, code },
        );
        code = 500;
      }
      server.reportAuthFailure(handshake, req, code, err.message);
      abortHandshake(
        socket,
        code,
        err.message,
        code === 401 ? { "WWW-Authenticate": BASIC_AUTH_CHALLENGE } : undefined,
      );
      return null;
    }

    // Anything else thrown is a bug or an outage, not a verdict on the
    // charger. Its details stay in the server log: the charger gets a bare
    // 500, never a 401 it would record as FailedToAuthenticateAtCsms.
    server.reportUpgradeError(
      handshake,
      req,
      err instanceof Error ? err.message : String(err),
      err instanceof Error ? err.stack : undefined,
    );
    abortHandshake(socket, 500);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    socket.removeListener("close", onSocketGone);
    socket.removeListener("error", onSocketGone);
    socket.removeListener("end", onSocketGone);
  }

  return { ctx, acceptOptions, selectedProtocol, protocolRefused };
}
