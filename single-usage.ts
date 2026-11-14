/**
 * single-usage.ts — every typed ocpp-ws-io pattern in one file.
 *
 * Covers:
 *   1. OCPP 1.6 / 2.0.1 / 2.1 handlers on the server (CSMS) and the client
 *      (charging station): typed params, enforced responses, async handlers,
 *      NOREPLY, OCPP 2.1 SEND.
 *   2. Typed calls in both directions (call / sendToClient / send).
 *   3. One server speaking several OCPP versions at once: version-specific
 *      handlers, version-agnostic handlers, narrowing by negotiated protocol.
 *   4. duplicateConnection: the two policies that exist ("replace", "reject").
 *   5. The "BootNotification enum problem": using your own TypeScript enums
 *      with the library's literal-union types.
 *
 * Typechecks with zero errors against the library as published (no casts to
 * `any`, no `@ts-ignore`).
 */
import {
  type AllMethodNames,
  type DuplicateConnectionPolicy,
  type HandlerContext,
  NOREPLY,
  OCPPClient,
  type OCPPProtocol,
  type OCPPRequestType,
  type OCPPResponseType,
  OCPPServer,
  type ServerOptions,
} from 'ocpp-ws-io';

// ═════════════════════════════════════════════════════════════════
// 4. duplicateConnection
// ═════════════════════════════════════════════════════════════════
// Only two policies exist (DuplicateConnectionPolicy = "replace" | "reject"):
//   "replace" (default): the new connection evicts the old one (code 4000,
//              "Evicted by new connection").
//   "reject":  the old connection stays, the new one gets HTTP 409.
// A third mode such as "accept" (keep both) is NOT implemented by the
// library: neither the type nor the server accepts it, so it is not shown.

// Inline in the constructor, the literal is checked directly:
const replaceServer = new OCPPServer({ protocols: ['ocpp1.6'], duplicateConnection: 'replace' });
const rejectServer = new OCPPServer({ protocols: ['ocpp1.6'], duplicateConnection: 'reject' });

// Built ahead in a variable, `{ duplicateConnection: "reject" }` would widen
// to `string` and be refused. Keep the literal with `satisfies` (or `as const`
// on the value, or annotate with the exported DuplicateConnectionPolicy):
const sharedOptions = {
  duplicateConnection: 'reject',
  callTimeoutMs: 15_000,
} satisfies ServerOptions;
const fromSharedOptions = new OCPPServer({ protocols: ['ocpp2.0.1'], ...sharedOptions });

const policyFromConfig: DuplicateConnectionPolicy =
  process.env.OCPP_DUPLICATES === 'reject' ? 'reject' : 'replace';
const configuredServer = new OCPPServer({ protocols: ['ocpp2.1'], duplicateConnection: policyFromConfig });

// ═════════════════════════════════════════════════════════════════
// 5. Enums vs the library's literal unions
// ═════════════════════════════════════════════════════════════════
// The library types OCPP values as string literal unions, e.g.
//   status: "Accepted" | "Pending" | "Rejected"
// A string enum member IS assignable to its matching literal, so returning
// `RegistrationStatusEnum.Accepted` where "Accepted" is expected compiles.
// What fails, by TypeScript's design (enums are nominal):
//   a) library value -> enum:  const s: MyEnum = response.status   // TS2322
// and, with the library as published (see the audit), an enum member used
// as the ACTION NAME of handle() makes the response type `never`.

/** Legacy enums a codebase may already have. */
export enum RegistrationStatusEnum {
  Accepted = 'Accepted',
  Pending = 'Pending',
  Rejected = 'Rejected',
}
export enum BootReasonEnum {
  PowerUp = 'PowerUp',
  Watchdog = 'Watchdog',
  RemoteReset = 'RemoteReset',
}
export enum ActionEnum {
  BootNotification = 'BootNotification',
  Heartbeat = 'Heartbeat',
  StatusNotification = 'StatusNotification',
}

// Preferred instead of enums: an `as const` object plus a union derived from
// the library's own types, so the values can never drift from the schema.
type RegistrationStatus = OCPPResponseType<'ocpp2.0.1', 'BootNotification'>['status'];
export const RegistrationStatus = {
  Accepted: 'Accepted',
  Pending: 'Pending',
  Rejected: 'Rejected',
} as const satisfies Record<string, RegistrationStatus>;

