import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { OCPPServer } from "../src/server/server.js";

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

describe("/health and /metrics access control", () => {
  let server: OCPPServer | undefined;

  afterEach(async () => {
    await server?.close().catch(() => {});
    server = undefined;
  });

  const get = async (port: number, path: string, authorization?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: authorization ? { authorization } : {},
    });
    return {
      status: res.status,
      challenge: res.headers.get("www-authenticate"),
    };
  };
  const basic = (user: string, pass: string) =>
    `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

  // A token read from an unset environment variable used to reach the request
  // handler as undefined, throw there, and crash the process on the first probe.
  it("rejects a missing bearer token at construction", () => {
    expect(
      () =>
        new OCPPServer({
          healthEndpoint: { auth: { bearer: undefined as never } },
        }),
    ).toThrow(/bearer must be a non-empty string/);
    expect(
      () => new OCPPServer({ healthEndpoint: { auth: { bearer: "" } } }),
    ).toThrow(/bearer must be a non-empty string/);
  });

  it("rejects empty basic credentials at construction", () => {
    expect(
      () =>
        new OCPPServer({
          healthEndpoint: { auth: { username: "admin", password: "" } },
        }),
    ).toThrow(/non-empty username and password/);
  });

  it("re-checks credentials in listen() after reconfigure()", async () => {
    server = new OCPPServer({ healthEndpoint: true });
    server.reconfigure({
      healthEndpoint: { auth: { bearer: undefined as never } },
    });
    await expect(server.listen(0)).rejects.toThrow(/non-empty string/);
  });

  it("accepts the right bearer token, case-insensitive scheme", async () => {
    server = new OCPPServer({ healthEndpoint: { auth: { bearer: "s3cret" } } });
    const port = getPort(await server.listen(0));

    expect((await get(port, "/health", "Bearer s3cret")).status).toBe(200);
    expect((await get(port, "/metrics", "bearer s3cret")).status).toBe(200);

    const denied = await get(port, "/health", "Bearer wrong");
    expect(denied.status).toBe(401);
    expect(denied.challenge).toBe('Bearer realm="ocpp-ws-io"');
    expect((await get(port, "/health")).status).toBe(401);
    expect((await get(port, "/health", "Bearer ")).status).toBe(401);
  });

  it("accepts the right basic credentials only", async () => {
    server = new OCPPServer({
      healthEndpoint: { auth: { username: "admin", password: "pw" } },
    });
    const port = getPort(await server.listen(0));

    expect((await get(port, "/health", basic("admin", "pw"))).status).toBe(200);
    const wrongPassword = await get(port, "/health", basic("admin", "nope"));
    expect(wrongPassword.status).toBe(401);
    expect((await get(port, "/health", basic("root", "pw"))).status).toBe(401);
    const denied = await get(port, "/health", "Bearer pw");
    expect(denied.status).toBe(401);
    expect(denied.challenge).toContain('Basic realm="ocpp-ws-io"');
  });

  it("answers 500 instead of rejecting when the handler throws", async () => {
    server = new OCPPServer({ healthEndpoint: true, logging: false });
    const rejections: Error[] = [];
    const onRejection = (err: Error) => rejections.push(err);
    process.on("unhandledRejection", onRejection);
    server.stats = () => {
      throw new Error("stats failed");
    };
    try {
      const port = getPort(await server.listen(0));
      expect((await get(port, "/health")).status).toBe(500);
      await new Promise((r) => setTimeout(r, 20));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});
