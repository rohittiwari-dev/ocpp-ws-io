import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { OCPPServer } from "../src/server.js";

describe("external HTTP server ownership (H7)", () => {
  let app: ReturnType<typeof createServer>;
  let server: OCPPServer;

  afterEach(async () => {
    await server?.close({ force: true }).catch(() => {});
    await new Promise<void>((r) =>
      app?.listening ? app.close(() => r()) : r(),
    );
  });

  test("app routes still work and the app server survives ocpp close()", async () => {
    app = createServer((req, res) => {
      if (req.url === "/app") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("app-ok");
      }
    });
    await new Promise<void>((r) => app.listen(0, () => r()));
    const port = (app.address() as AddressInfo).port;

    server = new OCPPServer({ healthEndpoint: true });
    await server.listen(0, undefined, { server: app });

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);

    const appRes = await fetch(`http://127.0.0.1:${port}/app`);
    expect(appRes.status).toBe(200);
    expect(await appRes.text()).toBe("app-ok");

    await server.close({ force: true });
    expect(app.listening).toBe(true); // ocpp close must NOT close the app server
  });
});