// Library value -> legacy enum: a total lookup table. Adding a status to the
// schema makes this a compile error until the table is updated.
const toRegistrationStatusEnum: Record<RegistrationStatus, RegistrationStatusEnum> = {
  Accepted: RegistrationStatusEnum.Accepted,
  Pending: RegistrationStatusEnum.Pending,
  Rejected: RegistrationStatusEnum.Rejected,
};

// Enum member -> action name literal: `${A}` is the member's string value,
// which is what handle()/call() index the method maps by.
function action<A extends ActionEnum>(a: A): `${A}` {
  return `${a}`;
}

// ═════════════════════════════════════════════════════════════════
// 1 + 3. The CSMS: one server, three OCPP versions
// ═════════════════════════════════════════════════════════════════
const server = new OCPPServer({
  protocols: ['ocpp1.6', 'ocpp2.0.1', 'ocpp2.1'],
  duplicateConnection: 'replace',
});

/**
 * Narrow a version-agnostic handler's context to one version. The library's
 * context has `protocol: string | undefined` independent of `params`, so
 * `ctx.protocol === "ocpp1.6"` alone does not narrow `ctx.params` (see the
 * audit); this guard does, without a cast.
 */
function isProtocol<V extends OCPPProtocol, M extends AllMethodNames<V>>(
  ctx: HandlerContext<unknown>,
  version: V,
  _method: M,
): ctx is HandlerContext<OCPPRequestType<V, M>> & { protocol: V } {
  return ctx.protocol === version;
}

const ocpp = server.route('/ocpp/:identity');

// ── Version-specific handlers: params and response of exactly that version ──
ocpp.handle('ocpp1.6', 'BootNotification', ({ params }) => {
  const vendor: string = params.chargePointVendor; // 1.6 shape
  console.log('1.6 boot from', vendor, params.chargePointModel);
  return {
    status: RegistrationStatusEnum.Accepted, // enum member -> literal: OK
    currentTime: new Date().toISOString(),
    interval: 300,
  };
});

ocpp.handle('ocpp2.0.1', 'BootNotification', async ({ params, client }) => {
  // 2.0.1 shape: chargingStation + reason
  console.log(client.identity, params.chargingStation.vendorName, params.reason);
  const accepted = params.reason !== BootReasonEnum.Watchdog;
  return {
    status: accepted ? RegistrationStatus.Accepted : RegistrationStatus.Pending,
    currentTime: new Date().toISOString(),
    interval: accepted ? 300 : 30,
  };
});

ocpp.handle('ocpp2.1', 'BootNotification', async ({ params, signal }) => {
  if (signal.aborted) return NOREPLY; // answer nothing
  return {
    status: params.reason === 'PowerUp' ? 'Accepted' : 'Pending',
    currentTime: new Date().toISOString(),
    interval: 300,
  };
});

// OCPP 2.1 SEND (unconfirmed): nothing is answered, return type is void.
ocpp.handle('ocpp2.1', 'NotifyPeriodicEventStream', ({ params, unconfirmed }) => {
  console.log('stream', params.id, params.data.length, 'points, unconfirmed:', unconfirmed);
});

// ── Version-agnostic handler: one handler for all versions defining the action ──
// params is the union of the three versions' requests; the response must fit
// every version (1.6's StatusNotification.conf is `{}`).
ocpp.handle(action(ActionEnum.StatusNotification), (ctx) => {
  if (isProtocol(ctx, 'ocpp1.6', 'StatusNotification')) {
    console.log('1.6 connector', ctx.params.connectorId, ctx.params.status, ctx.params.errorCode);
  } else if (isProtocol(ctx, 'ocpp2.0.1', 'StatusNotification')) {
    console.log('2.0.1 evse', ctx.params.evseId, ctx.params.connectorStatus);
  } else if (isProtocol(ctx, 'ocpp2.1', 'StatusNotification')) {
    console.log('2.1 evse', ctx.params.evseId, ctx.params.connectorStatus);
  }
  return {};
});

ocpp.handle(action(ActionEnum.Heartbeat), () => ({ currentTime: new Date().toISOString() }));

// ── Per connection: narrow the connection to its negotiated protocol ──
ocpp.on('client', async (client) => {
  // Either check the protocol and name the version in the call...
  if (client.protocol === 'ocpp1.6') {
    const res = await client.call('ocpp1.6', 'Reset', { type: 'Soft' });
    console.log('1.6 reset:', res.status);
  }
  // ...or get the connection typed for one version (undefined otherwise).
  const v201 = client.forProtocol('ocpp2.0.1');
  if (v201) {
    const res = await v201.call('Reset', { type: 'OnIdle' });
    console.log('2.0.1 reset:', res.status); // "Accepted" | "Rejected" | "Scheduled"
  }
  const v21 = client.forProtocol('ocpp2.1');
  if (v21) {
    await v21.call('Reset', { type: 'ImmediateAndResume' }); // 2.1-only value
  }
});

