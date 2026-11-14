/**
 * modular-usage.ts — the same typed patterns as single-usage.ts, organised
 * the way a real CSMS / charging-station codebase is: one handler module per
 * OCPP version, typed standalone handler functions, and small `register*`
 * functions that wire them into a server, a route or a client.
 *
 * In a real project each `// ── module: … ──` block is its own file; they are
 * kept in one file here so the example stays self-contained.
 *
 * Typechecks with zero errors against the library as published (no casts to
 * `any`, no `@ts-ignore`).
 */
import {
  type AllMethodNames,
  type ConnectionOf,
  type DuplicateConnectionPolicy,
  type HandlerContext,
  NOREPLY,
  OCPPClient,
  type OCPPProtocol,
  type OCPPRequestType,
  type OCPPResponseType,
  type OCPPRouter,
  OCPPServer,
  type OCPPServerClient,
  type SendMethodNames,
  type OCPPSendRequestType,
  type ServerOptions,
} from 'ocpp-ws-io';

// ── module: ocpp/types.ts ─────────────────────────────────────────
// Reusable handler types built only from the library's public exports.

/** A typed handler for CALL action M of version V: params in, response out. */
export type OcppHandler<V extends OCPPProtocol, M extends AllMethodNames<V>> = (
  ctx: HandlerContext<OCPPRequestType<V, M>>,
) =>
  | OCPPResponseType<V, M>
  | typeof NOREPLY
  | Promise<OCPPResponseType<V, M> | typeof NOREPLY>;

/** A typed handler for an OCPP 2.1 SEND message (never answered). */
export type OcppSendHandler<V extends OCPPProtocol, M extends SendMethodNames<V>> = (
  ctx: HandlerContext<OCPPSendRequestType<V, M>>,
) => void | Promise<void>;

/** The protocols this CSMS speaks: one source of truth for every module. */
export const CSMS_PROTOCOLS = ['ocpp1.6', 'ocpp2.0.1', 'ocpp2.1'] as const;
export type CsmsProtocol = (typeof CSMS_PROTOCOLS)[number];

/**
 * Narrow a version-agnostic handler's context to one version. The library's
 * `ctx.protocol` is `string | undefined`, independent of `ctx.params`, so a
 * plain `ctx.protocol === "ocpp1.6"` does not narrow params (see the audit).
 */
export function isProtocol<V extends OCPPProtocol, M extends AllMethodNames<V>>(
  ctx: HandlerContext<unknown>,
  version: V,
  _method: M,
): ctx is HandlerContext<OCPPRequestType<V, M>> & { protocol: V } {
  return ctx.protocol === version;
}

// ── module: ocpp/enums.ts ─────────────────────────────────────────
// Prefer `as const` objects whose union comes from the library's types;
// keep a legacy enum only behind typed conversions.

export type RegistrationStatus = OCPPResponseType<'ocpp1.6', 'BootNotification'>['status'];
export const RegistrationStatus = {
  Accepted: 'Accepted',
  Pending: 'Pending',
  Rejected: 'Rejected',
} as const satisfies Record<RegistrationStatus, RegistrationStatus>;

export type BootReason = OCPPRequestType<'ocpp2.0.1', 'BootNotification'>['reason'];

/** A legacy enum that must stay (e.g. persisted in a database). */
export enum LegacyRegistrationStatus {
  Accepted = 'Accepted',
  Pending = 'Pending',
  Rejected = 'Rejected',
}
/** A legacy enum of action names. */
export enum LegacyAction {
  Heartbeat = 'Heartbeat',
  StatusNotification = 'StatusNotification',
  Reset = 'Reset',
}

/**
 * Library value -> legacy enum. Enums are nominal: `"Accepted"` is not
 * assignable to `LegacyRegistrationStatus` (TS2322), so convert through a
 * total table. A new schema value is a compile error here until mapped.
 */
export const toLegacyStatus: Record<RegistrationStatus, LegacyRegistrationStatus> = {
  Accepted: LegacyRegistrationStatus.Accepted,
  Pending: LegacyRegistrationStatus.Pending,
  Rejected: LegacyRegistrationStatus.Rejected,
};
// Enum -> library value needs no conversion: a string enum member is
// assignable to its matching literal ("Accepted").

/**
 * Legacy enum member -> action-name literal. With the library as published,
 * an enum member passed straight to handle() as the action makes the
 * response type `never` (see the audit); `${A}` is the plain literal.
 */
export function actionName<A extends LegacyAction>(a: A): `${A}` {
  return `${a}`;
}

// ── module: ocpp/v16/handlers.ts ──────────────────────────────────
export const bootNotification16: OcppHandler<'ocpp1.6', 'BootNotification'> = async ({ params }) => {
  console.log('[1.6] boot', params.chargePointVendor, params.chargePointModel);
  return {
    status: LegacyRegistrationStatus.Accepted, // enum member -> literal: OK
    currentTime: new Date().toISOString(),
    interval: 300,
  };
};

