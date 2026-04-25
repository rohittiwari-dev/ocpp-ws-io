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

export abstract class BaseOcppContext {
  constructor(public readonly server: OCPPServer) {}

  get clients(): ReadonlySet<OCPPServerClient> {
    return this.server.clients;
  }

  stats(): OCPPServerStats {
    return this.server.stats();
  }

  getClient(identity: string): OCPPServerClient | undefined {
    return this.server.getLocalClient(identity);
  }

  getLocalClient(identity: string): OCPPServerClient | undefined {
    return this.server.getLocalClient(identity);
  }

  hasLocalClient(identity: string): boolean {
    return this.server.hasLocalClient(identity);
  }

  hasClient(identity: string): Promise<boolean> {
    return this.server.isClientConnected(identity);
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
    const send = this.server.sendToClient as (
      ...callArgs: any[]
    ) => Promise<any>;
    return send.apply(this.server, args);
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
    const send = this.server.safeSendToClient as (
      ...callArgs: any[]
    ) => Promise<any>;
    return send.apply(this.server, args);
  }

  close(options?: CloseOptions): Promise<void> {
    return this.server.close(options);
  }
}
