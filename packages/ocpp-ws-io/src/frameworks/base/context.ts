import type {
  AllMethodNames,
  OCPPResponseType,
} from "../../generated/index.js";
import type { OCPPServer } from "../../server/server.js";
import type { OCPPServerClient } from "../../server/server-client.js";
import type { CallOptions, CloseOptions } from "../../types/calls.js";
import type { CheckedAction } from "../../types/exact-keys.js";
import type {
  SendsToClientByArgs,
  SendToClientArgs,
} from "../../types/handlers.js";
import type { JsonObject } from "../../types/json.js";
import type {
  AnyOCPPProtocol,
  OCPPProtocol,
  RequestOf,
  UncheckedAction,
} from "../../types/protocol.js";
import type { OCPPServerStats } from "../../types/server.js";

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

  // The plain server's overloads: known actions of every declared protocol
  // with exact params, or unchecked(). Kept identical to OCPPServer's
  // (test/types/framework-bindings.test-d.ts checks).
  sendToClient<
    M extends AllMethodNames<OCPPProtocol>,
    T extends RequestOf<OCPPProtocol, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<OCPPProtocol, M>, T>,
    params: T,
  ): Promise<OCPPResponseType<OCPPProtocol, M> | undefined>;
  sendToClient<
    V extends OCPPProtocol,
    M extends AllMethodNames<V>,
    T extends RequestOf<V, M>,
  >(
    identity: string,
    version: V,
    method: CheckedAction<M, RequestOf<V, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;
  sendToClient<
    M extends AllMethodNames<OCPPProtocol>,
    T extends RequestOf<OCPPProtocol, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<OCPPProtocol, M>, T>,
    params: T,
    options: CallOptions,
  ): Promise<OCPPResponseType<OCPPProtocol, M> | undefined>;
  sendToClient<TResult = JsonObject>(
    identity: string,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;
  sendToClient<TResult = JsonObject>(
    identity: string,
    version: AnyOCPPProtocol,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;
  async sendToClient(...args: SendToClientArgs): Promise<unknown> {
    return (this.server as SendsToClientByArgs).sendToClient(...args);
  }

  safeSendToClient<
    M extends AllMethodNames<OCPPProtocol>,
    T extends RequestOf<OCPPProtocol, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<OCPPProtocol, M>, T>,
    params: T,
  ): Promise<OCPPResponseType<OCPPProtocol, M> | undefined>;
  safeSendToClient<
    V extends OCPPProtocol,
    M extends AllMethodNames<V>,
    T extends RequestOf<V, M>,
  >(
    identity: string,
    version: V,
    method: CheckedAction<M, RequestOf<V, M>, T>,
    params: T,
    options?: CallOptions,
  ): Promise<OCPPResponseType<V, M> | undefined>;
  safeSendToClient<
    M extends AllMethodNames<OCPPProtocol>,
    T extends RequestOf<OCPPProtocol, M>,
  >(
    identity: string,
    method: CheckedAction<M, RequestOf<OCPPProtocol, M>, T>,
    params: T,
    options: CallOptions,
  ): Promise<OCPPResponseType<OCPPProtocol, M> | undefined>;
  safeSendToClient<TResult = JsonObject>(
    identity: string,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;
  safeSendToClient<TResult = JsonObject>(
    identity: string,
    version: AnyOCPPProtocol,
    method: UncheckedAction,
    params?: object,
    options?: CallOptions,
  ): Promise<TResult | undefined>;
  async safeSendToClient(...args: SendToClientArgs): Promise<unknown> {
    return (this.server as SendsToClientByArgs).safeSendToClient(...args);
  }

  close(options?: CloseOptions): Promise<void> {
    return this.server.close(options);
  }
}
