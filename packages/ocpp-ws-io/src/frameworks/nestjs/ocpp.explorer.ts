import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DiscoveryService, MetadataScanner } from "@nestjs/core";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper.js";
import type { MiddlewareFunction } from "../../middleware.js";
import type { OCPPServer } from "../../server.js";
import type { OCPPServerClient } from "../../server-client.js";
import type {
  CORSOptions,
  HandshakeInfo,
  MiddlewareContext,
  RoutesByArgs,
} from "../../types.js";
import {
  OCPP_AUTH_METADATA,
  OCPP_CONNECTION_MIDDLEWARE_METADATA,
  OCPP_CORS_METADATA,
  OCPP_GATEWAY_METADATA,
  OCPP_MESSAGE_EVENT_METADATA,
  OCPP_RPC_MIDDLEWARE_METADATA,
  OCPP_WILDCARD_EVENT_METADATA,
  PARAM_ARGS_METADATA,
} from "./constants.js";
import type { OcppMessageEventMetadata } from "./decorators/method.decorators.js";
import {
  type OcppGatewayOptions,
  type OcppParamMetadata,
  OcppParamType,
  type OnOcppClientConnected,
  type OnOcppClientDisconnected,
  type OnOcppClientError,
} from "./interfaces.js";
import type { OcppService } from "./ocpp.service.js";

/**
 * A gateway provider as the explorer reads it: the lifecycle hooks it may
 * have, and its methods by name.
 */
type GatewayInstance = Partial<
  OnOcppClientConnected & OnOcppClientDisconnected & OnOcppClientError
> & {
  readonly constructor: object;
  readonly [key: string]: unknown;
};

/** A gateway method: called with what its parameter decorators select. */
type GatewayMethod = (this: GatewayInstance, ...args: unknown[]) => unknown;

function isGatewayMethod(value: unknown): value is GatewayMethod {
  return typeof value === "function";
}

/**
 * What a gateway method's parameter decorators read, from the context it is
 * called with: a connection middleware's, an auth callback's or a message
 * handler's. Each reads what its context has.
 */
interface GatewayContext {
  client?: OCPPServerClient;
  handshake?: HandshakeInfo;
  state?: Record<string, unknown>;
  message?: unknown;
  messageId?: string;
  method?: string;
  protocol?: string;
  params?: unknown;
  payload?: unknown;
}

@Injectable()
export class OcppExplorer implements OnModuleInit {
  private readonly logger = new Logger(OcppExplorer.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly server: OCPPServer,
    private readonly service?: OcppService,
  ) {}

  onModuleInit() {
    this.explore();
  }

  public explore() {
    const providers = this.discoveryService.getProviders();
    const gateways = providers.filter(
      (wrapper: InstanceWrapper) =>
        wrapper.metatype &&
        Reflect.hasMetadata(OCPP_GATEWAY_METADATA, wrapper.metatype),
    );

    gateways.forEach((wrapper: InstanceWrapper) => {
      // A provider's instance, as Nest gives it.
      const instance: GatewayInstance | undefined = wrapper.instance;
      const { metatype } = wrapper;
      if (!instance || !metatype) return;

      // Set by @OcppGateway() and @OcppCors().
      const gatewayOptions: OcppGatewayOptions | undefined =
        Reflect.getMetadata(OCPP_GATEWAY_METADATA, metatype);
      const corsOptions: CORSOptions | undefined = Reflect.getMetadata(
        OCPP_CORS_METADATA,
        metatype,
      );
      // Set by @UseOcppRpcMiddleware().
      const rpcMiddlewares:
        | MiddlewareFunction<MiddlewareContext>[]
        | undefined = Reflect.getMetadata(
        OCPP_RPC_MIDDLEWARE_METADATA,
        metatype,
      );

      // Create a router for this Gateway
      const path = gatewayOptions?.path;
      this.service?.registerUpgradePath(path);
      const router = path ? this.server.route(path) : this.server.route();

      // Apply CORS
      if (corsOptions) {
        router.cors(corsOptions);
      }

      // Apply Router Config Options (if any properties other than path exist)
      const configOpts = { ...gatewayOptions };
      delete configOpts.path;
      if (Object.keys(configOpts).length > 0) {
        router.config(configOpts);
      }

      // Lifecycle Hooks and RPC Middleware (Applied via client event)
      const hasConnectedHook =
        typeof instance.onOcppClientConnected === "function";
      const hasDisconnectedHook =
        typeof instance.onOcppClientDisconnected === "function";
      const hasErrorHook = typeof instance.onOcppClientError === "function";

      if (
        hasConnectedHook ||
        hasDisconnectedHook ||
        hasErrorHook ||
        rpcMiddlewares?.length
      ) {
        router.on("client", (client) => {
          if (rpcMiddlewares?.length) {
            for (const mw of rpcMiddlewares) {
              client.use(mw);
            }
          }
          if (hasConnectedHook) {
            instance.onOcppClientConnected?.(client);
          }
          if (hasDisconnectedHook) {
            client.on("close", (args) => {
              instance.onOcppClientDisconnected?.(
                client,
                args?.code ?? 1000,
                args?.reason ? args.reason.toString() : "",
              );
            });
          }
          if (hasErrorHook) {
            client.on("error", (err) => {
              instance.onOcppClientError?.(client, err);
            });
          }
        });
      }

      // Scan all methods in the Gateway
      this.metadataScanner.scanFromPrototype(
        instance,
        Object.getPrototypeOf(instance),
        (key: string) => {
          const method = instance[key];
          if (!isGatewayMethod(method)) return;

          // 1. Connection Middleware
          if (
            Reflect.hasMetadata(OCPP_CONNECTION_MIDDLEWARE_METADATA, method)
          ) {
            router.use(async (ctx) => {
              await this.executeWithParams(instance, method, key, ctx);
            });
            this.logger.log(
              `Mapped Connection Middleware: ${metatype.name}.${key}`,
            );
          }

          // 2. Auth Handler
          if (Reflect.hasMetadata(OCPP_AUTH_METADATA, method)) {
            router.auth(async (ctx) => {
              await this.executeWithParams(instance, method, key, ctx);
            });
            this.logger.log(`Mapped Auth Handler: ${metatype.name}.${key}`);
          }

          // 3. Message Event Handlers
          // Set by @OcppMessageEvent(), which checks the action's name; the
          // method's answer goes back as the response, as the route's
          // implementation takes it (RoutesByArgs).
          const messageEvent: OcppMessageEventMetadata | undefined =
            Reflect.getMetadata(OCPP_MESSAGE_EVENT_METADATA, method);
          if (messageEvent) {
            const { action, protocol } = messageEvent;
            const handler = (ctx: GatewayContext) =>
              this.executeWithParams(instance, method, key, ctx);
            const routes: RoutesByArgs = router;

            if (protocol) {
              routes.handle(protocol, action, handler);
              this.logger.log(
                `Mapped RPC Event: ${action} (${protocol}) -> ${metatype.name}.${key}`,
              );
            } else {
              routes.handle(action, handler);
              this.logger.log(
                `Mapped RPC Event: ${action} -> ${metatype.name}.${key}`,
              );
            }
          }

          // 4. Wildcard Handlers
          if (Reflect.hasMetadata(OCPP_WILDCARD_EVENT_METADATA, method)) {
            router.handle((ctx) =>
              this.executeWithParams(instance, method, key, {
                ...ctx,
                method: ctx?.method,
              }),
            );
            this.logger.log(`Mapped Wildcard Event -> ${metatype.name}.${key}`);
          }
        },
      );
    });
  }

