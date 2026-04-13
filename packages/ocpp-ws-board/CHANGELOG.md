# ocpp-ws-board

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
