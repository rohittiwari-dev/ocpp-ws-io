# ocpp-ws-board

Real-time telemetry dashboard for [`ocpp-ws-io`](https://github.com/rohittiwari-dev/ocpp-ws-io). Ships as an npm package with a pre-built SPA and a pluggable Node.js backend.

## Installation

```bash
npm install ocpp-ws-board
```

## Quick Start

```ts
import { OCPPServer } from "ocpp-ws-io";
import { createBoard } from "ocpp-ws-board";

const server = new OCPPServer({
  protocols: ["ocpp1.6"],
});

// 1. Create the board
const board = createBoard({
  auth: { mode: "token", token: "my-secret-token" },
  // auth: { mode: "none" },               // disable auth
  // auth: { mode: "credentials",           // username/password
  //         username: "admin",
  //         password: "pass" },
  // auth: { mode: "custom",                // custom validator
  //         validate: async (creds) => ({ name: "admin" }) },
  store: {
    maxMessages: 5000,          // ring buffer size (default: 5000)
    maxProxyEvents: 1000,       // protocol-proxy events
    maxSmartChargeHistory: 500, // smart-charge history
  },
  sseHeartbeatMs: 15000,        // SSE keepalive interval
});

// 2. Register the OCPP plugin for passive observability
server.plugin(board.plugin);

// 3. Set up your OCPP routes
server.route("/ocpp/:identity").on("client", (client) => {
  client.handle("ocpp1.6", "Heartbeat", () => ({
    currentTime: new Date().toISOString(),
  }));

  client.handle("ocpp1.6", "BootNotification", () => ({
    currentTime: new Date().toISOString(),
    interval: 30,
    status: "Accepted",
  }));
});

// 4. Start the OCPP server
server.listen(5000);

// 5. Start the dashboard UI on a separate port (Bun)
Bun.serve({ fetch: board.app.fetch, port: 9000 });

console.log("OCPP server on :5000");
console.log("Dashboard UI on http://localhost:9000");
```

## API

### `createBoard(options: BoardOptions)`

Returns `{ app, plugin, store, messageBroker, telemetryBroker, cleanup }`.

| Property          | Type         | Description                                        |
| ----------------- | ------------ | -------------------------------------------------- |
| `app`             | `Hono`       | Hono app serving the REST API + static SPA          |
| `plugin`          | `BoardPlugin`| OCPP plugin — pass to `server.plugin(board.plugin)` |
| `store`           | `MemoryStore` | In-memory ring buffer telemetry store              |
| `messageBroker`   | `SSEBroker`  | SSE broker for live message streaming               |
| `telemetryBroker` | `SSEBroker`  | SSE broker for live telemetry metrics               |
| `cleanup()`       | `() => void` | Stops intervals and closes SSE connections          |

### Auth Modes

```ts
// Token-based (default)
{ mode: "token", token: "secret", sessionTtlMs?: 3600000 }

// Username + Password
{ mode: "credentials", username: "admin", password: "pass", sessionTtlMs?: 3600000 }

// Custom validator
{ mode: "custom", validate: (creds) => Promise<AuthResult>, sessionTtlMs?: 3600000 }

// No authentication
{ mode: "none" }
```

## Framework Adapters

### Express / Connect

```ts
import { expressAdapter } from "ocpp-ws-board";

const { handler, plugin } = expressAdapter({
  auth: { mode: "token", token: "secret" },
});

server.plugin(plugin);
app.use("/board", handler);
```

### Hono

```ts
import { honoAdapter } from "ocpp-ws-board";

const { subApp, plugin } = honoAdapter({
  auth: { mode: "token", token: "secret" },
});

server.plugin(plugin);
app.route("/board", subApp);
```

### NestJS

```ts
import { BoardModule } from "ocpp-ws-board/nest";

@Module({
  imports: [
    BoardModule.register({
      auth: { mode: "token", token: "secret" },
    }),
  ],
})
export class AppModule {}
```

## REST API Endpoints

All endpoints are prefixed with `/api` and require authentication (except `POST /api/auth/login` and `GET /api/auth/session`).

| Method   | Path                                  | Description                   |
| -------- | ------------------------------------- | ----------------------------- |
| `POST`   | `/api/auth/login`                     | Authenticate                  |
| `GET`    | `/api/auth/session`                   | Get current session           |
| `POST`   | `/api/auth/logout`                    | Destroy session               |
| `GET`    | `/api/overview`                       | Dashboard overview stats      |
| `GET`    | `/api/connections`                    | List all connections          |
| `GET`    | `/api/connections/:identity`          | Single connection + messages  |
| `POST`   | `/api/connections/:identity/disconnect` | Force disconnect            |
| `DELETE` | `/api/connections/:identity`          | Remove connection record      |
| `GET`    | `/api/messages`                       | Query message history         |
| `GET`    | `/api/messages/stream`                | SSE live message stream       |
| `GET`    | `/api/telemetry`                      | Current telemetry snapshot    |
| `GET`    | `/api/telemetry/stream`               | SSE live telemetry stream     |
| `GET`    | `/api/smart-charge`                   | Smart charge sessions         |
| `GET`    | `/api/proxy`                          | Protocol proxy events         |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  ocpp-ws-io                      │
│              (OCPP WebSocket Server)             │
│                                                  │
│  server.plugin(board.plugin)                     │
│       │                                          │
│       ▼                                          │
│  ┌──────────────────────────────────────────┐    │
│  │   board.plugin (passive observer)         │    │
│  │   • onConnection → store.addConnection    │    │
│  │   • onMessage    → store.addMessage       │    │
│  │   • onDisconnect → store.removeConnection │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│                 MemoryStore                       │
│   (bounded ring buffers — no memory leaks)       │
│                                                  │
│   connections ─┐                                 │
│   messages ────┤   ──→  REST API (/api/*)         │
│   telemetry ───┤   ──→  SSE streams               │
│   proxy events ┘                                 │
└─────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────┐
│              Vite + React SPA                    │
│         (pre-built in dist/public/)              │
│                                                  │
│   /login       → Token / credentials auth        │
│   /overview    → Stats, recent messages          │
│   /connections → Live connection list             │
│   /messages    → Real-time message stream         │
│   /telemetry   → Charts, memory, throughput      │
└─────────────────────────────────────────────────┘
```

## Development

```bash
# Install dependencies
npm install

# Start UI dev server
npm run dev

# Build everything (UI + backend)
npm run build

# Build only UI
npm run build:ui

# Build only backend module
npm run build:server
```

## License

MIT
