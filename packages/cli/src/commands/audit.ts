import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

export async function auditCommand(options: {
  endpoint?: string;
  generateReport?: boolean;
}) {
  console.log(pc.cyan(`\n⚡ ocpp-cli: CSMS Compliance Auditor`));

  const targetUrl = options.endpoint || "ws://localhost:3000";
  console.log(pc.gray(`Target CSMS: ${targetUrl}\n`));
  console.log(pc.yellow(`Starting OCA compliance assault. Stand by...\n`));

  let passed = 0;
  let failed = 0;

  const client = new OCPPClient({
    identity: "Compliance-Auditor",
    endpoint: targetUrl,
    protocols: ["ocpp1.6"],
    reconnect: false,
    strictMode: false, // We must be allowed to send bad payloads!
  });

  client.on("open", async () => {
    // 1. Valid BootNotification
    await runTest("Valid BootNotification", async () => {
      const res = await client.call("BootNotification", {
        chargePointModel: "Auditor",
        chargePointVendor: "OCA",
      });
      if ((res as any).status !== "Accepted")
        throw new Error("BootNotification was rejected");
    });

    // 2. Mission-Critical Missing Fields (Strict Mode Check)
    await runTest("Malformed Missing Field (Strict Mode Test)", async () => {
      try {
        // Missing chargePointModel/Vendor
        await client.call("BootNotification", {});
        throw new Error(
          "Server accepted an invalid payload without schema rejection.",
        );
      } catch (err: any) {
        // We expect an error here!
        if (!err.message || err.message.includes("accepted")) {
          throw err;
        }
      }
    });

    // 3. Spurious Payload Types
    await runTest("Spurious Array Payload (Fuzzer Defense)", async () => {
      try {
        // Send an array instead of an object body
        await client.call("Heartbeat", [] as any);
        throw new Error(
          "Server accepted an Array instead of an Object payload.",
        );
      } catch (err: any) {
        if (!err.message || err.message.includes("accepted")) throw err;
      }
    });

    console.log(
      pc.gray(`\n══════════════════════════════════════════════════`),
    );
    if (failed === 0) {
      console.log(
        pc.green(
          `✔ CSMS Passed the Baseline Audit! (${passed}/${
            passed + failed
          } checks)`,
        ),
      );
    } else {
      console.log(pc.red(`✖ CSMS Failed ${failed} compliance checks.`));
    }

    console.log(pc.gray(`Disconnecting...`));
    await client.close();
    process.exit(0);
  });

  client.on("error", () => {
    console.log(pc.red(`\n✖ Critical failure: Could not connect to CSMS.`));
    process.exit(1);
  });

  client.connect();

  async function runTest(name: string, fn: () => Promise<void>) {
    process.stdout.write(`- ${name}... `);
    try {
      await fn();
      console.log(pc.green("PASS"));
      passed++;
    } catch (err: any) {
      console.log(pc.red(`FAIL (${err.message})`));
      failed++;
    }
  }
}