export const startTransaction16: OcppHandler<'ocpp1.6', 'StartTransaction'> = ({ params }) => ({
  transactionId: Date.now() % 1_000_000,
  idTagInfo: { status: params.idTag ? 'Accepted' : 'Invalid' },
});

export const meterValues16: OcppHandler<'ocpp1.6', 'MeterValues'> = ({ params }) => {
  console.log('[1.6] meter values for connector', params.connectorId);
  return {};
};

// ── module: ocpp/v201/handlers.ts ─────────────────────────────────
export const bootNotification201: OcppHandler<'ocpp2.0.1', 'BootNotification'> = async ({
  params,
}) => {
  const reason: BootReason = params.reason;
  return {
    status: reason === 'Watchdog' ? RegistrationStatus.Pending : RegistrationStatus.Accepted,
    currentTime: new Date().toISOString(),
    interval: 300,
  };
};

export const transactionEvent201: OcppHandler<'ocpp2.0.1', 'TransactionEvent'> = ({ params }) => {
  console.log('[2.0.1] tx', params.transactionInfo.transactionId, params.eventType);
  return {};
};

// ── module: ocpp/v21/handlers.ts ──────────────────────────────────
export const bootNotification21: OcppHandler<'ocpp2.1', 'BootNotification'> = async ({
  params,
  signal,
}) => {
  if (signal.aborted) return NOREPLY;
  return {
    status: params.reason === 'PowerUp' ? 'Accepted' : 'Pending',
    currentTime: new Date().toISOString(),
    interval: 300,
  };
};

export const periodicEventStream21: OcppSendHandler<'ocpp2.1', 'NotifyPeriodicEventStream'> = ({
  params,
}) => {
  console.log('[2.1] stream', params.id, params.data.map((d) => d.v).join(','));
};

// ── module: ocpp/shared/handlers.ts ───────────────────────────────
// Version-agnostic: registered once, answers every version defining the action.

export function statusNotificationAnyVersion(
  ctx: HandlerContext<OCPPRequestType<CsmsProtocol, 'StatusNotification'>>,
): OCPPResponseType<CsmsProtocol, 'StatusNotification'> {
  if (isProtocol(ctx, 'ocpp1.6', 'StatusNotification')) {
    console.log('[1.6] connector', ctx.params.connectorId, ctx.params.status);
  } else if (isProtocol(ctx, 'ocpp2.0.1', 'StatusNotification')) {
    console.log('[2.0.1] evse', ctx.params.evseId, ctx.params.connectorStatus);
  } else if (isProtocol(ctx, 'ocpp2.1', 'StatusNotification')) {
    console.log('[2.1] evse', ctx.params.evseId, ctx.params.connectorStatus);
  }
  return {};
}

export const heartbeatAnyVersion = (): OCPPResponseType<CsmsProtocol, 'Heartbeat'> => ({
  currentTime: new Date().toISOString(),
});

// ── module: ocpp/register.ts ──────────────────────────────────────
// Wiring: each version module registers onto a route typed for the CSMS.

type CsmsRoute = OCPPRouter<CsmsProtocol>;

export function registerOcpp16(route: CsmsRoute): void {
  route
    .handle('ocpp1.6', 'BootNotification', bootNotification16)
    .handle('ocpp1.6', 'StartTransaction', startTransaction16)
    .handle('ocpp1.6', 'MeterValues', meterValues16);
}

export function registerOcpp201(route: CsmsRoute): void {
  route
    .handle('ocpp2.0.1', 'BootNotification', bootNotification201)
    .handle('ocpp2.0.1', 'TransactionEvent', transactionEvent201);
}

export function registerOcpp21(route: CsmsRoute): void {
  route
    .handle('ocpp2.1', 'BootNotification', bootNotification21)
    .handle('ocpp2.1', 'NotifyPeriodicEventStream', periodicEventStream21);
}

export function registerShared(route: CsmsRoute): void {
  route
    .handle(actionName(LegacyAction.StatusNotification), statusNotificationAnyVersion)
    .handle(actionName(LegacyAction.Heartbeat), heartbeatAnyVersion);
}

/** Per-connection logic: narrow to the negotiated protocol before calling. */
export async function onConnection(client: OCPPServerClient<CsmsProtocol>): Promise<void> {
  switch (client.protocol) {
    case 'ocpp1.6': {
      const res = await client.call('ocpp1.6', 'ChangeConfiguration', {
        key: 'HeartbeatInterval',
        value: '300',
      });
      console.log('[1.6] config', res.status);
      break;
    }
    case 'ocpp2.0.1':
    case 'ocpp2.1': {
      const res = await client.call(client.protocol, 'GetVariables', {
        getVariableData: [{ component: { name: 'OCPPCommCtrlr' }, variable: { name: 'HeartbeatInterval' } }],
      });
      console.log(`[${client.protocol}] variables`, res.getVariableResult.length);
      break;
    }
    default:
      break;
  }
  // Or let forProtocol() narrow the whole connection object.
  await client.forProtocol('ocpp2.1')?.call('Reset', { type: 'ImmediateAndResume' });
}

