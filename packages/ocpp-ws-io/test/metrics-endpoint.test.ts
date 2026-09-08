import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPServer } from "../src/server.js";

/**
 * The scrape handler wrote its 200 header and *then* awaited every plugin's
 * getCustomMetrics with no bound. A slow plugin therefore left the connection
 * open with a header sent and no body, and once the header had gone there was
 * no way back to an error status. Prometheus scrapes on an interval, so each
 * hung scrape stacked another held connection.
 */

const getPort = (s: Server) => {
  const a = s.address();
  return a && typeof a !== "string" ? a.port : 0;
};

describe("/metrics with a misbehaving plugin", () => {
  let server: OCPPServer | undefined;

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
  });

  async function scrape(port: number) {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    return { status: res.status, body: await res.text() };
  }

  it("completes the scrape when a plugin never returns", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      healthEndpoint: true,
    } as never);
    server.plugin({
      name: "hanging-metrics",
      getCustomMetrics: () => new Promise<string[]>(() => {}),
    });
    const http = await server.listen(0);

    const started = Date.now();
    const { status, body } = await scrape(getPort(http));
    const elapsed = Date.now() - started;

    // Bounded, and the built-in metrics still arrive.
    expect(status).toBe(200);
    expect(body).toContain("ocpp_");
    expect(elapsed).toBeLessThan(5000);
  }, 20000);

  it("still includes a healthy plugin's metrics", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      healthEndpoint: true,
    } as never);
    server.plugin({
      name: "good-metrics",
      getCustomMetrics: () => ["# HELP custom_thing A thing", "custom_thing 42"],
    });
    const http = await server.listen(0);

    const { status, body } = await scrape(getPort(http));
    expect(status).toBe(200);
    expect(body).toContain("custom_thing 42");
  }, 20000);

  it("one broken plugin does not cost another its metrics", async () => {
    server = new OCPPServer({
      protocols: ["ocpp1.6"],
      healthEndpoint: true,
    } as never);
    server.plugin(
      {
        name: "throwing",
        getCustomMetrics: () => {
          throw new Error("metrics backend down");
        },
      },
      {
        name: "healthy",
        getCustomMetrics: () => ["healthy_thing 1"],
      },
    );
    const http = await server.listen(0);

    const { status, body } = await scrape(getPort(http));
    expect(status).toBe(200);
    expect(body).toContain("healthy_thing 1");
  }, 20000);
});
