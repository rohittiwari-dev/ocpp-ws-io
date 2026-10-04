import { expectTypeOf } from "vitest";
import { defineAuth } from "../../src/helpers/index.js";
import { OCPPServer } from "../../src/server.js";
import type { JsonValue, PersistedSession } from "../../src/types.js";
import { sessionOf } from "../../src/util.js";

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
    // A session may not have the key.
    expectTypeOf(client.session.tenantId).toEqualTypeOf<
      JsonValue | undefined
    >();
    // As the cluster adapter stores it.
    const persisted: PersistedSession = client.session;
    void persisted;
  });
}

export function sessionsTakeUndefined(company: string | undefined) {
  // B26: one charger has a value, another not; JSON leaves the key out.
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  server.use(async (ctx) => {
    ctx.state.company = company;
    ctx.state.note = undefined;
    await ctx.next({ company });
  });
  server.auth((ctx) => {
    ctx.accept({ session: { company } });
  });
  defineAuth((ctx) => ctx.accept({ session: { company } }));
}

export function sessionOfHelper() {
  // The library's sessionOf: typed access without declaring OCPPSession.
  interface ChargerSession {
    tenantId: string;
    role: "admin" | "charger";
  }
  const charger = sessionOf<ChargerSession>();
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  server.use(async (ctx) => {
    await ctx.next(charger.to({ tenantId: "t1" }));
    // @ts-expect-error tenantId is a string
    charger.to({ tenantId: 1 });
    // @ts-expect-error not a key of ChargerSession
    charger.to({ tenant: "t1" });
  });
  server.auth((ctx) => {
    expectTypeOf(charger.from(ctx.state).tenantId).toEqualTypeOf<
      string | undefined
    >();
    ctx.accept({ session: charger.to({ role: "charger" }) });
    // @ts-expect-error not one of the roles
    charger.to({ role: "guest" });
  });
  server.on("client", (client) => {
    expectTypeOf(charger.from(client.session)).toEqualTypeOf<
      Partial<ChargerSession>
    >();
  });
  // @ts-expect-error a Date is not a JSON value
  sessionOf<{ since: Date }>();
}

export function sessionOfTakesWhatJsonHolds() {
  // B25: optional keys and interfaces, which JSON holds, were refused.
  interface Company {
    name: string;
    vat?: string;
    tags: string[];
  }
  interface Tree {
    name: string;
    children?: Tree[];
  }
  interface WebSocketSession {
    tenantId: string;
    company?: string;
    org: Company;
    tree?: Tree;
    note: string | undefined;
    pair: readonly [string, number];
    meta: JsonValue;
  }
  const ws = sessionOf<WebSocketSession>();
  ws.to({ company: "acme", org: { name: "Acme", tags: [] } });
  expectTypeOf(ws.from({}).company).toEqualTypeOf<string | undefined>();
  expectTypeOf(ws.from({}).org).toEqualTypeOf<Company | undefined>();
  sessionOf<PersistedSession>();

  // Still refused: what JSON drops or changes.
  // @ts-expect-error a Date inside an object
  sessionOf<{ org: { since: Date } }>();
  // @ts-expect-error a function
  sessionOf<{ check: () => boolean }>();
  // @ts-expect-error a class instance with methods
  sessionOf<{ c: { name: string; greet(): string } }>();
  // @ts-expect-error a Map
  sessionOf<{ m: Map<string, string> }>();
  // @ts-expect-error a bigint
  sessionOf<{ n: bigint }>();
  // @ts-expect-error unknown may be anything
  sessionOf<{ u: unknown }>();
  // @ts-expect-error JSON writes undefined in an array as null
  sessionOf<{ list: (string | undefined)[] }>();
  // @ts-expect-error a session is an object
  sessionOf<string>();
  // @ts-expect-error a session is an object, not an array
  sessionOf<string[]>();
}
