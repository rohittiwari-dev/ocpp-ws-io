import { expectTypeOf } from "vitest";
import { defineAuth, type JsonValue, OCPPServer } from "ocpp-ws-io";

/**
 * T5e (D14): keys declared once on OCPPSession type every place a session is
 * filled or read. Type-checked in its own program (this folder's tsconfig)
 * because an augmentation is global.
 */
declare module "ocpp-ws-io" {
  interface OCPPSession {
    tenantId: string;
    role: "admin" | "charger";
    // B26: an optional key was refused (TS2411).
    company?: string;
  }
}

export function declaredSession() {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  server.use(async (ctx) => {
    ctx.state.role = "admin";
    // @ts-expect-error not a declared role
    ctx.state.role = "guest";
    await ctx.next({ tenantId: "t1" });
    // @ts-expect-error tenantId is a string
    await ctx.next({ tenantId: 1 });
  });
  server.auth((ctx) => {
    ctx.accept({ session: { tenantId: "t1" } });
    // @ts-expect-error tenantId is a string
    ctx.accept({ session: { tenantId: 1 } });
  });
  defineAuth((ctx) => ctx.accept({ session: { role: "charger" } }));
  // @ts-expect-error not a declared role
  defineAuth((ctx) => ctx.accept({ session: { role: "guest" } }));

  server.on("client", (client) => {
    // A connection's session may not have a declared key yet.
    expectTypeOf(client.session.tenantId).toEqualTypeOf<string | undefined>();
    expectTypeOf(client.session.role).toEqualTypeOf<
      "admin" | "charger" | undefined
    >();
    expectTypeOf(client.session.company).toEqualTypeOf<string | undefined>();
    // Undeclared keys take any JSON value, and a session may not have them.
    expectTypeOf(client.session.visits).toEqualTypeOf<JsonValue | undefined>();
  });
}

export function declaredKeysTakeUndefined(company: string | undefined) {
  const server = new OCPPServer({ protocols: ["ocpp1.6"] });
  server.use(async (ctx) => {
    ctx.state.company = company;
    await ctx.next({ company });
    // @ts-expect-error company is a string
    await ctx.next({ company: 1 });
  });
  server.auth((ctx) => {
    ctx.accept({ session: { company, role: "charger" } });
  });
}