  private async executeWithParams(
    instance: GatewayInstance,
    method: GatewayMethod,
    key: string,
    ctx: GatewayContext,
  ): Promise<unknown> {
    // Look up param metadata by the property key the decorator stored it under.
    // (Using `method.name` would break for bound/renamed methods.)
    const paramsMetadata: Record<string, unknown> =
      Reflect.getMetadata(PARAM_ARGS_METADATA, instance.constructor, key) || {};

    // Determine the max parameter index to initialize the array length
    const maxIndex = Math.max(-1, ...Object.keys(paramsMetadata).map(Number));
    const args: unknown[] = new Array(maxIndex + 1).fill(undefined);

    // If there are no parameter decorators, just pass the context as the first argument
    if (Object.keys(paramsMetadata).length === 0) {
      args[0] = ctx;
    } else {
      for (const [indexStr, rawMetadata] of Object.entries(paramsMetadata)) {
        const index = Number(indexStr);
        const metadata = this.normalizeParamMetadata(rawMetadata);
        const handshake = ctx.handshake ?? ctx.client?.handshake;
        switch (metadata.type) {
          case OcppParamType.CLIENT:
            args[index] = ctx.client;
            break;
          case OcppParamType.MESSAGE:
            args[index] = ctx.message || {
              messageId: ctx.messageId,
              method: ctx.method,
              protocol: ctx.protocol,
              params: ctx.params,
            };
            break;
          case OcppParamType.PARAMS:
            args[index] = ctx.params ?? ctx.payload;
            break;
          case OcppParamType.CONTEXT:
            args[index] = ctx;
            break;
          case OcppParamType.IDENTITY:
            args[index] = ctx.client?.identity ?? handshake?.identity;
            break;
          case OcppParamType.PATH:
            args[index] = handshake?.pathname;
            break;
          case OcppParamType.SESSION:
            args[index] = ctx.client?.session ?? ctx.state;
            break;
          case OcppParamType.PATH_PARAMS:
            args[index] = metadata.data
              ? handshake?.params?.[metadata.data]
              : handshake?.params;
            break;
          case OcppParamType.PROTOCOL:
            args[index] =
              ctx.protocol ?? ctx.client?.protocol ?? handshake?.protocols;
            break;
          case OcppParamType.MESSAGE_ID:
            args[index] = ctx.messageId;
            break;
          case OcppParamType.HANDSHAKE:
            args[index] = handshake;
            break;
        }
      }
    }

    return method.apply(instance, args);
  }

  private normalizeParamMetadata(raw: unknown): OcppParamMetadata {
    if (typeof raw === "number") {
      return { type: raw as OcppParamType };
    }

    return raw as OcppParamMetadata;
  }
}
