import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { rpcSuite } from "../../src/cli/tests/rpc.js";
import { OCPPServer } from "../../src/server/server.js";

/**
 * `ocpp test`'s RPC suite run against this library's own server. A check that
 * fails here reports a server as broken for answering as the spec says.
 */
describe("ocpp test: RPC suite against an ocpp-ws-io server", () => {
  let server: OCPPServer | undefined;

  afterEach(async () => {
    await server?.close({ force: true });
    server = undefined;
  });

  const runSuite = async (protocol: "ocpp1.6" | "ocpp2.0.1") => {
    server = new OCPPServer({ protocols: [protocol], logging: false });
    const port = ((await server.listen(0)).address() as AddressInfo).port;
    const results = new Map<string, { passed: boolean; issue?: string }>();
    await rpcSuite.run(
      { baseUrl: `ws://localhost:${port}/ocpp/CP001`, protocol },
      async (name, _severity, fn) => {
        results.set(name, await fn());
      },
    );
    return results;
  };

  // OCPP-J 1.6 §4.2.3 names the error FormationViolation; 2.0.1 and 2.1 name
  // it FormatViolation.
  it.each([
    "ocpp1.6",
    "ocpp2.0.1",
  ] as const)("passes a malformed-payload answer in the %s spelling", async (protocol) => {
    const results = await runSuite(protocol);
    expect(results.get("Server rejects missing payload in CALL")).toEqual({
      passed: true,
    });
    expect(results.get("Server rejects non-object payload in CALL")).toEqual({
      passed: true,
    });
  }, 30_000);

  // 2.0.1 and 2.1 answer a message ID they cannot read under "-1", with
  // RpcFrameworkError. 1.6 has no rule for it (O12).
  it("passes a 2.0.1 answer to an unreadable message ID", async () => {
    const results = await runSuite("ocpp2.0.1");
    expect(results.get("Server enforces MessageId is a string")).toEqual({
      passed: true,
    });
  }, 30_000);
});
