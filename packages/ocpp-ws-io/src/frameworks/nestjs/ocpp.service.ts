import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  Inject,
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
  Optional,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import type { OCPPServer } from "../../server.js";
import type { OCPPServerClient } from "../../server-client.js";
import type {
  AllMethodNames,
  CallOptions,
  CloseOptions,
  OCPPProtocol,
  OCPPRequestType,
  OCPPResponseType,
  OCPPServerStats,
} from "../../types.js";
import { OCPP_SERVER_INSTANCE, OCPP_SERVER_OPTIONS } from "./constants.js";
import type { OcppModuleOptions } from "./interfaces.js";

@Injectable()
export class OcppService implements OnModuleInit, OnModuleDestroy {
  private attachedHttpServer?: HttpServer;
  private readonly gatewayPatterns = new Set<string | RegExp>();
  private acceptAllUpgrades = false;
  private readonly upgradeHandler = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => this.handleUpgrade(req, socket, head);

  constructor(
    @Inject(OCPP_SERVER_INSTANCE) private readonly ocppServer: OCPPServer,
    @Optional()
    @Inject(OCPP_SERVER_OPTIONS)
    private readonly options: OcppModuleOptions = {},
    @Optional()
    @Inject(HttpAdapterHost)
    private readonly httpAdapterHost?: HttpAdapterHost,
  ) {}

  onModuleInit() {
    if (this.options.autoAttach === false) return;

    const httpServer = this.httpAdapterHost?.httpAdapter?.getHttpServer();
    if (!httpServer || this.attachedHttpServer === httpServer) return;

    httpServer.on("upgrade", this.upgradeHandler);
    this.attachedHttpServer = httpServer;
  }

  async onModuleDestroy() {
    if (this.attachedHttpServer) {
      this.attachedHttpServer.removeListener("upgrade", this.upgradeHandler);
      this.attachedHttpServer = undefined;
    }

    await this.ocppServer.close();
  }

  get server(): OCPPServer {
    return this.ocppServer;
  }

  get clients(): ReadonlySet<OCPPServerClient> {
    return this.ocppServer.clients;
  }

  stats(): OCPPServerStats {
    return this.ocppServer.stats();
  }

  getClient(identity: string): OCPPServerClient | undefined {
    return this.ocppServer.getLocalClient(identity);
  }

  getLocalClient(identity: string): OCPPServerClient | undefined {
    return this.ocppServer.getLocalClient(identity);
  }

  hasLocalClient(identity: string): boolean {
    return this.ocppServer.hasLocalClient(identity);
  }

  hasClient(identity: string): Promise<boolean> {
    return this.ocppServer.isClientConnected(identity);
  }

  sendToClient<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    identity: string,
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;
  sendToClient<M extends AllMethodNames<any>>(
    identity: string,
    method: M,
    params: OCPPRequestType<any, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<any, M> | undefined>;
  sendToClient<TResult = any>(
    identity: string,
    method: string,
    params: Record<string, any>,
    options?: CallOptions,
  ): Promise<TResult | undefined>;
  async sendToClient(...args: any[]): Promise<any> {
    const send = this.ocppServer.sendToClient as (
      ...callArgs: any[]
    ) => Promise<any>;
    return send.apply(this.ocppServer, args);
  }

  safeSendToClient<V extends OCPPProtocol, M extends AllMethodNames<V>>(
    identity: string,
    version: V,
    method: M,
    params: OCPPRequestType<V, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;
  safeSendToClient<M extends AllMethodNames<any>>(
    identity: string,
    method: M,
    params: OCPPRequestType<any, M>,
    options?: CallOptions,
  ): Promise<OCPPResponseType<any, M> | undefined>;
  safeSendToClient<TResult = any>(
    identity: string,
    method: string,
    params: Record<string, any>,
    options?: CallOptions,
  ): Promise<TResult | undefined>;
  async safeSendToClient(...args: any[]): Promise<any> {
    const send = this.ocppServer.safeSendToClient as (
      ...callArgs: any[]
    ) => Promise<any>;
    return send.apply(this.ocppServer, args);
  }

  close(options?: CloseOptions): Promise<void> {
    return this.ocppServer.close(options);
  }

  registerUpgradePath(pattern?: string | RegExp): void {
    if (!pattern) {
      this.acceptAllUpgrades = true;
      return;
    }

    this.gatewayPatterns.add(pattern);
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    if (!this.shouldHandleUpgrade(req)) return;
    this.ocppServer.handleUpgrade(req, socket, head);
  }

  private shouldHandleUpgrade(req: IncomingMessage): boolean {
    if (req.headers.upgrade?.toLowerCase() !== "websocket") return false;

    const pathname = this.getPathname(req);
    if (!pathname) return false;

    if (this.options.upgradeFilter) {
      return this.options.upgradeFilter(pathname, req);
    }

    const prefixes = this.normalizePrefixes(this.options.upgradePathPrefix);
    if (prefixes.length > 0) {
      return prefixes.some((prefix) => pathname.startsWith(prefix));
    }

    if (this.acceptAllUpgrades) return true;
    if (this.gatewayPatterns.size === 0) return true;

    for (const pattern of this.gatewayPatterns) {
      if (this.matchesPattern(pattern, pathname)) return true;
    }

    return false;
  }

  private getPathname(req: IncomingMessage): string | undefined {
    try {
      return new URL(
        req.url ?? "/",
        `http://${req.headers.host ?? "localhost"}`,
      ).pathname;
    } catch {
      return undefined;
    }
  }

  private normalizePrefixes(prefix?: string | string[]): string[] {
    if (!prefix) return [];
    return (Array.isArray(prefix) ? prefix : [prefix]).filter(Boolean);
  }

  private matchesPattern(pattern: string | RegExp, pathname: string): boolean {
    if (pattern instanceof RegExp) return pattern.test(pathname);

    const patternParts = pattern.split("/").filter(Boolean);
    const pathParts = pathname.split("/").filter(Boolean);

    for (let i = 0; i < patternParts.length; i += 1) {
      const expected = patternParts[i];
      const actual = pathParts[i];

      if (expected === "*") return true;
      if (actual === undefined) return false;
      if (expected.startsWith(":")) continue;
      if (expected !== actual) return false;
    }

    return patternParts.length === pathParts.length;
  }
}
