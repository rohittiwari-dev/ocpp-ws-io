import type { Server } from "node:http";
import type { OCPPClient } from "../../client/client.js";
import type { RPCError } from "../../core/errors.js";
import { unchecked } from "../../core/unchecked.js";
import type { OCPPServer } from "../../server/server.js";
import {
  type IConnection,
  type ITransportAdapter,
  MessageType,
  type OCPPMessage,
  type ProxyPayload,
} from "../core/types.js";

/**
 * A CALLERROR the proxy answers the charger with. The library sends an RPC
 * error's own code and description; a plain Error went out as InternalError.
 */
class ProxiedCallError extends Error implements RPCError {
  readonly rpcErrorCode: string;
  readonly rpcErrorMessage: string;
  readonly details: ProxyPayload;

  constructor(code: string, description: string, details: ProxyPayload) {
    super(description);
    this.name = "ProxiedCallError";
    this.rpcErrorCode = code;
    this.rpcErrorMessage = description;
    this.details = details;
  }
}

export class OcppWsIoConnection implements IConnection {
  public identity: string;
  public protocol: string;
  private messageHandler?: (
    message: OCPPMessage,
  ) => Promise<OCPPMessage | undefined>;

  constructor(private client: OCPPClient) {
    this.identity = client.identity;
    this.protocol = client.protocol || "ocpp1.6";
    this.setupCatchAll();
  }

  private setupCatchAll() {
    this.client.handle(async (ctx) => {
      const incomingMessage: OCPPMessage = {
        type: MessageType.CALL,
        messageId: ctx.messageId || `msg-${Date.now()}`,
        action: ctx.method,
        // The library hands every handler a JSON object (OCPP-J §4.2).
        payload: ctx.params as ProxyPayload,
      };

      if (!this.messageHandler) {
        throw new Error("No message handler attached to connection");
      }

      const result = await this.messageHandler(incomingMessage);
      if (result) {
        if (result.type === MessageType.CALLRESULT) {
          return result.payload;
        }
        if (result.type === MessageType.CALLERROR) {
          throw new ProxiedCallError(
            result.errorCode,
            result.errorDescription ||
              "Unknown error occurred during proxy processing",
            result.errorDetails,
          );
        }
      }
      return {};
    });
  }

  public async send(message: OCPPMessage): Promise<OCPPMessage | undefined> {
    if (message.type === MessageType.CALL) {
      // Passed through from the other side: the action is not checked by type.
      const rawResult = await this.client.call(
        unchecked(message.action),
        message.payload,
      );
      return {
        type: MessageType.CALLRESULT,
        messageId: message.messageId,
        payload: rawResult,
      };
    }
    return undefined;
  }

  public onMessage(
    handler: (message: OCPPMessage) => Promise<OCPPMessage | undefined>,
  ): void {
    this.messageHandler = handler;
  }

  public onClose(handler: () => void): void {
    this.client.on("close", handler);
  }
}

export interface WsAdapterOptions {
  port: number;
  protocols: string[];
}

export class OcppWsIoAdapter implements ITransportAdapter {
  private server!: OCPPServer;
  private port: number;
  private protocols: string[];
  public httpServer?: Server;

  constructor(options: WsAdapterOptions) {
    this.port = options.port;
    this.protocols = options.protocols;
  }

  public async listen(
    onConnection: (connection: IConnection) => void,
  ): Promise<void> {
    // Loaded on listen, as when this adapter was its own package.
    const { OCPPServer } = await import("../../server/server.js");
    this.server = new OCPPServer({ protocols: this.protocols });

    this.server.on("client", (client: OCPPClient) => {
      const conn = new OcppWsIoConnection(client);
      onConnection(conn);
    });
    this.httpServer = await this.server.listen(this.port);
  }

  public async close(): Promise<void> {
    if (this.server) {
      await this.server.close();
    }
  }
}
