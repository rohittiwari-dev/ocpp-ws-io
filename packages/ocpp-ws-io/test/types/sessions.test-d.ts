import { expectTypeOf } from "vitest";
import { defineAuth } from "../../src/helpers/index.js";
import { OCPPServer } from "../../src/server/server.js";
import type { PersistedSession, SessionValue } from "../../src/types.js";
import { sessionOf } from "../../src/core/util.js";

/**
 * T5e (D14): a session holds JSON values, a `Date` and `undefined` at any
 * depth (B27), wherever it is filled: connection middleware's `ctx.state` and
 * `ctx.next(payload)`, `ctx.accept({ session })`, and `client.session`.
 * Without declared keys (see types-augmented for those), any key takes any
 * of these. Compiled by `typecheck`; never run.
 */
export function sessionsHoldJson(company: string | undefined) {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  server.use(async (ctx) => {
    ctx.state.token = "abc";
    ctx.state.when = new Date();
    ctx.state.user = { id: "u1", joined: new Date(), company };
    await ctx.next({ trusted: true, tags: ["a"], since: new Date() });
    await ctx.next({ history: [{ at: new Date(), note: undefined }] });
    // @ts-expect-error a function is not a session value
    await ctx.next({ check: () => true });
    // @ts-expect-error nor is one inside an object
    ctx.state.user = { id: "u1", greet: () => "hi" };
  });
  server.auth((ctx) => {
    ctx.accept({ session: { tenantId: "t1", limits: { max: 3 } } });
    ctx.accept({ session: { at: new Date(), org: { since: new Date() } } });
  });
  defineAuth((ctx) => ctx.accept({ session: { role: "charger" } }));
  server.on("client", (client) => {
    // A session may not have the key.
    expectTypeOf(client.session.tenantId).toEqualTypeOf<SessionValue>();
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
    // from() gives back T as declared.
    expectTypeOf(charger.from(ctx.state).tenantId).toEqualTypeOf<string>();
    ctx.accept({ session: charger.to({ role: "charger" }) });
    // @ts-expect-error not one of the roles
    charger.to({ role: "guest" });
  });
  server.on("client", (client) => {
    expectTypeOf(charger.from(client.session)).toEqualTypeOf<ChargerSession>();
  });
}

export function sessionOfTakesAnyType() {
  // Whatever T declares comes back from from(), unchecked: optional keys,
  // interfaces, a Date, unknown.
  interface Company {
    name: string;
    vat?: string;
  }
  interface WebSocketSession {
    tenantId: string;
    company?: string;
    org: Company;
    note: string | undefined;
    since: Date;
    extra: unknown;
  }
  const ws = sessionOf<WebSocketSession>();
  ws.to({ company: "acme", org: { name: "Acme" }, since: new Date() });
  expectTypeOf(ws.from({})).toEqualTypeOf<WebSocketSession>();
  expectTypeOf(ws.from({}).company).toEqualTypeOf<string | undefined>();
  expectTypeOf(ws.from({}).org).toEqualTypeOf<Company>();
  expectTypeOf(ws.from({}).since).toEqualTypeOf<Date>();
  // to() still checks the keys and their types.
  // @ts-expect-error since is a Date
  ws.to({ since: "2026-10-04" });
  // @ts-expect-error a session is an object
  sessionOf<string>();
}
