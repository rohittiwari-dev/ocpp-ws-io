import { EventEmitter } from "node:events";
import type { ISessionStore } from "./core/session.js";
import { InMemorySessionStore } from "./core/session.js";
import { OCPPTranslator } from "./core/translator.js";
import {
  type IConnection,
  type ITransportAdapter,
  MessageType,
  type MiddlewareDirection,
  type MiddlewarePhase,
  type OCPPMessage,
  type ProxyMiddleware,
  type TranslationContext,
  type TranslationMap,
} from "./core/types.js";

export interface OCPPProtocolProxyOptions {
  upstreamEndpoint: string;
  upstreamProtocol: string;
  sessionStore?: ISessionStore;
  middlewares?: ProxyMiddleware[];
}

export class OCPPProtocolProxy extends EventEmitter {
  private translator: OCPPTranslator;
  private clients: Map<string, any> = new Map();
  private sessionStore: ISessionStore;
  private adapters: ITransportAdapter[] = [];

  constructor(private options: OCPPProtocolProxyOptions) {
    super();
    this.translator = new OCPPTranslator({ upstream: {}, downstream: {} });
    this.sessionStore = options.sessionStore || new InMemorySessionStore();
  }

  /** Register translation maps (can be called multiple times to layer presets). */
  public translate(map: Partial<TranslationMap>) {
    this.translator.updateMap(map);
  }

  /** Start listening on a transport adapter (WS, HTTP, etc.). */
  public async listenOnAdapter(adapter: ITransportAdapter): Promise<void> {
    this.adapters.push(adapter);
    await adapter.listen((connection) => this.handleNewConnection(connection));
  }

  /**
   * Execute all registered middlewares sequentially.
   * If a middleware returns a message, it replaces the current message.
   */
  private async executeMiddlewares(
    message: OCPPMessage,
    context: TranslationContext,
    direction: MiddlewareDirection,
    phase: MiddlewarePhase,
  ): Promise<OCPPMessage> {
    let currentMsg = message;
    for (const mw of this.options.middlewares || []) {
      try {
        const result = await mw(currentMsg, context, direction, phase);
        if (result) {
          currentMsg = result;
        }
      } catch (err) {
        this.emit("middlewareError", err, currentMsg, context);
      }
    }
    return currentMsg;
  }

  private handleNewConnection(evseConnection: IConnection) {
    const identity = evseConnection.identity;
    const sourceProtocol = evseConnection.protocol;
    const targetProtocol = this.options.upstreamProtocol;

    const context: TranslationContext = {
      identity,
      sourceProtocol,
      targetProtocol,
      session: this.sessionStore,
    };

    this.emit("connection", identity, sourceProtocol);

    import("ocpp-ws-io").then(({ OCPPClient }) => {
      const upstreamClient = new OCPPClient({
        endpoint: this.options.upstreamEndpoint,
        protocols: [targetProtocol],
        identity,
        strictMode: false,
      });

      this.clients.set(identity, upstreamClient);
      const connectionPromise = upstreamClient.connect();

      // ─── EVSE -> CSMS (Upstream) ───
      evseConnection.onMessage(async (msg) => {
        await connectionPromise;

        if (msg.type === MessageType.CALL) {
          try {
            // Pre-middleware
            const preMsg = await this.executeMiddlewares(
              msg,
              context,
              "upstream",
              "pre",
            );

            // Translate
            const translatedCall = await this.translator.translateUpstreamCall(
              preMsg as Extract<OCPPMessage, { type: MessageType.CALL }>,
              context,
            );

            // Post-middleware
            const postMsg = await this.executeMiddlewares(
              translatedCall,
              context,
              "upstream",
              "post",
            );

            // Forward to CSMS
            const rawResponse = await upstreamClient.call(
              (postMsg as any).action,
              (postMsg as any).payload,
            );

            const responseMsg: Extract<
              OCPPMessage,
              { type: MessageType.CALLRESULT }
            > = {
              type: MessageType.CALLRESULT,
              messageId: msg.messageId,
              payload: rawResponse,
            };

            // Pre-response middleware
            const preResMsg = await this.executeMiddlewares(
              responseMsg,
              context,
              "response",
              "pre",
            );

            // Translate response
            const translatedResponse =
              await this.translator.translateCallResult(
                preResMsg as Extract<
                  OCPPMessage,
                  { type: MessageType.CALLRESULT }
                >,
                translatedCall.action,
                context,
              );

            // Post-response middleware
            return await this.executeMiddlewares(
              translatedResponse,
              context,
              "response",
              "post",
            );
          } catch (err: any) {
            const errMessage: Extract<
              OCPPMessage,
              { type: MessageType.CALLERROR }
            > = {
              type: MessageType.CALLERROR,
              messageId: msg.messageId,
              errorCode: err.code || "InternalError",
              errorDescription: err.message,
              errorDetails: {},
            };

            this.emit("translationError", err, msg, context);
            return await this.executeMiddlewares(
              errMessage,
              context,
              "error",
              "post",
            );
          }
        }
        return undefined;
      });

      // ─── CSMS -> EVSE (Downstream) ───
      upstreamClient.handle(async (action: string, ctx: any) => {
        const downstreamCall: Extract<OCPPMessage, { type: MessageType.CALL }> =
          {
            type: MessageType.CALL,
            messageId: ctx.messageId || `csms-${Date.now()}`,
            action,
            payload: ctx.params,
          };

        try {
          const preMsg = await this.executeMiddlewares(
            downstreamCall,
            context,
            "downstream",
            "pre",
          );

          const translated = await this.translator.translateDownstreamCall(
            preMsg as Extract<OCPPMessage, { type: MessageType.CALL }>,
            context,
          );

          const postMsg = await this.executeMiddlewares(
            translated,
            context,
            "downstream",
            "post",
          );

          const evseResponse = await evseConnection.send(postMsg);

          if (evseResponse && evseResponse.type === MessageType.CALLRESULT) {
            const preResMsg = await this.executeMiddlewares(
              evseResponse,
              context,
              "response",
              "pre",
            );

            const mappedResponse = await this.translator.translateCallResult(
              preResMsg as Extract<
                OCPPMessage,
                { type: MessageType.CALLRESULT }
              >,
              downstreamCall.action,
              context,
            );

            const postResMsg = await this.executeMiddlewares(
              mappedResponse,
              context,
              "response",
              "post",
            );
            return (postResMsg as any).payload;
          }
        } catch (err) {
          this.emit("translationError", err, downstreamCall, context);
          throw err;
        }
      });

      // ─── Cleanup on disconnect ───
      evseConnection.onClose(() => {
        upstreamClient.close();
        this.sessionStore.clear(identity);
        this.clients.delete(identity);
        this.emit("disconnect", identity);
      });
    });
  }

  /** Gracefully close all upstream connections and adapters. */
  public async close() {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // Swallow close errors
      }
    }
    this.clients.clear();

    for (const adapter of this.adapters) {
      await adapter.close();
    }
    this.adapters = [];
  }
}