// ── module: ocpp/server.ts ────────────────────────────────────────
// duplicateConnection: only "replace" (default) and "reject" exist
// (DuplicateConnectionPolicy). A third mode such as "accept" is NOT
// implemented by the library, in its types or at runtime.

/** Options shared by every server instance; `satisfies` keeps the literals. */
const baseOptions = {
  protocols: CSMS_PROTOCOLS,
  duplicateConnection: 'replace',
  callTimeoutMs: 15_000,
} satisfies ServerOptions<CsmsProtocol>;

export function duplicatePolicyFromEnv(value: string | undefined): DuplicateConnectionPolicy {
  return value === 'reject' ? 'reject' : 'replace';
}

export function createCsms(policy: DuplicateConnectionPolicy = 'replace'): OCPPServer<CsmsProtocol> {
  const server = new OCPPServer({ ...baseOptions, duplicateConnection: policy });
  const route = server.route('/ocpp/:identity');
  registerOcpp16(route);
  registerOcpp201(route);
  registerOcpp21(route);
  registerShared(route);
  route.on('client', (client) => void onConnection(client));
  return server;
}

/** A connection registry typed from the server itself. */
export const connections = new Map<string, ConnectionOf<OCPPServer<CsmsProtocol>>>();

// ── module: station/v16.ts ── (charging-station side) ─────────────
export function registerStation16(cp: OCPPClient<'ocpp1.6'>): void {
  cp.handle('Reset', ({ params }) => ({ status: params.type === 'Soft' ? 'Accepted' : 'Rejected' }));
  cp.handle('ChangeConfiguration', ({ params }) => ({
    status: params.key === 'HeartbeatInterval' ? 'Accepted' : 'NotSupported',
  }));
}
export async function bootStation16(cp: OCPPClient<'ocpp1.6'>): Promise<LegacyRegistrationStatus> {
  const res = await cp.call('BootNotification', { chargePointVendor: 'Acme', chargePointModel: 'X1' });
  return toLegacyStatus[res.status]; // library value -> legacy enum, no cast
}

// ── module: station/v201.ts ───────────────────────────────────────
export function registerStation201(cp: OCPPClient<'ocpp2.0.1'>): void {
  cp.handle('Reset', async ({ params }) => ({ status: params.type === 'OnIdle' ? 'Scheduled' : 'Accepted' }));
  cp.handle('GetVariables', ({ params }) => ({
    getVariableResult: params.getVariableData.map((d) => ({
      attributeStatus: 'Accepted' as const,
      attributeValue: '300',
      component: d.component,
      variable: d.variable,
    })),
  }));
}
export async function bootStation201(cp: OCPPClient<'ocpp2.0.1'>): Promise<void> {
  const res = await cp.call('BootNotification', {
    reason: 'PowerUp',
    chargingStation: { model: 'X2', vendorName: 'Acme' },
  });
  console.log('[2.0.1] boot', res.status, res.interval);
}

// ── module: station/v21.ts ────────────────────────────────────────
export function registerStation21(cp: OCPPClient<'ocpp2.1'>): void {
  cp.handle('Reset', ({ params }) => ({
    status: params.type === 'ImmediateAndResume' ? 'Scheduled' : 'Accepted',
  }));
}
export async function runStation21(cp: OCPPClient<'ocpp2.1'>): Promise<void> {
  await cp.call('BootNotification', { reason: 'PowerUp', chargingStation: { model: 'X3', vendorName: 'Acme' } });
  await cp.send('NotifyPeriodicEventStream', {
    id: 7,
    pending: 0,
    basetime: new Date().toISOString(),
    data: [{ t: 0, v: '11.2' }],
  });
}

// ── module: main.ts ───────────────────────────────────────────────
export async function main(): Promise<void> {
  const csms = createCsms(duplicatePolicyFromEnv(process.env.OCPP_DUPLICATES));
  csms.on('client', (client) => {
    connections.set(client.identity, client);
  });
  await csms.listen(5000);

  const cp16 = new OCPPClient({ identity: 'CP-16', endpoint: 'ws://localhost:5000/ocpp', protocols: ['ocpp1.6'] });
  registerStation16(cp16);
  await cp16.connect();
  console.log('[1.6] registered as', await bootStation16(cp16));

  const cp201 = new OCPPClient({ identity: 'CP-201', endpoint: 'ws://localhost:5000/ocpp', protocols: ['ocpp2.0.1'] });
  registerStation201(cp201);
  await cp201.connect();
  await bootStation201(cp201);

  const cp21 = new OCPPClient({ identity: 'CP-21', endpoint: 'ws://localhost:5000/ocpp', protocols: ['ocpp2.1'] });
  registerStation21(cp21);
  await cp21.connect();
  await runStation21(cp21);

  await csms.sendToClient('CP-201', 'ocpp2.0.1', 'Reset', { type: 'OnIdle' });
}
