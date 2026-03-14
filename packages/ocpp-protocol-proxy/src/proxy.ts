import * as fs from "node:fs";
import { OCPPClient, OCPPServer } from "ocpp-ws-io";
export type TranslationResult = { action?: string; payload: any };

export type TranslationMap = {
  // EVSE -> CSMS
  upstream: Record<
    string,
    (
      params: any,
      context: {
        identity: string;
        sourceProtocol: string;
        targetProtocol: string;
      },
    ) => TranslationResult | Promise<TranslationResult>
  >;

  // CSMS -> EVSE
  downstream: Record<
    string,
    (
      params: any,
      context: {
        identity: string;
        sourceProtocol: string;
        targetProtocol: string;
      },
    ) => TranslationResult | Promise<TranslationResult>
  >;

  // Responses override
  responses?: Record<string, (params: any, context: any) => any>;
};

export interface OCPPProtocolProxyOptions {
  listenPort: number;
  listenProtocols: string[];
  upstreamEndpoint: string;
  upstreamProtocol: string;
}

export class OCPPProtocolProxy {
  private server: OCPPServer;
  private clients: Map<string, OCPPClient> = new Map();
  private translationMap: TranslationMap = { upstream: {}, downstream: {} };
  private options: OCPPProtocolProxyOptions;

  constructor(options: OCPPProtocolProxyOptions) {
    this.options = options;
    this.server = new OCPPServer({
      protocols: options.listenProtocols,
    });

    this.setupServerHooks();
  }

  public translate(map: Partial<TranslationMap>) {
    this.translationMap.upstream = {
      ...this.translationMap.upstream,
      ...map.upstream,
    };
    this.translationMap.downstream = {
      ...this.translationMap.downstream,
      ...map.downstream,
    };
    if (map.responses) {
      this.translationMap.responses = {
        ...this.translationMap.responses,
        ...map.responses,
      };
    }
  }

  private setupServerHooks() {
    this.server.on("client", async (evse) => {
      const identity = evse.identity;
      const sourceProtocol =
        evse.protocol ?? this.options.listenProtocols[0] ?? "ocpp1.6";
      const targetProtocol = this.options.upstreamProtocol;

      // Create an upstream client for this EVSE
      const upstreamClient = new OCPPClient({
        endpoint: this.options.upstreamEndpoint,
        protocols: [this.options.upstreamProtocol],
        identity,
        strictMode: false,
      });

      this.clients.set(identity, upstreamClient);

      // Start connection immediately and save the promise
      const connectionPromise = upstreamClient.connect();

      // Handle EVSE -> CSMS (Upstream CALLs)
      evse.handle(async (action, ctx) => {
        // Wait for proxy to connect to upstream before forwarding!
        await connectionPromise;

        try {
          const payload = ctx.params;
          const key = `${sourceProtocol}:${action}`;
          const mapper = this.translationMap.upstream[key];

          if (!mapper) {
            throw new Error(`No upstream translation found for ${key}`);
          }

          const translated = await mapper(payload, {
            identity,
            sourceProtocol,
            targetProtocol,
          });
          const targetAction = translated.action || action;

          // Forward to CSMS and wait for CALLRESULT
          const response = await upstreamClient.call(
            targetAction,
            translated.payload,
          );

          // Map the CALLRESULT back if there is a response mapper, otherwise pass it through
          const responseKey = `${targetProtocol}:${targetAction}Response`;
          const responseMapper = this.translationMap.responses?.[responseKey];

          if (responseMapper) {
            const translatedResponse = await responseMapper(response, {
              identity,
              sourceProtocol,
              targetProtocol,
            });
            return translatedResponse;
          }

          return response; // Automatic passthrough
        } catch (err: any) {
          fs.appendFileSync(
            "proxy-debug.log",
            `[Proxy Catch] ${err.message}\n${err.stack}\n`,
          );
          console.error(`[Proxy Error] Upstream handling ${action}:`, err);
          throw err;
        }
      });

      // Handle CSMS -> EVSE (Downstream CALLs)
      upstreamClient.handle(async (action, ctx) => {
        const payload = ctx.params;
        const key = `${targetProtocol}:${action}`;
        const mapper = this.translationMap.downstream[key];

        if (!mapper) {
          throw new Error(`No downstream translation found for ${key}`);
        }

        const translated = await mapper(payload, {
          identity,
          sourceProtocol,
          targetProtocol,
        });
        const targetAction = translated.action || action;

        // Forward to EVSE
        return await this.server.safeSendToClient(
          identity,
          sourceProtocol as any,
          targetAction,
          translated.payload,
        );
      });

      // Handle disconnects
      evse.on("close", () => {
        upstreamClient.close();
        this.clients.delete(identity);
      });
    });
  }

  public async listen() {
    await this.server.listen(this.options.listenPort);
  }

  public async close() {
    for (const client of this.clients.values()) {
      client.close();
    }
    await this.server.close();
  }
}
