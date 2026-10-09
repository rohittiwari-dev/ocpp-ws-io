import { afterEach, describe, expect, it } from "vitest";
import { OCPPServer } from "../src/server/server.js";

describe("HTTP timeouts on servers created by listen()", () => {
  let server: OCPPServer | undefined;

  afterEach(async () => {
    await server?.close({ force: true }).catch(() => {});
    server = undefined;
  });

  it("defaults headersTimeout and requestTimeout to 30 s", async () => {
    server = new OCPPServer({ logging: false });
    const http = await server.listen(0);

    expect(http.headersTimeout).toBe(30_000);
    expect(http.requestTimeout).toBe(30_000);
  });

  // listen() skipped the assignment for 0, silently keeping Node's 60 s /
  // 300 s defaults, while reconfigure() applied 0 and disabled them.
  it("treats 0 as disabled at startup, the same as reconfigure()", async () => {
    server = new OCPPServer({
      logging: false,
      headersTimeout: 0,
      requestTimeout: 0,
    });
    const http = await server.listen(0);
    expect(http.headersTimeout).toBe(0);
    expect(http.requestTimeout).toBe(0);

    server.reconfigure({ headersTimeout: 15_000, requestTimeout: 20_000 });
    expect(http.headersTimeout).toBe(15_000);
    expect(http.requestTimeout).toBe(20_000);

    server.reconfigure({ headersTimeout: 0, requestTimeout: 0 });
    expect(http.headersTimeout).toBe(0);
    expect(http.requestTimeout).toBe(0);
  });
});
