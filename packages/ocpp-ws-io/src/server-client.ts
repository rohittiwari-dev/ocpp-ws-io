import type { WebSocket } from "ws";
import { OCPPClient } from "./client.js";
import {
  type ClientOptions,
  ConnectionState,
  type HandshakeInfo,
} from "./types.js";

/**
 * OCPPServerClient — A server-side client representation.
 *
 * Created by OCPPServer when a charging station connects.
 * Extends OCPPClient but is pre-connected (cannot call connect()).
 */
export class OCPPServerClient extends OCPPClient {
  private _serverSession: Record<string, unknown>;
  private _serverHandshake: HandshakeInfo;

  constructor(
    options: ClientOptions,
    context: {
      ws: WebSocket;
      handshake: HandshakeInfo;
      session: Record<string, unknown>;
      protocol?: string;
    },
  ) {
    super(options);

    this._serverSession = context.session;
    this._serverHandshake = context.handshake;

    // Set state to OPEN directly (already connected via server)
    this._state = ConnectionState.OPEN;
    this._identity = this._options.identity;
    this._ws = context.ws;
    this._protocol = context.protocol ?? context.ws.protocol;

    // Attach WebSocket handlers
    this._attachWebsocket(context.ws);
  }

  /**
   * Session data associated with this client connection.
   */
  get session(): Record<string, unknown> {
    return this._serverSession;
  }

  /**
   * Handshake information from the initial connection.
   */
  get handshake(): HandshakeInfo {
    return this._serverHandshake;
  }

  /**
   * Server clients cannot initiate connections.
   * @throws Always throws — use OCPPClient for outbound connections.
   */
  override async connect(): Promise<never> {
    throw new Error(
      "Cannot connect from server client — connection is managed by the server",
    );
  }
}
