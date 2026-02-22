import { OCPPClient } from "ocpp-ws-io";
import pc from "picocolors";

type ChargePointState =
  | "Available"
  | "Preparing"
  | "Charging"
  | "SuspendedEVSE"
  | "SuspendedEV"
  | "Finishing"
  | "Reserved"
  | "Unavailable"
  | "Faulted";

export async function virtualStationCommand(options: {
  identity?: string;
  endpoint?: string;
  protocol?: string;
}) {
  const id = options.identity || "VS-001";
  const url = options.endpoint || "ws://localhost:3000";
  const protocol = options.protocol || "ocpp1.6";

  console.log(
    pc.cyan(`\n⚡ ocpp-ws-cli: Virtual Station Simulator [${protocol}]`),
  );
  console.log(pc.gray(` Identity:   ${id}`));
  console.log(pc.gray(` Target:     ${url}`));

  // Internal State Machine
  let state: ChargePointState = "Available";
  let transactionId: number | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const client = new OCPPClient({
    identity: id,
    endpoint: url,
    protocols: [protocol],
  });

  const setState = async (newState: ChargePointState) => {
    state = newState;
    console.log(pc.yellow(`[STATE] ➡ ${state}`));
    await client
      .call("StatusNotification", {
        connectorId: 1,
        errorCode: "NoError",
        status: state,
      })
      .catch(() => {});
  };

  client.on("open", async () => {
    console.log(pc.green(`\n✔ Connected to CSMS.`));

    // 1. Boot Sequence
    console.log(pc.gray(`Initiating Boot Sequence...`));
    const bootRes: any = await client.call("BootNotification", {
      chargePointVendor: "ocpp-ws-cli",
      chargePointModel: "VirtualStation-v1.0",
    });

    if (bootRes.status === "Accepted") {
      console.log(
        pc.green(`✔ BootNotification Accepted. Interval: ${bootRes.interval}s`),
      );

      await setState("Available");

      heartbeatInterval = setInterval(async () => {
        console.log(pc.gray(`[Auto] Sending Heartbeat...`));
        await client.call("Heartbeat", {}).catch(() => {});
      }, bootRes.interval * 1000);
    } else {
      console.log(pc.red(`✖ Boot rejected. Configuration mismatch.`));
    }
  });

  // -------------------------------------------------------------
  // AUTOMATED HARDWARE HANDLERS
  // -------------------------------------------------------------

  // REMOTE START TRANSACTION
  client.handle("RemoteStartTransaction", async ({ params }) => {
    console.log(
      pc.magenta(
        `\n[CSMS] RemoteStartTransaction requested for idTag ${params.idTag}`,
      ),
    );

    if (state !== "Available") {
      console.log(pc.red(`✖ Rejecting: Station is currently ${state}`));
      return { status: "Rejected" };
    }

    // Process Start asynchronously
    setTimeout(async () => {
      await setState("Preparing");
      const authRes: any = await client.call("Authorize", {
        idTag: params.idTag,
      });

      if (authRes.idTagInfo?.status === "Accepted") {
        const startRes: any = await client.call("StartTransaction", {
          connectorId: 1,
          idTag: params.idTag,
          meterStart: 0,
          timestamp: new Date().toISOString(),
        });
        transactionId = startRes.transactionId;
        await setState("Charging");

        // Simulate generic charging meter values periodically while charging
        const meterInterval = setInterval(async () => {
          if (state !== "Charging") clearInterval(meterInterval);
          else {
            await client
              .call("MeterValues", {
                connectorId: 1,
                transactionId,
                meterValue: [
                  {
                    timestamp: new Date().toISOString(),
                    sampledValue: [{ value: "100" }],
                  },
                ],
              })
              .catch(() => {});
          }
        }, 10000);
      } else {
        await setState("Available");
      }
    }, 1000);

    return { status: "Accepted" };
  });

  // REMOTE STOP TRANSACTION
  client.handle("RemoteStopTransaction", async ({ params }) => {
    console.log(
      pc.magenta(
        `\n[CSMS] RemoteStopTransaction requested for txId ${params.transactionId}`,
      ),
    );

    if (transactionId !== params.transactionId) {
      return { status: "Rejected" };
    }

    setTimeout(async () => {
      await setState("Finishing");
      await client.call("StopTransaction", {
        transactionId,
        idTag: "RemoteStop",
        meterStop: 100,
        timestamp: new Date().toISOString(),
      });
      transactionId = null;
      await setState("Available");
    }, 1000);

    return { status: "Accepted" };
  });

  // CHANGE AVAILABILITY
  client.handle("ChangeAvailability", async ({ params }) => {
    const type = (params as any).type || (params as any).operationalStatus;
    console.log(pc.magenta(`\n[CSMS] ChangeAvailability to ${type}`));
    if (type === "Inoperative") {
      await setState("Unavailable");
      return { status: "Accepted" };
    } else {
      await setState("Available");
      return { status: "Accepted" };
    }
  });

  // RESET
  client.handle("Reset", async ({ params }) => {
    console.log(
      pc.magenta(`\n[CSMS] Hardware Reset Requested: ${params.type}`),
    );

    setTimeout(async () => {
      console.log(pc.red(`\n[SIMULATOR] Rebooting interface...`));
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      await client.close();

      setTimeout(() => {
        console.log(pc.yellow(`[SIMULATOR] Connecting...`));
        client.connect();
      }, 5000);
    }, 2000);

    return { status: "Accepted" };
  });

  // UPDATE FIRMWARE
  client.handle("UpdateFirmware", async ({ params }) => {
    console.log(pc.magenta(`\n[CSMS] OTA Firmware Update Requested.`));
    const loc =
      (params as any).location ||
      (params as any).firmware?.location ||
      "Unknown location";
    console.log(pc.gray(` Download Location:  ${loc}`));
    console.log(
      pc.gray(` Retries:            ${(params as any).retries || "default"}`),
    );

    setTimeout(async () => {
      await client.call("FirmwareStatusNotification", {
        status: "Downloading",
      });

      console.log(
        pc.yellow(`[SIMULATOR] Downloading Firmware chunks via HTTP...`),
      );
      setTimeout(async () => {
        await client.call("FirmwareStatusNotification", {
          status: "Downloaded",
        });

        console.log(pc.yellow(`[SIMULATOR] Installing...`));
        setTimeout(async () => {
          await client.call("FirmwareStatusNotification", {
            status: "Installing",
          });

          console.log(pc.green(`✔ Firmware Installed.`));
          await client.call("FirmwareStatusNotification", {
            status: "Installed",
          });
        }, 3000);
      }, 3000);
    }, 1000);

    return {};
  });

  // GET DIAGNOSTICS
  client.handle("GetDiagnostics", async ({ params }) => {
    console.log(pc.magenta(`\n[CSMS] Diagnostic Logs Upload Requested.`));
    const loc =
      (params as any).location ||
      (params as any).log?.remoteLocation ||
      "Unknown location";
    console.log(pc.gray(` Upload Location:  ${loc}`));

    setTimeout(async () => {
      console.log(pc.yellow(`[SIMULATOR] Generating support .zip bundle...`));
      await client
        .call("DiagnosticsStatusNotification", {
          status: "Uploading",
        })
        .catch(() => {});

      setTimeout(async () => {
        console.log(pc.green(`✔ Upload to ${loc} completed.`));
        await client
          .call("DiagnosticsStatusNotification", {
            status: "Uploaded",
          })
          .catch(() => {});
      }, 3000);
    }, 1000);

    // Return the expected filename based on the spec
    return { fileName: `diagnostics-${id}.zip` } as any;
  });

  // CLEAR CACHE
  client.handle("ClearCache", async () => {
    console.log(pc.magenta(`\n[CSMS] ClearCache Requested.`));
    console.log(pc.yellow(`[SIMULATOR] Wiping local RFID storage...`));
    return { status: "Accepted" };
  });

  client.on("close", () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    console.log(pc.red(`\nSocket disconnected.`));
  });

  process.on("SIGINT", async () => {
    console.log(pc.yellow(`\nShutting down Virtual Station...`));
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await client.close();
    process.exit(0);
  });

  client.connect();
}
