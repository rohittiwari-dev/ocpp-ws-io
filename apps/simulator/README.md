# ocpp-ws-simulator

> [!WARNING]
> **This project is currently under active testing and development.** Features may be incomplete, APIs unstable, and breaking changes can occur without notice. Not recommended for production use yet.

A modern, open-source **OCPP Charge Point Emulator** built on [ocpp-ws-io](https://ocpp-ws-io.rohittiwari.me). Simulate one or more EV charge points against any CSMS (Central System) to test OCPP message flows end-to-end.

**Live:** [ocpp.rohittiwari.me](https://ocpp.rohittiwari.me)

---

## Features

- **Multi-connector simulation** — add and manage multiple connectors per charge point
- **OCPP protocol support** — OCPP 1.6 / 2.0.1 / 2.1 (switchable from the header)
- **Full message coverage** — BootNotification, Heartbeat, StatusNotification, Authorize, StartTransaction, StopTransaction, MeterValues, Diagnostics, FirmwareStatus, DataTransfer, Reservations
- **Custom meter values** — set arbitrary energy readings to test billing accuracy
- **Maintenance mode** — toggle connectors to Unavailable and notify the CSMS
- **Reservation handling** — reserve/cancel connectors via RemoteStartTransaction flows
- **Real-time OCPP log panel** — filterable, searchable, expandable TX/RX/System/Error log stream with JSON viewer
- **Auth gate** — optional username/password login with 10-day session persistence (`ALLOW_AUTH` env flag)
- **Resizable layout** — drag to resize the connector panel, log panel, and config panel

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm / bun

### Install & Run

```bash
git clone https://github.com/rohittiwaridev/ocpp-ws-simulator
cd ocpp-ws-simulator
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

Create a `.env` file at the project root:

```env
# Enable login screen (optional — set to "false" or remove to skip auth)
NEXT_PUBLIC_ALLOW_AUTH="true"
ALLOW_AUTH="true"

# Credentials (used when ALLOW_AUTH=true)
USERNAME="your_username"
PASSWORD="your_password"
```

---

## Usage

1. Click **Settings** (⚙) or the endpoint chip in the header to configure your CSMS WebSocket URL and Charge Point ID.
2. Select your OCPP version using the version picker in the header.
3. Click **Connect** to establish the WebSocket connection.
4. Use the connector cards to simulate charging flows — Start/Stop transactions, override status, send meter values, and more.
5. Watch the **OCPP Log** panel for real-time message traces.

---

## Tech Stack

| Layer         | Tech                                            |
| ------------- | ----------------------------------------------- |
| Framework     | [Next.js 15](https://nextjs.org) (App Router)   |
| OCPP Engine   | [ocpp-ws-io](https://ocpp-ws-io.rohittiwari.me) |
| Styling       | Tailwind CSS v4                                 |
| State         | Zustand                                         |
| UI primitives | shadcn/ui                                       |

---

## Part of the ocpp-ws-io Ecosystem

| Project      | URL                                                            |
| ------------ | -------------------------------------------------------------- |
| Library docs | [ocpp-ws-io.rohittiwari.me](https://ocpp-ws-io.rohittiwari.me) |
| Simulator    | [ocpp.rohittiwari.me](https://ocpp.rohittiwari.me)             |

---

## License

MIT © [Rohit Tiwari](https://rohittiwari.me)
