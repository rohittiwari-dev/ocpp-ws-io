import { expectTypeOf } from "vitest";
import { defineAuth } from "../../src/helpers/index.js";
import { OCPPServer } from "../../src/server.js";
import type { JsonValue, PersistedSession } from "../../src/types.js";

/**
 * T5e (D14): a session holds JSON values, wherever it is filled: connection
 * middleware's `ctx.state` and `ctx.next(payload)`, `ctx.accept({ session })`,
 * and `client.session`. Without declared keys (see types-augmented for
 * those), any key takes any JSON value. Compiled by `typecheck`; never run.
 */
export function sessionsHoldJson() {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  server.use(async (ctx) => {
    ctx.state.token = "abc";
    // @ts-expect-error a session value is JSON
    ctx.state.when = new Date();
    await ctx.next({ trusted: true, tags: ["a"] });
    // @ts-expect-error a session value is JSON
    await ctx.next({ check: () => true });
  });
  server.auth((ctx) => {
    ctx.accept({ session: { tenantId: "t1", limits: { max: 3 } } });
    // @ts-expect-error a session value is JSON
    ctx.accept({ session: { at: new Date() } });
  });
  defineAuth((ctx) => ctx.accept({ session: { role: "charger" } }));
  server.on("client", (client) => {
    expectTypeOf(client.session.tenantId).toEqualTypeOf<JsonValue>();
    // As the cluster adapter stores it.
    const persisted: PersistedSession = client.session;
    void persisted;
  });
}
