# ocpp-ws-io

## Unreleased

### Changed

- **Sessions take a `Date` and `undefined` at any depth** (types only). `ctx.state.when = new Date()`, `ctx.state.user = { id, joined: new Date() }`, `ctx.next({ since: new Date() })` and `ctx.accept({ session: { at: new Date() } })` were refused with `Type 'Date' is not assignable to type 'JsonValue | undefined'`. `SessionData` and `PersistedSession` (the server hands sessions to the adapter as it) now hold the new `SessionValue`: JSON, a `Date` or `undefined`, also inside nested objects and arrays. `JsonValue` itself is unchanged. A key you do not declare reads as `SessionValue` instead of `JsonValue | undefined`. The cluster adapter stores a `Date` as its ISO string, so another node reads it back as a string. An object declared with `interface` is still refused (it has no index signature): declare it with `type`, or write it through `sessionOf<T>().to()`.
- **`sessionOf<T>()` gives back `T` as declared, and takes any object type** (types only). `from()` returns `T` instead of `Partial<T>`, so a key reads as declared: declare it optional (`company?: string`) when a session may not have it. `T` is no longer checked for JSON values (3.0.1 and 3.0.2 refused a `Date`, `unknown` or a function): with the cluster adapter, keep values JSON, as it stores sessions as JSON. `to()` still takes `Partial<T>` and checks its keys and types. Code written for 3.0.1 or 3.0.2 keeps compiling, except an assignment of `undefined` to a required key of `from()`'s result: declare that key optional.

## v3.0.2 - Optional Session Keys (2026-10-04)

### Fixed

- **`sessionOf<T>()` takes optional keys and objects declared with `interface`** (types only). `sessionOf<{ company?: string }>()` and a key holding an interface (`{ org: Company }`) were refused with TS2344, although JSON holds both: the check compared each key's type with `JsonValue`, which has no `undefined` (part of every optional key's type) and needs an index signature an interface does not have. Each key is now checked by its shape. A key may hold `undefined`, which JSON leaves out like an absent key. Still refused: a `Date`, function, `Map`, `Set`, class instance with methods, `bigint`, `symbol`, `unknown`, `undefined` inside an array, or a `T` that is not an object.
- **Sessions take `undefined`** (types only). `ctx.state.company = company` with a `string | undefined`, `ctx.next({ company })` and `ctx.accept({ session: { company } })` were refused (TS2322), as was an optional key declared on `OCPPSession` (`company?: string`, TS2411), though one charger may have a value and another not. `OCPPSession`, `SessionData` and `PersistedSession` now take `undefined` as a value. Nothing changes at runtime: in memory the key holds `undefined`, a later `undefined` replaces an earlier value (`accept({ session })` over `ctx.state`), and the cluster adapter's JSON leaves the key out. A key you do not declare now reads as `JsonValue | undefined`, as a session may not have it, so code that passes one on as a `JsonValue` needs a check (`?? null`). A nested object declared on `OCPPSession` still needs `type`, not `interface`.

## v3.0.1 - Session Helper (2026-10-04)

### Added

- **`sessionOf<T>()`**: typed access to a connection's session without declaring `OCPPSession`. `to()` checks the keys and types where a session is written (`ctx.next()`, `ctx.accept({ session })`), `from()` reads one (`client.session`, `ctx.state`) as `T`, each key possibly missing. Both return what they are given, so nothing changes at runtime; a `T` with values JSON cannot hold (a `Date`, a class instance) is refused. Two servers in one process can keep different session types this way. See Sessions in the TypeScript guide.

## v3.0.0 - Typed by Configuration (2026-10-04)

