import { expectTypeOf } from "vitest";
import {
  combineAuth,
  createPlugin,
  defineAuth,
} from "../../src/helpers/index.js";
import { heartbeatPlugin } from "../../src/plugins/index.js";
import type { OCPPRouter } from "../../src/router.js";
import { OCPPServer } from "../../src/server.js";
import {
  type AnyOCPPServerClient,
  OCPPServerClient,
} from "../../src/server-client.js";
import type {
  AuthCallback,
  ConnectionOf,
  OCPPPlugin,
  RouterHandlerContext,
} from "../../src/types.js";

/**
 * T2b: a server, its connections and its routes are typed for the server's
 * protocols. Compiled by `typecheck` (tsconfig.test.json); never run.
 */

export function connectionsFollowTheServer() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  expectTypeOf(csms).toEqualTypeOf<OCPPServer<"ocpp1.6">>();

  csms.on("client", (c) => {
    expectTypeOf(c).toEqualTypeOf<OCPPServerClient<"ocpp1.6">>();
    // A real 1.6 field (was the mix of three versions: an error).
    c.handle("BootNotification", ({ params }) => {
      expectTypeOf(params.chargePointVendor).toEqualTypeOf<string>();
      return { currentTime: "", interval: 300, status: "Accepted" as const };
    });
  });
  expectTypeOf(csms.getLocalClient("CP1")).toEqualTypeOf<
    OCPPServerClient<"ocpp1.6"> | undefined
  >();
}

export async function sendToClientFollowsTheServer() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  const reset = await csms.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Hard" });
  expectTypeOf(reset).toEqualTypeOf<
    { status: "Accepted" | "Rejected" } | undefined
  >();
  // @ts-expect-error 2.0.1 is not one of this server's protocols
  await csms.sendToClient("CP1", "ocpp2.0.1", "Reset", { type: "Immediate" });
}

export function mixedServer() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });
  csms.route("/ocpp/:identity").on("client", (client) => {
    expectTypeOf(client).toEqualTypeOf<
      OCPPServerClient<"ocpp1.6" | "ocpp2.0.1">
    >();
    const v201 = client.forProtocol("ocpp2.0.1");
    expectTypeOf(v201).toEqualTypeOf<OCPPServerClient<"ocpp2.0.1"> | undefined>();
    v201?.handle("Authorize", () => ({
      idTokenInfo: { status: "Accepted" as const },
    }));
    // The snippet from uses.ts: 2.1 is not one of this server's protocols.
    // @ts-expect-error
    client.forProtocol("ocpp2.1");
  });
}

export function routesNarrowTheServer() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });
  const v16 = csms.route("/v16/:id").config({ protocols: ["ocpp1.6"] });
  v16.on("client", (c) => {
    expectTypeOf(c).toEqualTypeOf<OCPPServerClient<"ocpp1.6">>();
  });
  v16.handle("BootNotification", ({ params }) => {
    expectTypeOf(params.chargePointVendor).toEqualTypeOf<string>();
    return { currentTime: "", interval: 300, status: "Accepted" as const };
  });
  // A wildcard handler's connection is the route's too (B23).
  v16.handle((_method, ctx) => {
    expectTypeOf(ctx.client).toEqualTypeOf<OCPPServerClient<"ocpp1.6">>();
    // @ts-expect-error 2.0.1 is not one of this route's protocols
    void ctx.client.call("ocpp2.0.1", "Heartbeat", {});
    return {};
  });
  // @ts-expect-error a route offers only protocols its server has
  csms.route("/v21/:id").config({ protocols: ["ocpp2.1"] });
}

export function authPicksAConfiguredProtocol() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });
  csms.auth((ctx) => ctx.accept({ protocol: "ocpp2.0.1" }));
  // @ts-expect-error 2.1 is not one of this server's protocols
  csms.auth((ctx) => ctx.accept({ protocol: "ocpp2.1" }));
}

export function authWrittenForEveryProtocol() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  // Callbacks written once, for any server, still fit a typed one; the
  // server refuses a protocol the charger did not offer at runtime.
  const verify = defineAuth(async (ctx) => ctx.accept({ session: {} }));
  const exported: AuthCallback = (ctx) => ctx.accept();
  csms.auth(verify);
  csms.auth(exported);
  csms.auth(combineAuth(verify, exported));
  csms.route("/ocpp/:id").auth(combineAuth(verify));

  // Written inline, the helpers take the server's protocols.
  csms.auth(defineAuth((ctx) => ctx.accept({ protocol: "ocpp1.6" })));
  csms.auth(combineAuth(verify, (ctx) => ctx.accept({ protocol: "ocpp1.6" })));
  // @ts-expect-error 2.0.1 is not one of this server's protocols
  csms.auth(defineAuth((ctx) => ctx.accept({ protocol: "ocpp2.0.1" })));
  // @ts-expect-error 2.0.1 is not one of this server's protocols
  csms.auth(combineAuth((ctx) => ctx.accept({ protocol: "ocpp2.0.1" })));
}

