import type { OCPPClient, OCPPServer } from "ocpp-ws-io";
import {
  type IConnection,
  type ITransportAdapter,
  MessageType,
  type OCPPMessage,
} from "../core/types.js";

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
    this.client.handle(async (action: string, ctx: any) => {
      const incomingMessage: OCPPMessage = {
        type: MessageType.CALL,
        messageId: ctx.messageId || `msg-${Date.now()}`,
        action: action,
        payload: ctx.params,
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
          const err = new Error(
            result.errorDescription ||
              "Unknown error occurred during proxy processing",
          );
          (err as any).code = result.errorCode;
          throw err;
        }
      }
      return {};
    });
  }

  public async send(message: OCPPMessage): Promise<OCPPMessage | undefined> {
    if (message.type === MessageType.CALL) {
      const rawResult = await this.client.call(message.action, message.payload);
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
  public httpServer?: any;

  constructor(options: WsAdapterOptions) {
    this.port = options.port;
    this.protocols = options.protocols;
  }

  public async listen(
    onConnection: (connection: IConnection) => void,
  ): Promise<void> {
    // Dynamic import for ESM consistency — avoids require() in ESM packages
    const { OCPPServer } = await import("ocpp-ws-io");
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