// Server-initiated call by identity, version named explicitly.
async function remoteResetFromCsms(identity: string): Promise<void> {
  const res = await server.sendToClient(identity, 'ocpp2.0.1', 'Reset', { type: 'Immediate' });
  if (res) console.log('reset', identity, res.status);
}

// ═════════════════════════════════════════════════════════════════
// 1. Charging stations (clients), one per version
// ═════════════════════════════════════════════════════════════════
async function chargePoint16(): Promise<void> {
  const cp = new OCPPClient({
    identity: 'CP-16',
    endpoint: 'ws://localhost:5000/ocpp',
    protocols: ['ocpp1.6'],
  });
  cp.handle('Reset', ({ params }) => ({ status: params.type === 'Hard' ? 'Accepted' : 'Rejected' }));
  cp.handle('RemoteStartTransaction', async ({ params }) => {
    console.log('start for', params.idTag);
    return { status: 'Accepted' };
  });
  await cp.connect();
  const boot = await cp.call('BootNotification', {
    chargePointVendor: 'Acme',
    chargePointModel: 'X1',
  });
  // library value -> legacy enum via the lookup table (no cast)
  const status: RegistrationStatusEnum = toRegistrationStatusEnum[boot.status];
  console.log('1.6 boot', status, boot.interval);
  await cp.call(action(ActionEnum.Heartbeat), {});
}

async function chargePoint201(): Promise<void> {
  const cp = new OCPPClient({
    identity: 'CP-201',
    endpoint: 'ws://localhost:5000/ocpp',
    protocols: ['ocpp2.0.1'],
  });
  cp.handle('Reset', async ({ params }) => ({
    status: params.type === 'OnIdle' ? 'Scheduled' : 'Accepted',
  }));
  await cp.connect();
  const boot = await cp.call('BootNotification', {
    reason: BootReasonEnum.PowerUp, // enum member -> literal: OK
    chargingStation: { model: 'X2', vendorName: 'Acme' },
  });
  console.log('2.0.1 boot', boot.status, boot.statusInfo?.reasonCode);
}

async function chargePoint21(): Promise<void> {
  const cp = new OCPPClient({
    identity: 'CP-21',
    endpoint: 'ws://localhost:5000/ocpp',
    protocols: ['ocpp2.1'],
  });
  cp.handle('Reset', () => ({ status: 'Accepted' }));
  await cp.connect();
  await cp.call('BootNotification', {
    reason: 'PowerUp',
    chargingStation: { model: 'X3', vendorName: 'Acme' },
  });
  // OCPP 2.1 SEND: resolves when written, never answered.
  await cp.send('NotifyPeriodicEventStream', {
    id: 1,
    pending: 0,
    basetime: new Date().toISOString(),
    data: [{ t: 0, v: '230.1' }],
  });
}

// A station that offers two versions: name the version, or narrow first.
async function chargePointMulti(): Promise<void> {
  const cp = new OCPPClient({
    identity: 'CP-MULTI',
    endpoint: 'ws://localhost:5000/ocpp',
    protocols: ['ocpp2.0.1', 'ocpp1.6'],
  });
  cp.handle('ocpp1.6', 'Reset', () => ({ status: 'Accepted' }));
  cp.handle('ocpp2.0.1', 'Reset', () => ({ status: 'Scheduled' }));
  await cp.connect();
  const as16 = cp.forProtocol('ocpp1.6');
  if (as16) await as16.call('BootNotification', { chargePointVendor: 'Acme', chargePointModel: 'M' });
  const as201 = cp.forProtocol('ocpp2.0.1');
  if (as201) {
    await as201.call('BootNotification', {
      reason: 'PowerUp',
      chargingStation: { model: 'M', vendorName: 'Acme' },
    });
  }
}

// ─── Start ────────────────────────────────────────────────────
export async function main(): Promise<void> {
  await server.listen(5000);
  await Promise.all([chargePoint16(), chargePoint201(), chargePoint21(), chargePointMulti()]);
  await remoteResetFromCsms('CP-201');
}

export { configuredServer, fromSharedOptions, rejectServer, replaceServer };
