import { OCPPTranslator } from "./core/translator.js";
import {
  type IConnection,
  type ITransportAdapter,
  MessageType,
  type OCPPMessage,
  type TranslationMap,
} from "./core/types.js";

export interface OCPPProtocolProxyOptions {
  upstreamEndpoint: string;
  upstreamProtocol: string;
}

export class OCPPProtocolProxy {
  private translator: OCPPTranslator;
  private clients: Map<string, IConnection> = new Map();
  // We need to keep track of connections connecting to the upstream CSMS
  // In a real generic architecture, we might have an UpstreamConnectionFactory
  // For Phase 1 backward compatibility, we'll keep hardcoding the ocpp-ws-io upstream client here,
  // or define a generic way to spawn upstreams.

  constructor(private options: OCPPProtocolProxyOptions) {
    this.translator = new OCPPTranslator({ upstream: {}, downstream: {} });
  }

  public translate(map: Partial<TranslationMap>) {
    this.translator.updateMap(map);
  }

  /**
   * Attaches this proxy engine to any TransportAdapter (Node WS, AWS API Gateway, etc)
   */
  public async listenOnAdapter(adapter: ITransportAdapter): Promise<void> {
    await adapter.listen((connection) => this.handleNewConnection(connection));
  }

  private handleNewConnection(evseConnection: IConnection) {
    const identity = evseConnection.identity;
    const sourceProtocol = evseConnection.protocol;
    const targetProtocol = this.options.upstreamProtocol;

    // For Phase 1, we still depend slightly on ocpp-ws-io for the upstream connection
    // to pass tests. We'll extract this later to an UpstreamAdapter factory.
    // Dynamic import to avoid bleeding ws dependency if not used.
    import("ocpp-ws-io").then(({ OCPPClient }) => {
      const upstreamClient = new OCPPClient({
        endpoint: this.options.upstreamEndpoint,
        protocols: [targetProtocol],
        identity,
        strictMode: false,
      });

      this.clients.set(identity, upstreamClient as any);
      const connectionPromise = upstreamClient.connect();

      // Handle EVSE -> CSMS (Upstream CALLs)
      evseConnection.onMessage(async (msg) => {
        await connectionPromise; // wait until connected upstream

        if (msg.type === MessageType.CALL) {
          const translatedCall = await this.translator.translateUpstreamCall(
            msg,
            {
              identity,
              sourceProtocol,
              targetProtocol,
            },
          );

          // Forward to CSMS using the raw ocpp-ws-io client for Phase 1
          try {
            const rawResponse = await upstreamClient.call(
              translatedCall.action,
              translatedCall.payload,
            );

            // Create a synthetic CallResult
            const responseMsg: Extract<
              OCPPMessage,
              { type: MessageType.CALLRESULT }
            > = {
              type: MessageType.CALLRESULT,
              messageId: msg.messageId, // The result correlates back to the inbound EVSE call
              payload: rawResponse,
            };

            const translatedResponse =
              await this.translator.translateCallResult(
                responseMsg,
                translatedCall.action,
                { identity, sourceProtocol, targetProtocol },
              );

            return translatedResponse;
          } catch (err: any) {
            // In phase 2/3 we would run this through translateCallError
            const errMessage: Extract<
              OCPPMessage,
              { type: MessageType.CALLERROR }
            > = {
              type: MessageType.CALLERROR,
              messageId: msg.messageId,
              errorCode: "InternalError",
              errorDescription: err.message,
              errorDetails: {},
            };
            return errMessage;
          }
        }

        return undefined; // Not handling non-calls inbound yet
      });

      // Handle CSMS -> EVSE (Downstream CALLs)
      upstreamClient.handle(async (action: string, ctx: any) => {
        const downstreamCall: Extract<OCPPMessage, { type: MessageType.CALL }> =
          {
            type: MessageType.CALL,
            messageId: "csms-call",
            action,
            payload: ctx.params,
          };

        const translated = await this.translator.translateDownstreamCall(
          downstreamCall,
          {
            identity,
            sourceProtocol,
            targetProtocol,
          },
        );

        // Send to EVSE and get the result
        const evseResponse = await evseConnection.send(translated);

        if (evseResponse && evseResponse.type === MessageType.CALLRESULT) {
          // For phase 1, we pass the raw payload back since there's no down-mapping for SetChargingProfileResponse usually
          // We could map it using translateCallResult if presets supported down-mapping responses.
          const mappedResponse = await this.translator.translateCallResult(
            evseResponse as Extract<
              OCPPMessage,
              { type: MessageType.CALLRESULT }
            >,
            downstreamCall.action,
            { identity, sourceProtocol, targetProtocol },
          );
          return mappedResponse.payload;
        }
      });

      evseConnection.onClose(() => {
        upstreamClient.close();
        this.clients.delete(identity);
      });
    });
  }

  public async close() {
    for (const client of this.clients.values()) {
      (client as any).close();
    }
  }
}