export function storingConnections() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  const byIdentity = new Map<string, ConnectionOf<typeof csms>>();
  csms.on("client", (c) => byIdentity.set(c.identity, c));

  const other = new OCPPServer({ protocols: ["ocpp2.0.1"] });
  const all: AnyOCPPServerClient[] = [];
  csms.on("client", (c) => all.push(c));
  other.on("client", (c) => all.push(c));
}

export function typedFitsThePlainTypeAsIn2x() {
  // 2.x code that keeps servers, routes and connections in plain types still
  // compiles; those are typed for every version, as before.
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });
  const servers: OCPPServer[] = [csms];
  const routes: OCPPRouter[] = [csms.route("/ocpp/:id")];
  const connections: OCPPServerClient[] = [];
  csms.on("client", (c) => connections.push(c));
  // A handler written on its own, for any route.
  const boot = (ctx: RouterHandlerContext<{ chargePointVendor: string }>) => {
    void ctx.client.identity;
    return { currentTime: "", interval: 300, status: "Accepted" as const };
  };
  csms.route("/boot/:id").handle("BootNotification", boot);
  // And a wildcard handler written on its own (B23 types the route's own).
  const wildcard = (_method: string, ctx: RouterHandlerContext) => {
    void ctx.client.identity;
    return {};
  };
  csms.route("/any/:id").handle(wildcard);
  // Not the reverse: a plain server may offer any protocol.
  const plain: OCPPServer = new OCPPServer();
  // @ts-expect-error a plain server is not a 1.6 server
  const narrowed: OCPPServer<"ocpp1.6"> = plain;
  return [servers, routes, narrowed];
}

export function plugins() {
  const csms = new OCPPServer({ protocols: ["ocpp1.6"] });

  // Written inline, hooks get the server's connections.
  csms.plugin({
    name: "inline",
    onConnection(client) {
      expectTypeOf(client).toEqualTypeOf<OCPPServerClient<"ocpp1.6">>();
    },
  });

  // A reusable plugin is typed for every version, as in 2.x: its hooks can
  // call and handle, and it fits a typed server.
  const reusable: OCPPPlugin = {
    name: "reusable",
    onInit(server) {
      expectTypeOf(server).toEqualTypeOf<OCPPServer>();
      void server.sendToClient("CP1", "ocpp1.6", "Reset", { type: "Hard" });
    },
    onConnection(client) {
      expectTypeOf(client).toEqualTypeOf<OCPPServerClient>();
      client.handle("Heartbeat", () => ({ currentTime: "" }));
      void client.call("ocpp1.6", "Reset", { type: "Hard" });
    },
  };
  csms.plugin(reusable);
  csms.plugin(heartbeatPlugin());

  // An app's own plugin, typed for its server's protocols.
  const app = createPlugin<"ocpp1.6">({
    name: "app",
    onConnection(client) {
      expectTypeOf(client).toEqualTypeOf<OCPPServerClient<"ocpp1.6">>();
    },
  });
  csms.plugin(app);
  csms.plugin(reusable, app);
  const v201 = new OCPPServer({ protocols: ["ocpp2.0.1"] });
  // @ts-expect-error a 1.6 plugin on a 2.0.1 server
  v201.plugin(app);

  // The rate limit callback, like a reusable plugin, as in 2.x.
  new OCPPServer({
    protocols: ["ocpp1.6"],
    rateLimit: {
      limit: 10,
      windowMs: 1000,
      onLimitExceeded(client) {
        expectTypeOf(client).toEqualTypeOf<OCPPServerClient>();
      },
    },
  });
}

export function plainServerAsBefore() {
  const csms = new OCPPServer();
  expectTypeOf(csms).toEqualTypeOf<OCPPServer>();
  csms.on("client", (c) => {
    expectTypeOf(c).toEqualTypeOf<OCPPServerClient>();
    c.handle("ocpp1.6", "Heartbeat", () => ({ currentTime: "" }));
  });
}
