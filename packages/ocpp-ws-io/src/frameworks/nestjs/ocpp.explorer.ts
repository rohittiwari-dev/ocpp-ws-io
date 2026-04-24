import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { DiscoveryService, MetadataScanner } from "@nestjs/core";
import type { InstanceWrapper } from "@nestjs/core/injector/instance-wrapper.js";
import type { OCPPServer } from "../../server.js";
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
import { OcppParamType } from "./interfaces.js";

@Injectable()
export class OcppExplorer implements OnModuleInit {
  private readonly logger = new Logger(OcppExplorer.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly server: OCPPServer,
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
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) return;

      const gatewayOptions = Reflect.getMetadata(
        OCPP_GATEWAY_METADATA,
        metatype,
      );
      const corsOptions = Reflect.getMetadata(OCPP_CORS_METADATA, metatype);
      const rpcMiddlewares = Reflect.getMetadata(
        OCPP_RPC_MIDDLEWARE_METADATA,
        metatype,
      );

      // Create a router for this Gateway
      const path = gatewayOptions?.path;
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
            for (const mw of rpcMiddlewares as any[]) {
              client.use(mw);
            }
          }
          if (hasConnectedHook) {
            instance.onOcppClientConnected(client);
          }
          if (hasDisconnectedHook) {
            client.on("close", (args: any) => {
              instance.onOcppClientDisconnected(
                client,
                args?.code ?? 1000,
                args?.reason ? args.reason.toString() : "",
              );
            });
          }
          if (hasErrorHook) {
            client.on("error", (err) => {
              instance.onOcppClientError(client, err);
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
          if (typeof method !== "function") return;

          // 1. Connection Middleware
          if (
            Reflect.hasMetadata(OCPP_CONNECTION_MIDDLEWARE_METADATA, method)
          ) {
            router.use((ctx: any) =>
              this.executeWithParams(instance, method, ctx),
            );
            this.logger.log(
              `Mapped Connection Middleware: ${metatype.name}.${key}`,
            );
          }

          // 2. Auth Handler
          if (Reflect.hasMetadata(OCPP_AUTH_METADATA, method)) {
            router.auth((ctx: any) =>
              this.executeWithParams(instance, method, ctx),
            );
            this.logger.log(`Mapped Auth Handler: ${metatype.name}.${key}`);
          }

          // 3. Message Event Handlers
          const messageEvent = Reflect.getMetadata(
            OCPP_MESSAGE_EVENT_METADATA,
            method,
          );
          if (messageEvent) {
            const { action, protocol } = messageEvent;
            const handler = (ctx: any) =>
              this.executeWithParams(instance, method, ctx);

            if (protocol) {
              router.handle(protocol, action, handler);
              this.logger.log(
                `Mapped RPC Event: ${action} (${protocol}) -> ${metatype.name}.${key}`,
              );
            } else {
              router.handle(action, handler);
              this.logger.log(
                `Mapped RPC Event: ${action} -> ${metatype.name}.${key}`,
              );
            }
          }

          // 4. Wildcard Handlers
          if (Reflect.hasMetadata(OCPP_WILDCARD_EVENT_METADATA, method)) {
            router.handle((ctx: any) =>
              this.executeWithParams(instance, method, ctx),
            );
            this.logger.log(`Mapped Wildcard Event -> ${metatype.name}.${key}`);
          }
        },
      );
    });
  }

  private async executeWithParams(
    instance: any,
    method: (...args: any[]) => any,
    ctx: any,
  ) {
    const paramsMetadata =
      Reflect.getMetadata(
        PARAM_ARGS_METADATA,
        instance.constructor,
        method.name,
      ) || {};

    // Determine the max parameter index to initialize the array length
    const maxIndex = Math.max(-1, ...Object.keys(paramsMetadata).map(Number));
    const args = new Array(maxIndex + 1).fill(undefined);

    // If there are no parameter decorators, just pass the context as the first argument
    if (Object.keys(paramsMetadata).length === 0) {
      args[0] = ctx;
    } else {
      for (const [indexStr, type] of Object.entries(paramsMetadata)) {
        const index = Number(indexStr);
        switch (type) {
          case OcppParamType.CLIENT:
            args[index] = ctx.client;
            break;
          case OcppParamType.MESSAGE:
            args[index] = ctx.message || {
              direction: "REQUEST",
              payload: ctx.payload,
            }; // Depends on ctx structure
            break;
          case OcppParamType.PARAMS:
            args[index] = ctx.payload;
            break;
          case OcppParamType.CONTEXT:
            args[index] = ctx;
            break;
          case OcppParamType.IDENTITY:
            args[index] = ctx.client?.identity;
            break;
          case OcppParamType.PATH:
            args[index] = ctx.handshake?.url || ctx.client?.request?.url;
            break;
          case OcppParamType.SESSION:
            args[index] = ctx.client?.session;
            break;
        }
      }
    }

    return method.apply(instance, args);
  }
}
