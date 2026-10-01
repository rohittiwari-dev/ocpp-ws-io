# ocpp-ws-board

## Unreleased

- **Requires Node.js 20 or later** (new `engines` field: `>=20.0.0`), the same floor as `ocpp-ws-io` 3.0.0; Node 18 reached end of life in April 2025. The build now targets Node 20.

## 0.2.0-alpha.0 (2026-10-02)

### Changes

- **Smaller install.** The dashboard UI ships prebuilt in `dist/public`, so its build libraries (React, Base UI, Tailwind, Recharts and others) moved from `dependencies` to `devDependencies`. Installing the package now pulls in only `hono` at runtime.
- **`ocpp-ws-io` peer range is now `^2.3.2`** (was `*`), so a future major release of `ocpp-ws-io` is not picked up without a matching board release.

### Fixes

- Message and security log filters fall back to "all" when a dropdown selection is cleared, instead of filtering on an empty value.

## 0.1.0 (2026-04-13)

### Features

- **Real-time OCPP Message Inspector**: Live deep packet inspection of OCPP 1.6J and 2.0.1 payloads with filtering by method, direction, and type
- **Connection Management Dashboard**: Monitor all connected charging stations with real-time status, protocol version, and connection metadata
- **Server Logs Viewer**: Terminal-style logs interface with auto-scroll, pause/resume, search, and export capabilities
- **Telemetry & Metrics**: Real-time charts for messages per second, latency, error rates, memory usage, and connection counts
- **Security Events Monitor**: Track authentication failures, rate limiting, protocol violations, and policy rejections
- **Multi-Framework Support**: Adapters for Express, Hono, and NestJS
- **Authentication System**: Token-based, credentials, and custom auth modes with session management
- **SSE Streaming**: Server-Sent Events for real-time message and telemetry updates
- **Dark/Light Theme**: Full theme support with system preference detection
- **Responsive Design**: Mobile-first responsive layout with collapsible sidebar

### Architecture

- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS 4
- **Backend**: Hono framework for REST API and SSE streams
- **State Management**: In-memory ring buffers with configurable limits
- **Real-time**: EventSource/SSE for live updates
- **UI Components**: Shadcn/ui with custom theming