Upgrading from 2.x: see the [migration guide](https://ocpp-ws-io.rohittiwari.me/docs/ocpp-ws-io/upgrading-to-v3), which lists each breaking change, who it affects and the option that keeps the 2.x behaviour.

### Breaking changes

- **Clients are typed for the protocols they are configured with** (types only; nothing changes at runtime). `new OCPPClient({ protocols: ["ocpp1.6"] })` is an `OCPPClient<"ocpp1.6">`: calls, handlers and responses use the 1.6 types (reading `idTagInfo` from a 1.6 `Authorize` answer no longer needs a cast), and a version named in a call must be configured, so a call, handler or field of a version the client is not configured for no longer compiles. Such a client still fits a variable typed as plain `OCPPClient`, typed for every version as before. The same for `BrowserOCPPClient`, except that a typed one does not yet fit plain `BrowserOCPPClient`: type the variable for its protocols, or use the new `AnyBrowserOCPPClient`. Clients without `protocols`, from plain `ClientOptions`, or with a runtime `string[]` keep the plain type. See the migration guide.
- **Servers, their routes and connections are typed for the server's protocols** (types only). `new OCPPServer({ protocols: ["ocpp1.6"] })` is an `OCPPServer<"ocpp1.6">`: the `client` event, `getLocalClient()` and `clients` give `OCPPServerClient<"ocpp1.6">`, and routes and their handlers, `ctx.accept({ protocol })`, `sendToClient()`, `broadcast()` and inline plugins take only its versions; a route's `config({ protocols })` must be a subset of the server's, and a route's wildcard handler gets its connection (`ctx.client`) typed for the route's protocols, as its action handlers do. A handler, call or accepted protocol for a version the server does not offer no longer compiles; no charger could negotiate it. Typed servers, routes and connections still fit plain `OCPPServer`, `OCPPRouter` and `OCPPServerClient`, and the framework adapters, `defineAuth()` / `combineAuth()` callbacks, handlers typed with plain `RouterHandlerContext`, and plugins typed `OCPPPlugin` fit any server. See the migration guide.
- **Typed methods take only known actions, with exact payloads** (types only; nothing changes at runtime). `call`, `safeCall`, `callImmediate`, `handle`, `send` and `removeHandler` on clients and server connections, and `sendToClient`, `safeSendToClient`, `broadcast`, `broadcastBatch`, `sendBatch` and route `handle` on the server, no longer have an untyped fallback; each `sendBatch` call is typed by its action: a misspelt action, an action of another version, wrong or missing params, a response missing a field, or `send()` on a client without OCPP 2.1 no longer compiles. A key the OCPP schema does not define is rejected at any depth, also from a variable, an async handler or one branch of a returned union; the error names the keys. Objects the schemas leave open (2.x `customData`, `DataTransfer`'s `data`) take any JSON. Use `unchecked("VendorAction")` for an action the types do not know, or declare it on its version's method map. A type argument on a typed call now names the action, so `call<{ status: string }>(...)` no longer compiles. See the migration guide.
- **Strict mode needs a validator for every protocol it covers.** The server and client constructors and `reconfigure()` throw `Missing strictMode validator for subprotocol "…"` for a protocol with neither built-in schemas nor a `strictModeValidators` entry, as ocpp-rpc does; a route that turns strict mode on refuses a connection on such a protocol (HTTP 500, logged). Such a protocol, `"ocpp2.0"` for one, used to run unvalidated with only a debug log. Add a validator, or limit strict mode: `strictMode: ["ocpp1.6"]`.
- **`createValidator` throws for a schema `$id` that names no action.** An `$id` that mentions `urn:` but is not `urn:` plus an action name (`'"urn:Heartbeat.req"'`, `'urn:Heartbeat.req"'`, a space, `URN:`) now throws a `TypeError` naming it and the formats to use. ajv refused some of these with `URI scheme is malformed.`; it kept others under an id no lookup uses, so strict mode let invalid payloads through. An `$id` without `urn:` is unchanged.
- **A protocol listed twice throws at construction** (server, client, browser client, route `config()`, `reconfigure()`) and is a type error at the repeat. To report it, `OCPPServer`, `OCPPClient` and `BrowserOCPPClient` take the list as a second type parameter, inferred; annotations such as `OCPPServer<"ocpp1.6">` are unchanged.
- **Strict-mode options name only what is configured** (types only). `strictModeValidators`, a `strictMode` list and `strictModeMethods` on clients, servers and routes take the configured protocols and their actions (CALL and SEND, plus `unchecked()` names); `createValidator("vendor-proto", schemas)` returns a `Validator<"vendor-proto">`. A validator, protocol or action for anything else compiled and did nothing. `reconfigure()` still takes any declared action in `strictModeMethods`.
- **The types need TypeScript 5.4 or later**, for `NoInfer`, which keeps those lists from widening the configured protocols.
- **NestJS `@OcppMessageEvent()` takes an action that exists**, in the protocol when one is given (types only). A misspelt action registered a handler nothing called. Use `unchecked()` for an action the types do not know.
- **Sessions are typed by a declared `OCPPSession`** (types only). Declare its keys once (`declare module "ocpp-ws-io" { interface OCPPSession { tenantId: string } }`) and `client.session`, `ctx.accept({ session })`, `defineAuth` / `combineAuth` callbacks, and connection middleware's `ctx.state` and `ctx.next(payload)`, which all end up in the session, are typed by them. Values are JSON, as the cluster adapter stores sessions, and undeclared keys take any JSON value: `client.session` was `Record<string, any>`, and a `Date` or class instance in a session no longer compiles. `SessionData` is the session as held (declared keys optional); `AuthCallback`, `AuthAccept` and `AuthContext` default to it.
- **The framework bindings send as the server does** (types only). `sendToClient()` and `safeSendToClient()` on Express's `req.ocpp`, NestJS's `OcppService` and the Fastify and Hono contexts take the actions of every declared protocol with exact params, as a plain `OCPPServer` does; they had their own overloads with `AllMethodNames<any>` and an untyped string fallback. A misspelt action, wrong params or a response type argument no longer compiles; use `unchecked()` for an action the types do not know.
- **The browser client's events are typed** (types only), as the Node client's are: `BrowserOCPPClient` takes `BrowserClientEvents`, so `client.on("reconnect", ({ attempt, delay }) => …)` gets numbers instead of implicit `any`, and a listener annotated with other types, or `emit()` of a declared event with other arguments, no longer compiles. `error` carries a DOM `Event` or an `Error`. Events the client does not declare still take any arguments.
- **Declarations that took `any` take their exact types** (types only): middleware given to NestJS `@UseOcppRpcMiddleware()` gets a `MiddlewareContext`; `OcppModule.forRootAsync()`'s `imports` and `inject` take Nest's own module and injection types (`useFactory` still takes whatever it injects); Hono's `binding.close()` takes `CloseOptions`; `createLoggingMiddleware()` returns `MiddlewareFunction<MiddlewareContext>`; `MiddlewareStack.use()`'s `TReturn` defaults to `unknown`. See the migration guide.
- **Node.js 20 or later is required** (`engines` was `>=18.0.0`, and the build now targets Node 20). Node 18 reached end of life in April 2025. The test suite runs on Node 20, 22, 24 and 26.
- **`maxBadMessages` default changed from `Infinity` to `50`, and it now counts bad messages in a row.** Every valid message resets the count, so a working charger that sends an occasional odd frame is never disconnected; only 50 consecutive malformed messages close the connection. Empty frames, which some charge point vendors send, are ignored rather than counted. Set `maxBadMessages: Infinity` explicitly to restore the previous behaviour (a startup warning is logged when this value is used).
- **An unknown message type is answered under message ID `"-1"`.** A type number the negotiated protocol does not define (anything but 2–4, or 5–6 outside OCPP 2.1) is still a bad message answered with `MessageTypeNotSupported`, but the reply now carries message ID `"-1"` instead of echoing the frame's ID.
- **A frame whose message ID cannot be read is answered with `RpcFrameworkError` under message ID `"-1"`** on every protocol version. This covers invalid JSON, a frame that is not an array, a message type that is not a number, and a message ID that is not a string. Such frames were previously answered only when an ID could be guessed from the raw text, and then with `FormatViolation` (`FormationViolation` on 1.6) under the guessed ID; otherwise they got no reply. 2.0.1 and 2.1 §4.2.3: "When also the MessageId cannot be read, the CALLERROR SHALL contain "-1"".
- **On OCPP 1.6, a CALL reusing the message ID of a CALL still being handled is answered with `GenericError`** instead of `RpcFrameworkError`, which is not in the 1.6J error-code table (Table 7). 2.0.1 and 2.1 still answer with `RpcFrameworkError`.
- **On OCPP 2.0.1 and 2.1, the error description of an outgoing CALLERROR or CALLRESULTERROR is cut to 255 characters**, the `string[255]` limit on `ErrorDescription` (Table 7). A longer description from a handler's error or from `createRPCError()` was sent in full. OCPP 1.6 sets no limit and is unchanged.
- **A malformed CALLRESULT or CALLERROR is no longer answered with a CALLERROR.** A CALLERROR only ever answers a CALL (OCPP-J §4.2.3), and answering an error with an error let two peers loop. On OCPP 2.1 a malformed or schema-invalid CALLRESULT is answered with a CALLRESULTERROR instead (2.1 Part 2 FR.06).
- **Under security profile 1 or 2, a connection without Basic Auth credentials is answered with HTTP 401.** This covers a missing or non-Basic `Authorization` header, an empty password, and a username that is not the charging station identity (OCPP 2.0.1 / 2.1 A00.FR.203/204 and A00.FR.302/303; the 1.6 security whitepaper has the same rules). Such a connection used to reach the auth callback with `handshake.password` undefined, and with no auth callback registered it was accepted. The reply carries `WWW-Authenticate: Basic`, the auth callback is not called, and an `AUTH_FAILED` security event is emitted. Set `requireBasicAuth: false` to restore the previous behaviour.
- **Reconnect waits never drop below `backoffMin` and stay random at `backoffMax`.** The wait is now `min(backoffMin × 2^(attempt − 1), backoffMax) × (1 + random × 0.25)`. It used to be `min(backoffMax, backoffMin × 2^(attempt − 1) × (0.5 to 1))`, so the first wait could be half of `backoffMin`, and once `backoffMax` was reached every client waited exactly `backoffMax` and reconnected in step after a CSMS restart (OCPP-J 2.0.1 / 2.1 §5.3 asks for a new random value on every attempt). With the defaults, waits are 1–1.25 s, 2–2.5 s, 4–5 s, and so on up to 30–37.5 s. Node and browser clients.
- **In strict mode, a request whose message ID is longer than 36 characters is rejected.** OCPP-J §4.1.4 limits message IDs to 36 characters and lists "unique identifier too long" as a reason for a CALLERROR. Such a CALL is answered under message ID `"-1"` with `RpcFrameworkError` on OCPP 2.0.1 and 2.1, and `GenericError` on 1.6, which has no `RpcFrameworkError`; a SEND is not answered. Both count as bad messages. With `strictMode` off, any string is still accepted.
- **`OCPPClient` no longer offers WebSocket compression unless `compression` is set.** It was documented as off by default, but `ws` offers `permessage-deflate` unless told not to, so a client with `compression` unset, or set to `false`, negotiated it with any CSMS that accepts it. Set `compression: true` to keep compressing. The server was already off by default and is unchanged.
- **With no subprotocol in common, the handshake now completes and the connection is closed (code 1002), instead of HTTP 400.** OCPP-J §3.2: the CSMS "MUST complete the WebSocket handshake with a response without a Sec-WebSocket-Protocol header and then immediately close the WebSocket connection". The same applies when the charger offers none. Route, Basic Auth, `isKnownIdentity`, middleware and auth checks now run before this decision, so an unknown path now gets 404 and a refused charger its own status, where both used to get 400.
- **`accept({ protocol })` with a version the charger did not offer is refused** the same way. It was sent anyway, which RFC 6455 forbids; the charger then failed the connection while the server had already created a client for it.
- **In strict mode, an OCPP 2.0.1 / 2.1 charging station identity must follow the spec**: an identifierString (`a-z A-Z 0-9 * - _ = + | @ .`) without `:`, at most 48 characters (OCPP-J §3.1.1; `:` is "SHALL NOT" in 2.1 and the 2.0.1 errata 2023-12). Other identities are answered with HTTP 400. 1.6 sets no rule and is unchanged, as is everything without `strictMode`.
- **Fastify 4 is no longer supported; the `fastify` peer range is now `^5.12.5`.** Fastify 4 is end of life, and an authentication bypass via malformed URLs affects every 4.x release with no fix. The Fastify plugin now declares `fastify: "5.x"`.
- **Anything thrown during a handshake, instead of `ctx.reject()`, is answered with HTTP 500 `Internal Server Error`.** An exception in an auth callback, connection middleware, `combineAuth` or `isKnownIdentity` was answered with 401 and its message as the body, so a database error could reach the charger with host names or credentials in it, and a 401 makes chargers record a `FailedToAuthenticateAtCsms` security event for what is an outage. The error is now logged on the server and emitted as the new `UPGRADE_ERROR` security event instead of `AUTH_FAILED`. A numeric `code` on a thrown error no longer sets the status: it may be an SDK's own code (MongoDB `11000`, a cloud API's `403`). Use `ctx.reject(code, message)` to choose the status and message, which is unchanged.
- **`combineAuth` passes an exception in a callback on to the server** (answered 500 and logged, as above) instead of rejecting with 500 `"Internal Server Error during auth compose execution"` and dropping the error.

### Security

- **`ws` raised to `^8.22.0`.** 8.20.0 and earlier are affected by a memory-exhaustion DoS from tiny fragments (GHSA-96hv-2xvq-fx4p, high, fixed in 8.21.0) and an uninitialized-memory disclosure (GHSA-58qx-3vcg-4xpx, fixed in 8.20.1); the old range `^8.19.0` still allowed them.
- **`ajv` raised to `^8.20.0`**, and the lockfile now resolves its `fast-uri` to 3.1.8, past the host-confusion, SSRF and path-traversal advisories in 3.1.0.
- **Peer dependency ranges start at releases without known advisories**: `express` `^4.21.2 || ^5.0.1`, `hono` `^4.12.34`, `fastify` `^5.12.5`. NestJS 12 (`@nestjs/common`, `@nestjs/core`) is now supported alongside 10 and 11, and `fastify-plugin` 6 alongside 5.

### Added

- **`RedisAdapterMetrics`**, exported from `ocpp-ws-io/adapters/redis`: what `RedisAdapter.metrics()` reports (`pendingMessages`, `activeStreams`, `streamDetails`, `pollErrors`, `lastPollError`). It returned `Record<string, unknown>`; the fields are unchanged.
- **`forProtocol(protocol)`** on `OCPPClient`, `BrowserOCPPClient` and `OCPPServerClient`: the same client or connection typed for one of its protocols, or `undefined` while it speaks another or is not connected. With `AnyOCPPClient`, `AnyBrowserOCPPClient`, `AnyOCPPServerClient` (lists of differently configured clients or connections, without the calls typed by protocol) and `KnownProtocol<P>` (the protocols among P that have types).
- **`ConnectionOf<typeof server>`**: the connection type of a server or route, to store connections with their exact type.
- **`createPlugin<"ocpp1.6">({ ... })`** types an app's own plugin for its server's protocols (`OCPPPlugin<P>`); only a server with those protocols accepts it. Without a type argument a plugin fits any server, as before. `defineAuth()` and `combineAuth()` written inline in `auth()` take the server's protocols.
- **`unchecked(action)`**, with `UncheckedAction`, `UncheckedHandler` and `JsonObject`: the explicit way to use an action the types do not know (a vendor action, a name passed through from the wire, a deliberately invalid payload). Returns the name unchanged. Editors suggest the fields of a typed handler's response and of a call's params while they are being written, in both the method-only and the version-named forms.
- `ServerOptions.maxIdentityLength` — the longest charging station identity accepted, in characters. Enforced with or without `strictMode`, and replaces the spec's 48 in strict mode; a longer identity is answered with HTTP 400. Must be a positive integer, also through `reconfigure()`.
- `ServerOptions.isKnownIdentity(identity, handshake)` — answers HTTP 404 to an identity the CSMS does not recognize (OCPP-J §3.2), before middleware and auth run. A throw answers 500 and emits `UPGRADE_ERROR`; a refusal emits `AUTH_FAILED`. Basic Auth credentials are checked first, so requests without them never reach the lookup. Typed by the exported `IdentityLookup`.
- `ServerOptions.duplicateConnection` (`"replace"` | `"reject"`, default `"replace"`) — what to do when a charger connects while already connected, which OCPP leaves open. `"replace"` keeps today's behaviour (the old connection is evicted); `"reject"` refuses the new one with HTTP 409. Typed by the exported `DuplicateConnectionPolicy`.
- `TLSOptions.cert` / `key` accept arrays, so a CSMS can serve an RSA and an ECDSA certificate together and support all four cipher suites OCPP 2.0.1 requires. New `minVersion`, `maxVersion` and `ciphers`, on the server (`listen()`, `updateTLS()`) and the client, for example to let legacy OCPP 1.6 charge points use TLS 1.0/1.1 as the 1.6 security whitepaper allows.
- `idGenerator` and `idValidator` on `ClientOptions`, `ServerOptions` (passed to every charging station connection) and the browser client's options, typed by the new exported `MessageIdGenerator` and `MessageIdValidator`. `idGenerator` creates the message ID of each outgoing CALL and SEND; a per-call `idempotencyKey` still wins, and without either a random UUID is used. `idValidator` checks each incoming CALL and SEND message ID, with or without `strictMode`, in place of the built-in check; returning `false` or throwing rejects the ID as above.
- `ServerOptions.requireBasicAuth` (default: `true`) — the 401 for missing Basic Auth credentials under security profile 1 or 2. Set `false` to leave the check to the auth callback. Changeable through `reconfigure()`. A warning is also logged once when a server on security profile 1, 2 or 3 accepts a connection with no auth callback registered, since the password or client certificate is then not checked.
- **OCPP 2.1 SEND (message type 6).** An incoming SEND, such as `NotifyPeriodicEventStream`, reaches the handler registered with `handle()`, with `ctx.unconfirmed` set. It is never answered, even when the handler throws, is missing, or fails strict validation (2.1 Part 4 §4.2.4, Part 2 FR.07 / N15.FR.02). The new `send(method, params)` on the Node and browser clients sends one; it does not wait behind an outstanding CALL. SEND messages are typed through the generated `OCPP21SendMethods` map (`SendMethodNames`, `OCPPSendRequestType`), so `call()` cannot send them as a CALL.
- **OCPP 2.1 CALLRESULTERROR (message type 5).** A received CALLRESULTERROR emits `callResultError` and is never answered. `MessageType` gains `CALLRESULTERROR` and `SEND`, and `OCPPSend` / `OCPPCallResultError` are exported.

- `ClientOptions.badMessageWindowMs` / `ServerOptions.badMessageWindowMs` — also forgets a run of bad messages once it is older than the window. The window opens at the first bad message of a run, and the next bad message after it has elapsed starts a new count. Example: `{ maxBadMessages: 10, badMessageWindowMs: 60_000 }` closes the connection on its 10th bad message in a row within a minute.
- A startup warning is logged when `maxBadMessages` is set to `Infinity`, alerting operators to the unlimited malformed-message risk.
- A warning is logged when `respondWithDetailedErrors` is on, which sends a handler error's properties to the peer in CALLERROR `details`: once per server (not per charger), and once per Node or browser client, at creation or when `reconfigure()` turns it on. Another is logged when `listen()` serves `/health` and `/metrics` without `healthEndpoint.auth`.
- `ServerOptions.headersTimeout` (default: 30 000) — max time the HTTP server waits for a client to finish sending headers. Hardens servers created by `listen()` against HTTP slowloris attacks. Set `0` to disable, at startup or through `reconfigure()`. User-provided servers are unaffected.
- `ServerOptions.requestTimeout` (default: 30 000) — max time for the complete HTTP request. Works alongside `headersTimeout` to protect the HTTP layer. Set `0` to disable.
- Both timeouts are immediately reconfigurable via `server.reconfigure()` on owned HTTP servers.
- `ServerOptions.healthEndpoint` now accepts `HealthEndpointOptions` in addition to `boolean`. Pass `{ auth: { bearer: "token" } }` for bearer-token auth or `{ auth: { username, password } }` for basic auth on `/health` and `/metrics` endpoints. Credentials are compared in constant time. Unauthenticated requests receive `401 Unauthorized`. Missing or empty credentials throw when the server is created, so an unset token environment variable fails at startup rather than on the first probe.
- `EventAdapterInterface` gains optional `setSession()` and `getSession()`, typed with the new exported `PersistedSession` and `JsonValue`. When implemented — the shipped `RedisAdapter` does — sessions survive a charger reconnecting to another node. The stored copy is read on connect (waiting at most 1 s) and replaces the node's local one. The session is written on connect, on disconnect, and at most every 30 s on messages, and `close()` waits for the final writes. No configuration required.
- **`call(method, params, { noReply: true })`**: sends a CALL without waiting for its answer and resolves with `undefined` once it is written, on the Node client, the server's charger connections and the browser client. The answer, which OCPP-J still requires the peer to send, is dropped quietly while it can arrive (`timeoutMs`) instead of being logged for an unknown message ID. The call waits its turn in the `callConcurrency` queue and frees it once sent, so the next CALL can go out before it is answered (OCPP-J §4.1.1). Typed by the exported `NoReplyCallOptions`: the result is `void`, and `retries` is rejected.
- **`ClientOptions.wsOpts`**: raw `ws` client options passed to `new WebSocket()`, for example a proxy `agent`, `localAddress`, `family`, `origin`, `maxPayload`, `followRedirects` or `closeTimeout`. Its type, the exported `WsClientOptions`, leaves out what the client sets itself: `handshakeTimeout` (use `connectTimeoutMs`), `perMessageDeflate` (`compression`), `headers` (`headers`), the TLS settings (`tls`) and `autoPong`, since pings are always answered (RFC 6455 §5.5.2). Passed from plain JavaScript anyway, they are dropped with a warning naming what to use instead. Node client only.
- **`ServerOptions.wssOptions`**: raw `ws` server options passed to `new WebSocketServer()`, such as `maxFragments` and `maxBufferedChunks` (limits against fragment floods), `allowSynchronousEvents`, `skipUTF8Validation`, a `WebSocket` subclass or `closeTimeout`. Its type, the exported `WsServerOptions`, leaves out what the server sets itself: binding (`listen()`, `handleUpgrade`), `path` (`route()`), `handleProtocols` (`protocols`), `verifyClient` (`auth()`, middleware, `isKnownIdentity`), `maxPayload` (`maxPayloadBytes`), `perMessageDeflate` (`compression`), `clientTracking` (`stats()` needs it) and `autoPong` (charger pings are always answered). Dropped with a warning when passed from plain JavaScript. `reconfigure({ wssOptions })` applies to new connections.
- **`closing` client event**: emitted when `close()` starts, before it waits for pending calls, on the Node client, the browser client and the server's charger connections (so `server.close()` emits it on each). No reconnect follows it, and `close` fires once the socket has closed. A close the peer starts gives `disconnect`, as before. The server already emitted `closing`.
- **`query` as a string**: the client `query` option (Node and browser) is typed `Record<string, string> | string`, so `query: "token=abc"` compiles; a leading `?` is optional. It already worked at runtime. Either form is added after any query in `endpoint`, and the identity stays the last path segment.
- **Signed messages plugin** (`ocpp-ws-io/plugins`): `signedMessagesPlugin` for the server and `signedMessagesMiddleware` for the Node client implement OCPP 2.0.1 / 2.1 Part 4 chapter 7. Received `<Action>-Signed` messages are unwrapped before validation and routing and, with `verify`, checked (ES256, RS256 or RS384, a header bound to the action and message type, no `crit`); `sign` picks the calls to sign, replies to signed requests are signed, and `requireSignature` refuses unsigned ones. Keys as PEM or `KeyObject` with an optional certificate for `x5t#S256`, or a custom signer for an HSM or measuring chip. Interoperates with the `jose` library in both directions. Register it before other middleware plugins; it signs after every middleware, so strict mode checks calls unsigned.
- **`wrap` on outgoing calls and results** (middleware context): a middleware that puts a message in an envelope, such as a signature, sets `ctx.wrap`; it runs after every middleware and after strict mode has checked the plain call, and what it returns goes on the wire. The reply to a wrapped call is matched to the plain action. Type `WireCall`, exported from `ocpp-ws-io` and `ocpp-ws-io/browser`. Middleware that does not set it behaves as before.
- `SecurityEvent` type `UPGRADE_ERROR` — something thrown during a handshake, answered with 500, with the error in `details.error`. `AUTH_FAILED` now only covers rejections that were chosen.

### Fixed

- **The Node client's `open` event and `connect()` give the handshake response.** `response` was always `undefined`, though typed `IncomingMessage`, so reading `response.statusCode` or its headers threw: the client read it from `ws`'s private request, which `ws` clears before `open`. It now comes from `ws`'s `upgrade` event, as in ocpp-rpc.
- **The Express and NestJS guides no longer call `safeSendToClient` fire-and-forget.** It waits for the charger's answer like `sendToClient` and only resolves with `undefined` instead of throwing, so code awaiting it to answer at once could wait for the call timeout.
- **The browser client's `incoming_error` middleware gets the CALLERROR frame** (`OCPPCallError`), as its type, the middleware guide and the Node client give it. It got an `RPCError` object instead, so a middleware reading `ctx.error[2]` for the code got `undefined`, and one that replaced `ctx.error` made the call reject with a plain array instead of an `RPCError`. The call still rejects with an `RPCError`, now built from the frame the middleware leaves, and the `callError` event carries that frame with its `details` (they were always `{}`). A browser middleware that read `ctx.error.rpcErrorCode` reads `ctx.error[2]`.
- **`createDriver` is exported from `ocpp-ws-io/adapters/redis`.** `RedisAdapter`'s `poolSize` needs a `driverFactory`, and the clustering guide builds each driver with `createDriver`, which the entry did not export, so a pool could not be set up as documented.
- **A custom protocol can send and receive SEND messages.** The types let a protocol that declares SEND messages in `OCPPSendMethodMap` use `send()` (and `ocpp generate` declares them), but `send()` threw `SEND messages exist only in OCPP 2.1` for anything but `"ocpp2.1"`, and an incoming SEND counted as a bad message. A custom protocol now works like OCPP 2.1 for SEND; OCPP 1.6 and 2.0.1 still refuse it, as their RPC framework has no SEND. CALLRESULTERROR stays OCPP 2.1 only.
- **Generated types follow `additionalProperties`.** OCPP 2.0.1 and 2.1 `CustomDataType`, which the schemas leave open for vendor data, was generated as a closed type; it now takes any JSON key. `DataTransfer`'s `data` (any JSON in the schema) is `JsonValue` instead of `unknown`.
- **A misspelt version name no longer compiles.** `call("ocpp16", ...)` matched the untyped custom-protocol overload; a named version must now be one of the client's protocols.
- **A configured custom protocol can be listed in `strictMode`.** `strictMode: ["vendor-proto"]` was a type error for a protocol not declared in `OCPPMethodMap`, though the runtime validated it.
- **The browser client's typed handlers can return `NOREPLY`**, which its runtime already supported; it needed a cast before.
- **Typed handlers can return `NOREPLY` from an async function**, alone (`async () => { await queue.push(params); return NOREPLY; }`) or as one of its answers, on clients, routes and the browser client. The runtime awaits a handler before checking for `NOREPLY`, but only the untyped overload accepted it.
- **`strictModeValidators` add to the built-in validators**, as documented, instead of replacing them: with a vendor validator next to OCPP 1.6, 1.6 messages went unvalidated.
- **Route handlers can return `NOREPLY`, and OCPP 2.1 SEND messages have typed route handlers.** Both ran on the client's runtime already, but only the untyped overload accepted them.
- **Declaring a custom protocol no longer breaks the library's own types.** Augmenting `OCPPMethodMap`, as the TypeScript guide and `ocpp generate` (its `augment.d.ts`) do, gave 10 `TS2344` errors inside the client types, because the SEND types required every protocol to be in `OCPPSendMethodMap` too. `SendMethodNames` and `OCPPSendRequestType` now take any protocol name; a protocol with no SEND entry has no SEND messages. The browser entry's re-exports of these two types take any protocol name too.
- **A middleware that throws before `next()` no longer leaves the peer to time out.** On a received CALL the peer is now answered with a CALLERROR (the error's RPC code, or `InternalError`), as OCPP-J requires an answer to every CALL; on a received CALLRESULT or CALLERROR the waiting `call()` is rejected with the error. All three were dropped before, so the only outcome was a timeout. The same holds in the browser client, where the error also escaped as an unhandled promise rejection. `schemaVersioningPlugin` with `unmatchedBehavior: "reject"` therefore answers a CALL it refuses with `InternalError` instead of leaving it unanswered.
- **The client's `tls` settings apply on every security profile.** They were used on profiles 2 and 3 only and silently ignored otherwise, so `tls: { ca }` for a `wss://` CSMS on a private CA had no effect on profile 0 or 1.
- **A middleware that calls `next()` without `await` or `return` can no longer crash the process or settle a call early.** The rest of the chain ran on a promise nobody held: in connection middleware, an auth rejection or error after it became an unhandled rejection and Node ended the process (the charger got no answer); in message middleware, `call()` resolved with `undefined` before the answer arrived, and a failing call resolved too, then its error ended the process. Both chains now keep the promise `next()` returns and wait for it, so the charger gets its 403 or 500 and a call settles with its real outcome. Code after an un-awaited `next()` still runs straight away.
- **An `async` auth callback can no longer crash the server.** The promise it returned was not awaited, so a rejection by `ctx.reject()` (which throws to stop the callback) or any exception became an unhandled rejection, and Node ends the process on one unless the application installs a handler. Any client that could reach the port could do it with a wrong password, using the pattern the docs show. An exception now gets a prompt 500 instead of waiting for the handshake timeout, and an error thrown after `accept()` or `reject()` is logged.
- **`ctx.reject(401)` sends `WWW-Authenticate`**, which RFC 9110 requires on every 401, and `ctx.reject()` with a status outside 400–599 is answered 500 (with a warning logged) instead of producing an invalid HTTP status line.
- **Connection middleware without an auth callback no longer changes the negotiated subprotocol.** It replaced it with the charger's first offer, so a server could end up speaking a version it does not support (e.g. 1.6 on a 2.0.1-only server).
- **`updateTLS()` with only a new certificate no longer drops the CA.** The TLS context was rebuilt from the update alone, which also would have dropped `minVersion` and `ciphers`; it is now built from the merged options.
- **The browser client now uses a per-call `idempotencyKey` as the message ID.** Its `call()` accepted the option but always generated a new ID.
- **A call whose message ID is already used by a pending call now rejects** instead of being sent. Both calls were registered under one ID, so the second took over the first one's response. It needs a repeated `idempotencyKey` or `idGenerator` value while calls overlap (`callConcurrency` above 1, or `sendBatch`).
- **A `null` payload is accepted as `{}`** on CALL and CALLRESULT frames, in both the Node and browser clients. Every OCPP-J version allows an absent payload to be sent as `null` (1.6J §4.2.1, 2.0.1/2.1 §4.1.5). It was answered with `FormationViolation` and counted as a bad message, so a charger using that notation was eventually disconnected.

## v2.3.2 - Leap Towards Stability (2026-09-08)

A full review of the package, worked subsystem by subsystem. One authentication bypass, a class of defects that were silent rather than wrong, and the API surface corrected where it described behaviour the code did not have. Several of the findings came from driving real messages and reading what arrived rather than from reading the source, which is how the protocol-conformance and plugin defects below surfaced at all. Every fix carries a regression test confirmed to fail without it; the suite went from 840 to 1076.

### Security

- **An unmatched path was upgraded without authentication whenever a global `server.use()` middleware existed** — global middleware routers always match but never mark a terminal route, so the unknown-path 404 became unreachable and a path with no route had no auth callback to run. Any deployment combining `server.use()` with `server.route().auth()` was affected.

### Breaking changes

- **`piiRedactorPlugin` no longer redacts outbound payloads by default (`outgoing` is now `false`).** It redacts the payload rather than a logging copy, and an outbound message is built from the payload *after* middleware runs — so redacting `idTag`, the key the plugin's own example used, sent `"***REDACTED***"` to the charge point and broke every `RemoteStartTransaction`. Enable it only for keys the charger does not act on; redact at the sink otherwise.
- **OCPP 1.6 validation failures now report `OccurenceConstraintViolation`** (one `r`, as 1.6 Part 4 spells it) instead of the 2.0.1 `OccurrenceConstraintViolation`. 2.0.1 and 2.1 are unchanged. Check any 1.6 code branching on that string, or on `instanceof RPCOccurrenceConstraintViolationError`, and use the new `RPCOccurenceConstraintViolationError` there.
- **A frame with an unsupported MessageTypeId is answered with a CALLERROR** rather than dropped, so a peer that was previously met with silence now receives `MessageTypeNotSupported`.
- **`replayBufferPlugin` answers `{ status: "Queued" }` instead of `{ status: "Accepted" }`** for a command it only queued, since `Accepted` is the charge point's own commitment to carry it out — narrow it with the new `isQueuedOffline()`, and check any call site branching on `status === "Accepted"`.
- **Route-level `auth()` now wins over a global `server.auth()`** instead of the first callback found winning, so a permissive global auth no longer silently discards every route-specific one.
- **Registering the same plugin object twice now registers it once** rather than doubling every hook; two distinct instances sharing a name are still both kept.
- **`close()` detaches the event adapter**, so a restarted server runs single-node and warns until `setAdapter()` is called again, rather than looking clustered while cross-node RPC was dead.
- **Connection pooling selects by destination rather than round-robin**, so one charger's commands cannot overtake each other in flight.
- **A remote timeout arrives as `TimeoutError`**, not `GenericError`, so `catch (e) { e instanceof TimeoutError }` behaves the same locally and cross-node.
- **Connection-level rate limiting runs before plugin `onBeforeReceive`**, so a plugin no longer observes messages the limiter dropped — `onRateLimitExceeded` is the hook for watching drops.
- **`broadcast()` and `broadcastBatch()` return a `BroadcastResult`** instead of `void`; existing `await` callers are unaffected.

### Added

- `ClientOptions.connectTimeoutMs` (30000), `retryInitialConnect` (`false`) and `handlerGraceMs` (1000) — bound the WebSocket upgrade, retry a failed *first* connect, and let an early CALL wait for a handler that is about to be registered.
- `ServerOptions.remoteCallGraceMs` and `pluginShutdownTimeoutMs` (5000) — cover adapter round-trip latency on cross-node calls, and stop one hung plugin blocking shutdown forever.
- `ServerOptions.connectionRateLimit.trustProxy` — resolve the client IP from `X-Forwarded-For` without configuring CORS; the server warns once if it sees that header while trusting no proxy.
- `AuthAccept.identity` — override the connection identity from an auth callback, so `/tenant-a/CP001` and `/tenant-b/CP001` stop colliding on one registry entry.
- `EventAdapterInterface.removePresenceIfOwned()` / `.claimPresence()`, `RedisPubSubDriver.evalScript()` — optional presence fencing, atomic on Redis via Lua; adapters that omit them keep the old unconditional behaviour.
- `RedisAdapterOptions.logger` and `ClusterDriverOptions.blockingReads` (`true`) — route transport errors into structured logging, and open a dedicated connection for blocking XREAD instead of polling with a 1s sleep.
- `getStandardValidator(protocol)`, `getStandardProtocols()` and an optional protocol list on `getStandardValidators()` — build only the validators a server actually needs.
- `webhookPlugin`: `maxConcurrent`, `includePayload`, and a `"message"` event that can now be enabled at all.
- `mqttPlugin.onPublishError` and `amqpPlugin.onError` — optional, observational, and unset by default, so a bridge plugin that has stopped delivering can say so.
- `replayBufferPlugin`: `maxQueueAgeMs` (300000), `replayable`, `maxReplayAttempts` (3), plus exported `SAFE_TO_REPLAY`, `isQueuedOffline()` and `QueuedOfflineResponse`.
- `Queue.clear()` — reject everything still queued.
- `RPCOccurenceConstraintViolationError` — the OCPP 1.6 spelling of the occurrence-constraint code, exported from both the Node and browser entry points and produced automatically for 1.6 subprotocols.
- Middleware now runs on the `outgoing_result` and `outgoing_error` phases, so a response and a CALLERROR can be transformed on the way out — previously the two context types were declared but their chain never executed. A middleware that throws while a response is being built fails open with what the handler produced, so a broken middleware cannot leave a charge point waiting for a CALLRESULT that never arrives.

### Fixed

**Clustering and presence**

- `sendBatch` had no cross-node path at all and returned an array of `undefined` for any charger not on the calling node.
- Three presence writes were unfenced under ordinary reconnect churn, so a node could delete or steal back an identity another node had just claimed.
- Bulk presence calls are chunked at 1000, where a 100k-connection node previously issued one 100k-key MGET per cycle.
- Cross-node results were accepted from any publisher; replies now have to come from the node the call was sent to.
- The presence heartbeat refreshes three times per TTL with jitter and an overlap guard, instead of landing the next write exactly at expiry.
- An adapter without `getPresence()` lost cross-node routing in silence; `setAdapter()` now warns.

**Redis adapter**

- `xaddBatch` pipelined across hash slots, which Redis Cluster rejects — failed entries are now retried individually rather than replaying the whole batch.
- `natMap` was nested inside `redisOptions`, where ioredis never looks for it, so the Docker and Kubernetes setups it exists for were silently unfixed.
- The subscriber connection had no `error` listener, so a routine Redis failover crashed every CSMS node at once.
- Presence rehydration was triggered on `reconnecting`, which fires while the connection is still down, so it threw into an empty catch and never re-ran.
- `publishBatch` omitted the TTL lease `publish` sets, leaving a permanent stream key behind on every pod restart.
- Pipeline results were discarded, so total failure reported as success; the blocking client was never closed; batches were unbounded; an empty XREAD hot-spun; poll failures were invisible.

**Node client**

- Offline-queued calls never settled after `close()` or after reconnects were exhausted.
- `close()` during an in-flight reconnect resurrected the client and left it stuck in CONNECTING.
- A post-open socket error was re-emitted with no listener guard, crashing the process.
- An aborted call was still transmitted if it was waiting in the concurrency or offline queue.
- Pong timers were overwritten without clearing, so a stale timer terminated the next healthy socket.
- `_outboundBuffer` was never cleared or bounded, replaying stale messages on a later `connect()`.
- Backpressure covered outbound CALLs only — every CALLRESULT and CALLERROR went out on a raw send.
- Reconnect backoff is floored at 50 ms, where `backoffMin: 0` produced a tight loop.
- A CALL arriving before handlers were registered was answered `NotImplemented`, telling the peer a charger does not support an action it does.

**Handshake and sockets**

- The server echoed the client's first subprotocol rather than the negotiated one, telling the peer it had agreed a version the server was not speaking.
- `maxConnections` overshot under concurrent async auth, and three separate file-descriptor leaks let sockets accumulate.
- `X-Forwarded-For` was never parsed, so every client behind a proxy resolved to the proxy's address.

**Ordering, backpressure and the worker pool**

- A stalled worker wedged a connection permanently and silently; `postMessage` to a dead worker hung; a crash-respawn loop had no backoff.
- The per-connection inbound chain was unbounded and the socket was never paused, so a fast sender became unbounded heap growth.
- `AdaptiveLimiter` measured the host rather than the container, leaving it blind or permanently tripped under cgroup limits.
- Setting `rateLimit.methods` silently disabled `workerThreads` — the pairing the docs recommend above 10k connections ran with a fully allocated, idle pool.
- `rateLimit.sampleIntervalMs` was honoured by the constructor and dropped by `reconfigure()`.
- `RouterConfig.rateLimit.adaptive` was accepted by the type and ignored.

**Validation**

- `date-time` was 85% of the cost of validating a message and is now roughly 1.5× faster, accepting exactly what it did before — pinned by a test comparing it against `ajv-formats` across leap years, month and day bounds, offsets and leap seconds.
- Validators are cached per protocol and built when the server is constructed, moving a measured 45 ms off the event loop at the moment a reconnect herd arrives.

**Plugins**

- An async hook that rejected became an unhandled rejection, which terminates the process by default — one plugin with a briefly unreachable backend took down the CSMS; fourteen dispatch sites also swallowed synchronous throws with an empty catch.
- A duplicate-identity eviction fires the replacement's `onConnection` before the evicted socket's `onDisconnect`, so six plugins keyed by identity string had the late disconnect delete the survivor's state — `otel` ended the replacement's span, leaving the live connection untraced.
- `close()` tore every plugin down but `listen()` never re-initialised them, so a restarted server came back with its plugins dead and the next `close()` sent them a second `onClose`.
- A plugin registered while chargers were connected received their `onBeforeSend`, `onBeforeReceive` and eventual `onDisconnect` for connections it never saw open.
- `onBeforeSend` and `onBeforeReceive` failed open silently, so a security plugin throwing on every message admitted everything with nothing recorded.
- `/metrics` wrote its 200 header before awaiting `getCustomMetrics()`, so a slow plugin held the scrape open with no body and no way back to an error status.
- `circuitBreakerPlugin` captured its `CircuitInfo` once per connection while the store is LRU-bounded, so above that bound the breaker silently stopped fast-failing.
- `replayBufferPlugin` lost a command on any failure that did not look like a closed socket, and replayed a stale one whenever the charger returned — a `RemoteStartTransaction` queued for one driver and delivered an hour later reaches a connector where somebody else has since started a session.
- `piiRedactorPlugin` did not cover inbound CALLRESULT or CALLERROR, so unredacted payloads reached broker plugins running `includePayload`; outbound CALLRESULT is now covered too, and the one remaining gap — the `details` object of a CALLERROR this server sends, which is not part of the middleware context — is documented.
- `schemaVersioningPlugin` transformed requests but silently never transformed the responses going back, because the `outgoing_result` phase its rules were written against never ran the middleware chain. A CSMS adapting a fleet down to an older version sent every answer in the wrong shape.
- `amqp`, `redis-pubsub` and `webhook` silently dropped every `message` event, and the webhook `close` notification was never sent.
- `webhookPlugin` signed only the body, so a captured request replayed forever, and built its idempotency key from event plus millisecond, so chargers connecting together shared one key.
- `redis-pubsub` swallowed publish failures before the async worker could report them, and `mode: "stream"` degraded to fire-and-forget PUBLISH in silence on clients without a lowercase `xadd`.
- `kafkaPlugin` reported a session duration of zero for reconnecting chargers.

**Protocol conformance**

- OCPP 1.6 peers received `OccurrenceConstraintViolation`, the 2.0.1 spelling, where 1.6 Part 4 has `OccurenceConstraintViolation` with one `r` — a code no 1.6 charge point's enum contains. The matching `FormationViolation`/`FormatViolation` rename was already handled; this second one was missed, and it fires on every missing required field.
- A frame whose MessageTypeId was not 2, 3 or 4 was dropped in silence even when its UniqueId was readable, so the sender waited out its full timeout instead of receiving the `MessageTypeNotSupported` the spec requires — reachable from any 2.1 charge point, since 2.1 adds message types 5 and 6.
- Three structural checks — a non-string UniqueId, a short frame, a non-object payload — reported `MessageTypeNotSupported` where the problem was a malformed frame; they now report the format violation for the negotiated version. The message type is also settled before those checks run, since each of them indexes into the frame by type.

**Server lifecycle**

- `listen()` did not restart the session garbage collector after a `close()`, so a restarted server stopped expiring sessions by age and grew `_connectionBuckets` by one entry per distinct client IP for the life of the process.
- Adaptive rate limiting was stopped by `close()` and never restarted, leaving the limiter attached and pinned at a multiplier of 1 — configured, reported as enabled, and silently never shedding load again.
- The telemetry push was only ever started by `plugin()`, so a restarted server never pushed telemetry again unless the application happened to register another plugin.
- A second `close()` while the first was still draining returned immediately, so `await server.close()` resolved on a server that was still shutting down — the ordinary shape of a SIGTERM and SIGINT handler both firing. Concurrent callers now await the same shutdown.
- Cached node-liveness answers were never pruned; node ids are per-process, so a cluster doing rolling deploys accumulated one entry per release.

**Framework adapters**

- The NestJS adapter left a filtered-out WebSocket upgrade socket open instead of destroying it, leaking one file descriptor per non-matching upgrade. Express, Fastify and Hono already had this fix; Nest is the adapter most likely to be filtering, since a gateway pattern or `upgradePathPrefix` is the normal way to mount it. As in the others, a socket is only destroyed when no other `upgrade` listener could want it.

**Documentation**

- Both clustering examples threw: the README passed an ioredis client positionally to a constructor taking an options object, and the Redis Cluster guide built a `ClusterDriver` that was then never used.
- The Kafka `events` default was documented as "all events" while the code publishes four of six, so `auth_failed` and `eviction` never fired unless named.
- `ServerOptions.strictMode` and `protocols` had no documentation at all, making the opt-in default undiscoverable without reading source.
- The plugin hook table said `onInit` fires when the server starts listening, and four ordering rules that this release turned into real defects were written down nowhere.

### Removed

- `EventBuffer` — added in the initial documentation commit and never wired in: not imported, not exported, not a build entry, absent from every published tarball.
- Off-thread AJV validation in the parse worker — implemented and unit-tested, but nothing ever supplied the `schemaInfo` that activates it, and wiring it as designed would have cloned 5.2 ms of OCPP 2.1 schemas per frame to save 0.016 ms of validation. `workerThreads` is unaffected and still offloads `JSON.parse`.
- `ClusterDriverOptions.prefix` — since deleting it would break compilation for anyone setting it this is notified here.

## v2.3.1 - Subpath Type Declarations (2026-09-05)

Patch release. No runtime changes — types only.

### Fixed

- **`ocpp-ws-io/browser` shipped without type declarations.** The two `tsup` configs run concurrently against the same `outDir`, and `clean: true` on the Node config raced the browser config's declaration output: `dist/browser.d.ts` and `dist/browser.d.mts` were written and then deleted whenever `dist/` already existed (always true at publish time, since `prepublishOnly` builds over it). TypeScript consumers importing `ocpp-ws-io/browser` resolved the JS through the `exports` map, found no `types` target, and fell back to an implicit `any`:

  ```
  Could not find a declaration file for module 'ocpp-ws-io/browser'.
  '.../node_modules/ocpp-ws-io/dist/browser.js' implicitly has an 'any' type.
  ```

  Cleaning now happens once in the `build` script, before the concurrent tsup runs.

- **Subpath types were invisible to `moduleResolution: "node"`.** Legacy TS resolution ignores `exports`, so every subpath (`/browser`, `/adapters/redis`, `/plugins`, `/logger`, `/express`, `/nestjs`, `/fastify`, `/hono`) resolved to `any` — only the root entry carried types. Added `typesVersions` so all subpaths resolve under `node`, `node16`, and `bundler`.

### Added

- `scripts/verify-dist.js`, run as part of `build`: fails the build if any file declared in `exports` / `main` / `module` / `types` is missing from `dist/`. An incomplete `dist` can no longer be published silently.

## v2.3.0 - Review Hardening (2026-06-11)

Fixes every finding from the full-codebase security & reliability review
(3 critical, 8 high, 14 medium, ~12 low). 52 new regression tests
(840 total).

### Fixed

- **Worker-thread parse pool was silently non-functional**: `parse-worker.cjs` now ships in `dist/` and decodes binary frames (`Buffer` → `Uint8Array` across `postMessage`). The pool shuts down on `server.close()` so worker threads no longer pin the process, and is re-created on a later `listen()`.
- **OCPP 2.1 strict-mode validation was a silent no-op**: `Request`/`Response`-style schema ids now resolve (validator and worker).
- **Cluster presence TTL is heartbeat-refreshed** (every `presenceTtlSeconds / 2`); long-lived connections stay routable. Evicted duplicate connections no longer wipe the presence entry their replacement just registered.
- **Cross-node `sendToClient` now returns the remote client's response** (correlation ids over the adapter). Stale registry entries answer immediately with "not found" instead of timing out; adapter publish failures settle the call cleanly (no leak, no unhandled rejection).
- AbortSignal listeners detach when calls settle (node + browser clients); offline-queue overflow rejects the dropped call instead of stranding its promise.
- Inbound message processing is serialized per connection — async plugins and worker parsing can no longer reorder OCPP messages.
- Per-IP connection-rate buckets are garbage-collected; `x-forwarded-proto` is only honored behind the new `trustProxy` CORS option (scheme-spoofing fix).
- External HTTP servers passed to `listen(..., { server })` are no longer 404-hijacked by `healthEndpoint` nor closed by `server.close()` (also respected by the `listen({ signal })` abort path).
- Redis adapter: presence cache pruned on removal, no `__seq` payload mutation, stream offsets survive resubscribe, non-blocking polls when no dedicated blocking client exists, and a direct `driver` option (ClusterDriver is now actually usable; honest construction errors; cross-slot-safe presence batches).
- Strict mode validates inbound CALLRESULT payloads; OCPP 1.6 emits the spec spelling `FormationViolation` (2.x keeps `FormatViolation`).
- `message-dedup` only dedups CALLs (results/errors reuse the CALL id) and replays cached responses to retrying chargers; webhook plugin treats non-2xx as failure, clears timers, and backs off between retries.
- Detailed CALLERRORs no longer include stack traces; Basic-Auth identity comparison is timing-safe; malformed percent-encoding in upgrade URLs no longer crashes the handshake.
- `sendBatch` no longer mutates the client's `callConcurrency` (uses `callImmediate`); backpressured sends share one FIFO drain timer per client; `server.reconfigure()` actually applies `maxPayloadBytes` / `compression` / `rateLimit.adaptive` / `presenceTtlSeconds` changes; `connect()` failures reject instead of throwing uncaught when no `error` listener is attached; late `router.route()` patterns register with the server; client endpoints with query strings keep the identity in the pathname; `getPackageIdent()` reports the real version (drift-tested).

### Added

- `ServerOptions.maxConnections` — hard connection cap rejected at upgrade time (HTTP 503) with a `CONNECTION_LIMIT` security event.
- `ServerOptions.presenceTtlSeconds` — cluster presence TTL / heartbeat basis.
- `CORSOptions.trustProxy` — opt-in `x-forwarded-proto` handling behind a trusted proxy.
- `RedisAdapterOptions.driver` — pass a pre-built driver (e.g. `ClusterDriver`) directly.
- `OCPPClient.hasHandler()`, `OCPPClient.callImmediate()`, `OCPPClient.bufferedAmount`.

### Migration notes

- **`x-forwarded-proto` is now ignored by default.** If you enforce `allowedSchemes` behind a reverse proxy (nginx/Caddy), set `cors: { trustProxy: true }`.
- **Remote `sendToClient` now resolves with the remote response** (previously `undefined` fire-and-forget). Calls to nodes running older versions reject with `TimeoutError`.
- **OCPP 1.6 format errors are reported as `FormationViolation`** per the 1.6J spec (previously `FormatViolation`).
- **`createValidator()` always returns a fresh instance** — custom schema sets are no longer shadowed by a global cache.
- **The heartbeat plugin defers to an existing `Heartbeat` handler** instead of throwing.

## v2.2.4 - Security & Reliability Hardening

### Changes

- **Strict Plugin Initialization**: Added runtime validation to prevent **zero-key PII redaction** (which caused silent failures) and **uninitialized Redis plugins**. The `initialize()` call now throws an informative error if `options.sensitiveKeys` is missing or empty, or if a Redis-backed plugin is initialized without a Redis client.
- **Refined PII Redaction Logic**:
  - **Default Value Removed**: `options.sensitiveKeys` now defaults to `undefined`, forcing the caller to explicitly list keys. This prevents accidental redaction of essential fields like `idToken` in `Authorize` messages.
  - **Breaking Change Documentation**: Updated `src/plugins/pii-redactor.ts` to clearly state in the JSDoc that `sensitiveKeys` is a **required** property and provide explicit usage examples.
- **Graceful Redis Plugin Handling**: Modified `OCPPPluginFactory.initialize` to check for the presence of a `redisClient` when creating Redis-backed plugins. If a plugin requires a Redis client and none is provided, it will now log a warning and skip initialization instead of throwing a hard error, ensuring the rest of the plugin chain remains functional.

## v2.2.3 - Transport Hardening

A focused reliability release that closes gaps in cross-cluster routing, the
restart lifecycle, and best-effort call logging. Fully backward compatible.

### Improvements

- **Version-Aware Unicast Routing**: `sendToClient(identity, version, method, params)`
  now carries the OCPP `version` end-to-end. Locally it dispatches through the
  version-specific `client.call()` overload (enabling version-aware strict
  validation); across a cluster the `version` is included in the unicast payload so
  the receiving node resolves the same overload. Previously the `version` argument
  was parsed and silently discarded, and remote nodes received no version at all.
- **O(1) Targeted Delivery**: `sendToClient` and the internal unicast handler now
  resolve the target via the `identity` index instead of scanning every connected
  client, removing a linear lookup on the hot path for large fleets.
- **Restart-Safe Transport Config**: Centralized `WebSocketServer` creation so the
  configured `maxPayloadBytes` and `perMessageDeflate` compression settings are
  reapplied consistently across the constructor, upgrade re-init, and
  `close()` → `listen()` restart cycles. Previously a restart could silently drop
  compression and the max-payload limit.

### Fixes

- **Accurate `safeCall` Error Logs**: The method name reported when a `safeCall`
  fails is now resolved using the same overload parsing as `call()`, instead of a
  string heuristic that could misreport custom method names.

## v2.2.2 - The "Universal Framework" Release

This massive release transforms `ocpp-ws-io` from a standalone WebSocket engine into a universal, multi-framework toolkit. We have introduced native integrations for **Fastify**, **Hono**, **NestJS**, and fundamentally unlocked **Bun** and **Deno** support.

### Major Features & Integrations

- **Unified Context Architecture (`BaseOcppContext`)**: Completely abstracted the core context logic, allowing any Node.js framework to inject a standard, strongly-typed `ocpp` object directly into its request lifecycle.
- **First-Class Fastify Integration (`ocpp-ws-io/fastify`)**:
  - Shipped a native Fastify plugin that seamlessly handles HTTP upgrades.
  - Hardened with strict memory-leak prevention (automatically deregisters `upgrade` hooks on server close).
  - TypeScript module augmentation injects `req.ocpp` safely across all Fastify routes.
- **First-Class Hono Integration (`ocpp-ws-io/hono`)**:
  - Shipped native middleware (`ocppMiddleware`) compatible with Hono's `ContextVariableMap`.
  - Added `@hono/node-server` adapters to elegantly handle raw Node server upgrades without dropping performance.
- **Bun & Deno Native Support**:
  - By hooking into standard Node.js networking (`ws` and `node:http`), `ocpp-ws-io` now inherently supports Bun and Deno environments perfectly via their compatibility layers. Zero configuration required.
- **Native NestJS Support (`ocpp-ws-io/nestjs`)**:
  - **First-Class Decorators**: Introduced `@OcppGateway()`, `@OcppMessageEvent()`, and `@OcppAuth()` for seamless class-based WebSocket routing.
  - **Parameter Injectors**: Map incoming OCPP properties directly to method parameters via `@Identity()`, `@Params()`, `@Session()`, and `@Context()`.
  - **Dynamic Module Initialization**: Provided `OcppModule.forRoot()` and `OcppModule.forRootAsync()` to natively register the adapter alongside global configurations.
  - **Zero-Config WebSockets**: The `OcppService` now automatically hooks into the underlying `HttpAdapterHost`.
  - **Testing Environment Hardening**: Bypassed ESBuild/Vite decorator stripping behaviors by utilizing NestJS `useFactory` instantiation, guaranteeing 100% test compatibility.

### Internal Refactors

- **Express Optimization**: Refactored the existing `ocpp-ws-io/express` integration to utilize the new `BaseOcppContext` for consistency across the library.
- **Upgrade Request Filtering**: Centralized the path-matching and upgrade-filtering logic into `base/utils.ts` to guarantee uniform behavior across all supported frameworks.

### Documentation

- Restructured the documentation tree into a new Fumadocs `frameworks` layout.
- Added extensive guides, examples, and edge-case documentation for NestJS, Fastify, Hono, Bun, and Deno.

## v2.2.1 - Plugin System Hardening & Type Exports

### Patch Changes

- **Exported Missing Plugin Types**: Exported `SecurityEvent`, `MessageEventPayload`, `MessageDirection`, `MessageEventContext`, `OCPPServerStats`, and `TelemetryConfig` from `index.ts` so external plugin authors can properly type their hooks.
- **Improved Type Safety**: Added missing `backpressure` and `rateLimitExceeded` events to the `ClientEvents` interface to allow fully type-safe event listeners.
- **Fixed Outbound Interception Bypass**: Guarded the `CALLERROR` generated from `_onBadMessage` with `_invokeBeforeSend` to ensure it can be intercepted by plugins.
- **Massive Plugin System Upgrade**: Expanded the `OCPPPlugin` interface from 4 to 26 hooks, adding complete lifecycle observability and control.
  - Added message interception: `onBeforeReceive` and `onBeforeSend` hooks (return `false` to drop/block messages).
  - Added new error event hooks: `onBadMessage`, `onValidationFailure`, `onHandlerError`, `onError`.
  - Added security and lifecycle hooks: `onSecurityEvent`, `onAuthFailed`, `onRateLimitExceeded`, `onEviction`.
  - Added infrastructure hooks: `onBackpressure`, `onPongTimeout`, `onClosing`, `onReconfigure`, `onTLSUpdate`.
- **Telemetry Engine**: Added background telemetry push mechanism via `telemetry.pushIntervalMs` option. Automatically pushes `OCPPServerStats` to plugins implementing `onTelemetry`.
- **Custom Metrics**: Restored `getCustomMetrics` natively to `/metrics` so plugins can contribute custom Prometheus lines.
- **Client & Server Integration**: Built-in support across both `OCPPClient` and `OCPPServerClient` objects. All existing plugins are fully backward compatible.

## v2.2.0 - Message Event Observability (BREAKING CHANGE)

### Major Changes

- **BREAKING**: Unified message event API with direction tracking and enriched context
  - New `message` event emits `{ message, direction, ctx }` payload instead of raw `OCPPMessage`
  - Direction indicator: `"IN"` (from peer) | `"OUT"` (to peer)
  - Enriched context includes: `timestamp`, `latencyMs`, `protocol`, `method`, `type`
  - Applies to both `OCPPClient` and `OCPPServerClient` (server-side connections)
  - See [MIGRATION_v3_MESSAGE_EVENTS.md](./MIGRATION_v3_MESSAGE_EVENTS.md) for detailed migration guide

### Backward Compatibility Notes

- Old `call`, `callResult`, `callError` events still emit (deprecated, for compatibility)
- `badMessage` and other events unchanged
- Middleware context handling unchanged (`MiddlewareContext` still used internally)
- All 703 tests passing — comprehensive test coverage ensures stability

### Related Files

- New types: `MessageDirection`, `MessageEventPayload`, `MessageEventContext` in `src/types.ts`
- Updated: Client event handling in `src/client.ts` with helper methods
- Server-client inherits from client, automatically gets message event support
- Enhanced README with observability section and examples

### Examples

**Before (v2.1.15):**

```typescript
client.on("call", (msg) => {
  const [, id, method] = msg;
  console.log(`Call: ${method}`);
});
```

**After (v2.2.0):**

```typescript
client.on("message", ({ message, direction, ctx }) => {
  console.log(`${direction} ${ctx.method} [latency: ${ctx.latencyMs}ms]`);
});
```

## 2.1.15

### Patch Changes

- Documentation update not core or breaking changes

## 2.1.14

### Patch Changes

- Bump `voltlog-io` to v1.0.7
- Disable source maps in build output for improved debugging and stack trace readability

## 2.1.13

### Patch Changes

- Bump `voltlog-io` to v1.0.6

  v1.0.5 and earlier shipped `dist/chunk-DAFMRCAN.mjs` which unconditionally
  executed `import { fileURLToPath } from "url"` (a Node.js built-in) as part of
  tsup's ESM shim, crashing every browser bundler (Vite, Next.js/webpack, esbuild)
  with `fileURLToPath is not a function`.

  v1.0.6 removes the shared chunk entirely and ships a clean browser-safe client
  bundle — no Node.js shim, no `path`/`url` imports.

  This unblocks `voltlog-io/client` usage in `ocpp-ws-io/browser` (`browser/init-logger.ts`)
  which was added in the previous patch to replace the root `init-logger.ts` that
  imported from the Node.js-only full `voltlog-io` entry point.

## 2.1.12

### Patch Changes

- Fix browser package pulling in Node.js-only modules
  - `browser/util.ts`: inline `NOOP_LOGGER` definition instead of re-exporting from `../util.js`, which transitively imported `node:crypto` and would break any strict browser bundler (Vite, webpack, esbuild)
  - `browser/init-logger.ts`: new browser-safe logger initialiser that imports from `voltlog-io/client` (the browser-only bundle) instead of the full `voltlog-io` package which includes Node.js transports
  - `browser/client.ts`: update `initLogger` import to `./init-logger.js` (new browser-local file)
  - `browser/index.ts`: replace `export * from "../helpers/index.js"` with explicit named exports of only the two browser-safe helpers (`createLoggingMiddleware`, `defineRpcMiddleware`); server-only exports (`defineMiddleware`, `createPlugin`, `defineAuth`, `combineAuth`) are no longer part of the browser API surface

## 2.1.11

### Patch Changes

- feat: re-enable source maps in build output for improved debugging and stack trace readability
- add: voltlog new version that allows client side imports

## 2.1.10

### Patch Changes

- perf: replace `@paralleldrive/cuid2` with `crypto.randomUUID()` for faster, zero-dependency ID generation
- perf: disable source maps, enable minification and tree shaking — package size reduced from ~9MB to 2.9MB (unpacked)
- chore: remove `@paralleldrive/cuid2` from dependencies

## 2.1.9

### Patch Changes

- fix: resolve CodeQL security vulnerabilities including dynamic method call invocation issues

  fix: update CI/CD pipeline with Netlify build hooks for reliable monorepo deployments

## 2.1.8

### 🔌 Plugin System

- **Built-in Plugin Architecture**: Introduced `server.plugin()` API for composable server extensions. Plugins receive lifecycle hooks (`onInit`, `onConnection`, `onDisconnect`, `onClose`) and can be registered via `import { ... } from "ocpp-ws-io/plugins"`.
- **7 Built-in Plugins**:
  - `heartbeatPlugin()` — Auto-responds to OCPP `Heartbeat` calls with `{ currentTime }`.
  - `metricsPlugin()` — Real-time connection metrics (active, peak, avg duration, uptime) with periodic snapshots.
  - `connectionGuardPlugin()` — Enforces hard limit on concurrent connections (force-close with code `4001`).
  - `anomalyPlugin()` — Detects rapid reconnection storms; emits `securityEvent` with `ANOMALY_RAPID_RECONNECT`.
  - `sessionLogPlugin()` — Logs connect/disconnect events with identity, IP, protocol, and duration.
  - `otelPlugin()` — OpenTelemetry span creation for connection lifecycle. Auto-detects `@opentelemetry/api` peer dependency.
  - `webhookPlugin()` — HTTP POST webhooks on lifecycle events with HMAC-SHA256 signing and retry support.
- **`createPlugin()` helper** — Type-safe factory for building custom plugins.

### ⚡ Performance & Scaling

- **Worker Thread Pool (`workerThreads`)**: Off-loads JSON parsing to a configurable thread pool. Enable with `workerThreads: true` (auto-sizes) or `{ poolSize, maxQueueSize }`. Uses `MessageChannel` for zero-copy handoff.
- **Redis Connection Pooling (`poolSize`)**: Distributes write operations (`xadd`, `publish`, `set`) across N connections via round-robin. Subscriptions remain pinned to the primary driver. Default `poolSize: 1` preserves existing behavior.
- **Redis `driverFactory` option**: Factory function to create additional pool drivers when `poolSize > 1`.
- **Redis Cluster Mode (`ClusterDriver`)**: Native Redis Cluster support via `ioredis`. Handles `MOVED`/`ASK` redirections, hash-tag sharding for presence keys, and pipeline-based batch operations (`xaddBatch`, `setPresenceBatch`). Gracefully falls back to individual `GET` calls when `MGET` spans multiple slots.

### 📦 WebSocket Compression

- **`permessage-deflate` support**: Enable via `compression: true` (sensible defaults) or fine-tune with `{ threshold, level, memLevel, serverNoContextTakeover, clientNoContextTakeover }`. Available on both `OCPPServer` and `OCPPClient`. ~80% bandwidth reduction for JSON payloads.

### 🩹 Fixes

- **Plugin/Middleware separation**: Fixed plugin registration to cleanly separate from RPC middleware pipeline.
- **Export ordering**: Alphabetized type exports in `index.ts` for consistency.
- **Ternary formatting**: Fixed indentation of nested ternary expressions in `client.ts` and `server.ts`.

### 🧪 Testing

- Added `phase-g.test.ts` — 11 tests covering Redis connection pooling (round-robin distribution, subscription pinning, disconnect), compression type contracts, and cluster driver options.
- Added plugin integration tests covering all 7 built-in plugins, lifecycle hooks, and `server.plugin()` registration.
- Full suite: **703 tests / 50 files** — all passing.

### 📚 Documentation

- **New page**: `plugins.mdx` — Full documentation for all 7 built-in plugins with options tables, usage examples, and custom plugin creation guide.
- **Updated**: `clustering.mdx` — Added Connection Pooling and Redis Cluster Mode sections with configuration examples.
- **Updated**: `api-reference.mdx` — Added `compression`, `workerThreads`, `offlineQueue` options to server/client tables. Added `CompressionOptions` reference table.

## 2.1.5

### ⚡ Performance Improvements

- **Zero-Copy Message Parsing**: Incoming WebSocket frames are now parsed via `JSON.parse(buffer)` directly, eliminating a redundant `rawData.toString()` allocation per message. At high throughput (10k+ msg/s), this removes ~2 MB/s of GC pressure.
- **Lazy AJV Schema Compilation**: OCPP JSON schemas are compiled on first use (not at startup). If only OCPP 1.6 is used, OCPP 2.0.1 and 2.1 schemas are never compiled. Validator initialization is 60–80% faster in single-protocol deployments.
- **Validator Singleton Registry**: AJV instances are now shared globally across all routers and servers using the same protocol. In multi-router setups, this eliminates ~90% of redundant AJV object creation.
- **Backpressure Event Identity**: The `backpressure` event now includes `{ identity, bufferedAmount }` for operator-level alerting without requiring cross-reference lookups.

### 🔒 Security Hardening

- **Payload Size Limits (`maxPayloadBytes`)**: The server now rejects WebSocket frames exceeding the configured byte limit (default: 64 KB) at the transport layer — before any JSON parsing. This prevents OOM attacks from malicious oversized payloads.
- **TLS Certificate Hot-Reload (`updateTLS()`)**: New `server.updateTLS(tlsOpts)` method hot-reloads TLS certificates across all active HTTPS servers without dropping existing WebSocket connections. Designed for Let's Encrypt 90-day rotation cycles.
- **Security Event Emission (`securityEvent`)**: The server now emits structured `SecurityEvent` objects for `AUTH_FAILED`, `CONNECTION_RATE_LIMIT`, and `UPGRADE_ABORTED` events. Hook directly into SIEM tools (Datadog, Splunk, PagerDuty) without log parsing.
- **Per-Identity Rate Limiting**: Each `OCPPServerClient` maintains independent token buckets (global + per-method), ensuring a noisy or misbehaving station cannot exhaust the global rate limits for other stations.

### 🧪 Testing

- Added `phase-i.test.ts` — 14 new tests covering all Phase I security features: payload size rejection, security event emissions, `updateTLS()` guard conditions, options persistence, and shallow merge behavior.

## 2.1.4

This release marks a massive architectural modernization of `ocpp-ws-io` focusing on enterprise stability, memory management, clustering observability, and strict RPC compliance. It resolves critical edge-cases encountered in high-load CSMS environments.

### 🔥 Enterprise & Performance Features

- **Idempotency Keys (Single Source of Truth Delivery)**: `client.call()` and `server.sendToClient()` now accept an `idempotencyKey` option. This safely overrides dynamically generated `messageId`s to guarantee exactly-once execution semantics across violently dropping networks and retries.
- **Eager Redis Rehydration**: The `RedisAdapter` now features an automatic eager rehydration pipeline. If the Redis broker connection drops, the adapter instantly re-registers all active local WebSockets upon broker reconnection, completely eliminating out-of-sync presence registries without waiting for the next station `Heartbeat`.
- **Global Memory & Garbage Collection**: Replaced expensive `setInterval` loops per client with a central, highly-optimized `SessionGarbageCollector`. Combined with centralized LRU caches for incoming request deduplication, memory overhead per 10k connections has been slashed by over 60%.
- **Socket-Level DDoS Protection**: Built-in Token Bucket Rate Limiting (global and per-method) has been pushed to the socket layer, safely terminating or ignoring aggressive firmware loops (`MeterValues`) before they spike the Node.js event loop.
- **Prometheus Observability**: The `OCPPServer` now natively exposes HTTP endpoints (`/health` and `/metrics`) out-of-the-box via `healthEndpoint: true`, streaming `ws` buffered bytes, active sessions, and internal V8 heap metrics.
- **NOREPLY Typing**: `typeof NOREPLY` is now officially supported in generic and version-specific `client.handle()` TypeScript overloads, allowing strict compliant suppression of response tracking.

### 🩹 Reliability Fixes

- **Strict Schema Validation Enhancements**: Fixed initialization bugs where `strictMode` failed without explicit `protocols`. Schemas are now lazily loaded and integrated flawlessly with `ajv-formats`.
- **Identity Collision Eviction**: Resolves the "Ghost Connection" bug. If continuous instances of the same `identity` rapidly reconnect, the server now actively traces and explicitly terminates older overlapping sockets to prevent split-brain routing states.
- **Offline Message Queues**: Integrated deep jitter (`backoffMin`/`backoffMax`) and exponential backoff retry flows directly into the internal asynchronous message buffering queue instead of dropping packets on link failure.
- **Unicast Sequence Assurance (`__seq`)**: Prevented Pub/Sub message race conditions by embedding monotonic sequence counters onto the Redis streams, empowering workers to safely detect and discard out-of-order `CALL` deliveries.
- **Graceful Shutdown Orchestration**: `server.close()` now safely flushes all Redis streams, unloads all presence trackers, and waits for pending handlers before terminating the HTTP server and internal listeners, preventing hanging processes during CI/CD rollouts.## 1.0.0
- **Router Enhancements**: Added modular router options with `createRouter` for flexible routing configurations.

### Patch Changes

- d7e7f08: fix: handleupgrade function did not upgrade the http server with socket
- Type mismatch in OCPPServer client event
- c2e1c7f: added packages rules, bumping version with chnages, uploading loading , fixed of potential linting fixes

This patch release encapsulates several major registry layout optimizations and extensive internal runtime bug fixes.

**🪲 Bug Fixes:**

- **Browser Client Logging Integration**: Re-oriented the \`BrowserOCPPClient\` logging instantiation step to utilize the internal isomorphic \`initLogger\` pipeline. This restores native type parity between the UI client and the Node server, enables cross-environment parsing of \`handler\` properties, and fixes a regression TypeScript syntax failure.
- **NOOP Safety**: Corrected anomalous \`undefined\` evaluation crashes when users configured \`logging: false\` by injecting a stable, un-invokable \`NOOP_LOGGER\` interceptor for clients opting out of standard observability protocols.
- **Timeout and Bad Message Catch Verification**: Patched missing catch resolutions across the internal timeout execution limits during server lifecycle monitoring.

**⚡ Feature Iterations & Crawling:**

- **Registry Discoverability**: Overhauled \`package.json\` configurations dynamically across the monorepo root and the core package workspace to dramatically scale the relevant \`keywords\` footprint targeting Next.js, CSMS platforms, charging components, and IoT protocols.
- **LLM Context Router Extractors**: Fully refactored Fumadocs indexing APIs (\`llms.txt\`, \`llms-full.txt\`) on the primary website router to abandon internal text processing in favor of direct, raw \`.mdx\` filesystem extractions. These APIs dynamically resolve all components extending across the \`docs\` and \`blog\` namespaces respectively, generating absolute URL targets ideal for direct scraping by LLM web parsers without UI contamination natively.
- **UI Enhancements**: Implemented the \`LLMCopyButton\` schema universally across the blog architectures matching the documentation structures, and removed \`clerk\` shadow injections from the base documentation layout Table of Contents (\`DocsPage\`).
- **CORS Support**: Implemented router configuration support for Cross-Origin Resource Sharing (CORS).
- **Performance Optimizations**: improved client session management, message handling, and connection statistics.
- **Bundle Size**: Optimized build artifacts to reduce overall bundle size.

### Minor Changes

- a2c0f3f: ### ✨ Features
  - **OCPPRouter Engine**: Introduced an Express-style `OCPPRouter` API to support modular connection routing based on URL patterns (`server.route()`, `server.use()`, `server.auth()`).
  - **Browser Middleware Parity**: Brought the internal `MiddlewareStack` outwards to the `BrowserOCPPClient`, giving `client.use()` full interceptor-like support natively in the browser.
  - **TypeScript Middleware Helpers**: Shipped typed utility functions `defineRpcMiddleware` for strict browser/node interceptors, `defineMiddleware` for node connections, and `defineAuth` / `combineAuth` for highly composable authentication logic.
  - **Structured Logging Configs**: Redesigned `LoggingConfig` interface using a clear `{ prettify, exchangeLog, level }` structure, standardizing real-time stream observability with `[IN]`, `[OUT]`, and `[RES]` log formatting.

    ### 🩹 Fixes & Additions

  - **Handshake API Normalization**: Standardized legacy `endpoint` configurations by officially transitioning them to Node-native `pathname` properties inside `HandshakeInfo` and constructor objects.
  - **Duplicate Handler Collisions**: Protected `client.handle()` RPC registration tables from silently overriding each other by throwing explicit runtime errors when identical handlers are accidentally attached.
  - **Global Server Fallbacks**: Modernized the core `OCPPServer` HTTP routing logic to cleanly enforce wildcard sub-routers, providing built-in unauthenticated catch-alls that terminate hanging connections.
  - **Logging Formatter Duplication**: Resolved manual format injection overhead inside the browser bundles by deferring payload formatting accurately to `createLoggingMiddleware()`.

- # Reliability, Middleware, and Type Safety

  ## 🚀 Features

  - **Redis Streams for Unicast**: Replaced Pub/Sub for node-to-node communication. This ensures **zero message loss** during temporary node restarts or network instability.
  - **Middleware System**: Added `client.use()` and server-side middleware for intercepting and modifying OCPP messages.
  - **Enhanced Logging**:
    - New `initLogger` with configurable options (`prettify`, `exchangeLog`).
    - Built-in logging middleware that traces all incoming/outgoing messages.
  - **Safe Calls**: Added `safeCall()` and `safeSendToClient()` methods for "fire-and-forget" operations that handle errors gracefully.
  - **Connection Upgrades**: Added `handshakeTimeoutMs` and `upgradeAborted` event to `OCPPServer` for better control over the WebSocket handshake pipeline.

    ## 📚 Documentation

  - Comprehensive updates to `README.md` and `apps/docs`.
  - New guides for **Middleware**, **Clustering (Redis Streams)**, **Logging**, and **Connection Upgrades**.
  - Added **Bun** and **Deno** integration examples.
