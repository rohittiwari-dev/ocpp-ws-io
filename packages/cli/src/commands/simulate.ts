import {
  confirm,
  intro,
  log,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
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

export async function simulateCommand(options: {
  identity?: string;
  endpoint?: string;
  protocol?: string;
}) {
  const id = options.identity || "Simulated-CP-01";
  const protocol = options.protocol || "ocpp1.6";
  let wsUrl: URL;

  try {
    wsUrl = new URL(options.endpoint || "ws://localhost:3000");
  } catch (_err) {
    console.error(pc.red(`Error: Invalid endpoint URL '${options.endpoint}'`));
    process.exit(1);
  }

  // --- STATE MACHINE ---
  let currentState: ChargePointState = "Available";
  let currentTxId: number | string | null = null;
  let currentMeter = 0;
  let idTagBuffer = "DEADBEEF";
  // ---------------------

  console.clear();
  intro(pc.inverse(` ⚡ Interactive Simulator: ${id} [${protocol}] `));
  log.info(`Target: ${pc.blue(wsUrl.toString())}`);

  const client = new OCPPClient({
    identity: id,
    endpoint: wsUrl.toString(),
    protocols: [protocol],
  });

  const connectionSpinner = spinner();
  connectionSpinner.start("Connecting to CSMS...");

  let isIntentionalClose = false;

  client.on("open", async () => {
    connectionSpinner.stop(pc.green(`✔ Connected to CSMS via ${protocol}!`));
    await promptUser();
  });

  client.on("close", () => {
    if (!isIntentionalClose) {
      log.warn(pc.yellow(`✖ Disconnected. Attempting to reconnect...`));
    }
  });

  client.on("error", (err: unknown) => {
    log.error(pc.red(`✖ Connection error: ${(err as Error).message}`));
  });

  function renderStatsPanel() {
    console.log(pc.gray(`\n╭─ Charger State ──────────────────────╮`));
    console.log(
      `│ ${pc.bold("Status:")}      ${pc.yellow(currentState.padEnd(17))} │`,
    );
    console.log(
      `│ ${pc.bold("TxID:")}        ${pc.cyan(
        String(currentTxId || "None").padEnd(17),
      )} │`,
    );
    console.log(
      `│ ${pc.bold("Meter (Wh):")}  ${pc.magenta(
        String(currentMeter).padEnd(17),
      )} │`,
    );
    console.log(
      `│ ${pc.bold("Auth Tag:")}    ${pc.blue(
        String(idTagBuffer).padEnd(17),
      )} │`,
    );
    console.log(pc.gray(`╰──────────────────────────────────────╯\n`));
  }

  async function promptUser() {
    while (true) {
      if (isIntentionalClose) break;

      renderStatsPanel();

      const methods16 = [
        {
          value: "BootNotification",
          label: "BootNotification",
          hint: "Power up",
        },
        { value: "Heartbeat", label: "Heartbeat", hint: "Keep-alive" },
        {
          value: "StatusNotification",
          label: "StatusNotification",
          hint: "Change Hardware State",
        },
        { value: "Authorize", label: "Authorize", hint: "Validate RFID" },
        {
          value: "StartTransaction",
          label: "StartTransaction",
          hint: "Begin Charging",
        },
        {
          value: "StopTransaction",
          label: "StopTransaction",
          hint: "End Charging",
        },
        {
          value: "MeterValues",
          label: "MeterValues",
          hint: "Send Energy Data",
        },
        {
          value: "DataTransfer",
          label: "DataTransfer",
          hint: "Custom messages",
        },
        {
          value: "DiagnosticsStatusNotification",
          label: "DiagnosticsStatusNotification",
        },
        {
          value: "FirmwareStatusNotification",
          label: "FirmwareStatusNotification",
        },
        { value: "Quit", label: pc.red("Quit Simulator") },
      ];

      const methods20 = [
        { value: "BootNotification", label: "BootNotification" },
        { value: "Heartbeat", label: "Heartbeat" },
        { value: "StatusNotification", label: "StatusNotification" },
        { value: "Authorize", label: "Authorize" },
        {
          value: "TransactionEvent",
          label: "TransactionEvent",
          hint: "Start/Update/Stop Sessions",
        },
        { value: "MeterValues", label: "MeterValues" },
        { value: "DataTransfer", label: "DataTransfer" },
        { value: "LogStatusNotification", label: "LogStatusNotification" },
        {
          value: "FirmwareStatusNotification",
          label: "FirmwareStatusNotification",
        },
        { value: "NotifyReport", label: "NotifyReport" },
        { value: "Quit", label: pc.red("Quit Simulator") },
      ];

      const optionsList = protocol === "ocpp1.6" ? methods16 : methods20;

      const cmd = await select({
        message: "Select an OCPP action to simulate:",
        options: optionsList,
      });

      if (cmd === "Quit" || cmd === undefined) {
        isIntentionalClose = true;
        log.info(pc.yellow("Exiting simulation gracefully..."));
        await client.close();
        outro(pc.green("Simulation ended."));
        process.exit(0);
      }

      let payload: any = {};
      const action = cmd as string;

      // -------------------------------------------------------------
      // CUSTOMIZABLE PAYLOAD BUILDERS WITH STATE MACHINE ENFORCEMENT
      // -------------------------------------------------------------

      if (action === "BootNotification") {
        const model = await text({
          message: "ChargePointModel:",
          initialValue: "CLI-Simulator",
        });
        if (protocol === "ocpp1.6") {
          payload = {
            chargePointModel: model as string,
            chargePointVendor: "ocpp-ws-io",
          };
        } else {
          payload = {
            chargingStation: {
              model: model as string,
              vendorName: "ocpp-ws-io",
            },
            reason: "PowerUp",
          };
        }
      } else if (action === "Heartbeat") {
        payload = {};
      } else if (action === "StatusNotification") {
        const newState = await select({
          message: "Select new hardware state:",
          options: [
            { value: "Available", label: "Available" },
            { value: "Preparing", label: "Preparing" },
            { value: "Charging", label: "Charging" },
            { value: "SuspendedEVSE", label: "SuspendedEVSE" },
            { value: "SuspendedEV", label: "SuspendedEV" },
            { value: "Finishing", label: "Finishing" },
            { value: "Reserved", label: "Reserved" },
            { value: "Unavailable", label: "Unavailable" },
            { value: "Faulted", label: "Faulted" },
          ],
        });
        if (!newState) continue;
        currentState = newState as ChargePointState;

        const errorCode = await text({
          message: "ErrorCode (Optional):",
          initialValue: "NoError",
        });

        if (protocol === "ocpp1.6") {
          payload = {
            connectorId: 1,
            errorCode: errorCode as string,
            status: currentState,
          };
        } else {
          payload = {
            timestamp: new Date().toISOString(),
            connectorStatus:
              currentState === "Charging" ||
              currentState === "Preparing" ||
              currentState === "Finishing" ||
              currentState === "SuspendedEV"
                ? "Occupied"
                : currentState,
            evseId: 1,
            connectorId: 1,
          };
        }
      } else if (action === "Authorize") {
        const idTag = await text({
          message: "Enter idTag / idToken:",
          initialValue: idTagBuffer,
        });
        if (!idTag) continue;
        idTagBuffer = idTag as string;

        if (protocol === "ocpp1.6") {
          payload = { idTag: idTagBuffer };
        } else {
          payload = { idToken: { idToken: idTagBuffer, type: "ISO14443" } };
        }
      } else if (action === "StartTransaction") {
        if (currentState !== "Available" && currentState !== "Preparing") {
          log.error(
            pc.red(
              `Cannot start transaction! Currently in state: ${currentState}`,
            ),
          );
          continue;
        }

        const idTag = await text({
          message: "idTag:",
          initialValue: idTagBuffer,
        });
        if (!idTag) continue;
        idTagBuffer = idTag as string;

        const meter = await text({
          message: "meterStart (Wh):",
          initialValue: String(currentMeter),
        });
        if (!meter) continue;
        currentMeter = parseInt(meter as string, 10);

        payload = {
          connectorId: 1,
          idTag: idTagBuffer,
          meterStart: currentMeter,
          timestamp: new Date().toISOString(),
        };
      } else if (action === "StopTransaction") {
        if (!currentTxId) {
          log.error(pc.red(`Cannot stop transaction! No active transaction.`));
          continue;
        }

        const txIdStr = await text({
          message: "transactionId:",
          initialValue: String(currentTxId),
        });
        if (!txIdStr) continue;

        const meter = await text({
          message: "meterStop (Wh):",
          initialValue: String(currentMeter + 1500),
        });
        if (!meter) continue;
        currentMeter = parseInt(meter as string, 10);

        const reason = await select({
          message: "Stop Reason:",
          options: [
            { value: "Local", label: "Local" },
            { value: "Remote", label: "Remote" },
            { value: "EVDisconnected", label: "EVDisconnected" },
          ],
        });
        if (!reason) continue;

        payload = {
          transactionId: parseInt(txIdStr as string, 10),
          meterStop: currentMeter,
          timestamp: new Date().toISOString(),
          reason: reason as string,
        };
      } else if (action === "TransactionEvent") {
        const eventType = await select({
          message: "Event Type:",
          options: [
            { value: "Started", label: "Started" },
            { value: "Updated", label: "Updated" },
            { value: "Ended", label: "Ended" },
          ],
        });
        if (!eventType) continue;

        if (eventType === "Started") {
          if (currentState !== "Available" && currentState !== "Preparing") {
            log.error(
              pc.red(`Cannot start! Currently in state: ${currentState}`),
            );
            continue;
          }
        } else if (eventType === "Ended" && !currentTxId) {
          log.error(pc.red(`Cannot end! No active transaction.`));
          continue;
        }

        const seqNo = await text({
          message: "Sequence Number:",
          initialValue: eventType === "Started" ? "0" : "1",
        });
        if (!seqNo) continue;

        const txIdStr = await text({
          message: "transactionId:",
          initialValue:
            eventType === "Started"
              ? `TX-${Math.floor(Math.random() * 1000)}`
              : String(currentTxId),
        });
        if (!txIdStr) continue;

        let meterObj = {};
        if (eventType !== "Started") {
          const meter = await text({
            message: `meterValue (Wh) for ${String(eventType)}:`,
            initialValue: String(currentMeter + 1000),
          });
          if (!meter) continue;
          currentMeter = parseInt(meter as string, 10);
          meterObj = {
            meterValue: [
              {
                timestamp: new Date().toISOString(),
                sampledValue: [{ value: String(currentMeter) }],
              },
            ],
          };
        }

        const chargingState =
          eventType === "Started" || eventType === "Updated"
            ? "Charging"
            : "SuspendedEV";

        payload = {
          eventType: eventType as string,
          timestamp: new Date().toISOString(),
          triggerReason: "Authorized",
          seqNo: parseInt(seqNo as string, 10),
          transactionInfo: {
            transactionId: txIdStr as string,
            chargingState: chargingState,
          },
          ...meterObj,
        };
      } else if (action === "MeterValues") {
        if (!currentTxId) {
          log.warn(pc.yellow(`Sending MeterValues OUTSIDE of a transaction.`));
        }

        const meter = await text({
          message: "meterValue (Wh):",
          initialValue: String(currentMeter + 500),
        });
        if (!meter) continue;
        currentMeter = parseInt(meter as string, 10);

        if (protocol === "ocpp1.6") {
          payload = {
            connectorId: 1,
            ...(currentTxId
              ? { transactionId: parseInt(String(currentTxId), 10) }
              : {}),
            meterValue: [
              {
                timestamp: new Date().toISOString(),
                sampledValue: [{ value: String(currentMeter) }],
              },
            ],
          };
        } else {
          payload = {
            evseId: 1,
            meterValue: [
              {
                timestamp: new Date().toISOString(),
                sampledValue: [{ value: String(currentMeter) }],
              },
            ],
          };
        }
      } else if (action === "DataTransfer") {
        const vendorId = await text({
          message: "Vendor ID:",
          initialValue: "ocpp-ws-io",
        });
        if (!vendorId) continue;

        const messageId = await text({
          message: "Message ID:",
          initialValue: "Ping",
        });
        if (!messageId) continue;

        const dataStr = await text({
          message: "Data Payload (JSON string):",
          initialValue: '{"ping": true}',
        });
        if (!dataStr) continue;

        payload = {
          vendorId: vendorId as string,
          messageId: messageId as string,
          data: dataStr as string,
        };
      } else if (action === "DiagnosticsStatusNotification") {
        const status = await select({
          message: "Status:",
          options: [
            { value: "Uploading", label: "Uploading" },
            { value: "Uploaded", label: "Uploaded" },
            { value: "UploadFailed", label: "UploadFailed" },
          ],
        });
        if (!status) continue;
        payload = { status: status as string };
      } else if (action === "FirmwareStatusNotification") {
        const status = await select({
          message: "Status:",
          options: [
            { value: "Downloading", label: "Downloading" },
            { value: "Downloaded", label: "Downloaded" },
            { value: "Installing", label: "Installing" },
            { value: "Installed", label: "Installed" },
          ],
        });
        if (!status) continue;
        payload = { status: status as string };
      } else if (action === "LogStatusNotification") {
        const status = await select({
          message: "Status:",
          options: [
            { value: "Uploading", label: "Uploading" },
            { value: "Uploaded", label: "Uploaded" },
          ],
        });
        if (!status) continue;
        const reqId = await text({ message: "requestId:", initialValue: "1" });
        payload = {
          status: status as string,
          requestId: parseInt(reqId as string, 10),
        };
      } else if (action === "NotifyReport") {
        payload = {
          requestId: 0,
          generatedAt: new Date().toISOString(),
          seqNo: 0,
          tbc: false,
        };
      }

      // --- EXECUTE REQUEST ---

      const review = await confirm({
        message: `Send ${action} with payload:\n${pc.gray(
          JSON.stringify(payload, null, 2),
        )}\n\nProceed?`,
        active: "Yes",
        inactive: "No",
      });

      if (!review) {
        log.info("Request cancelled.");
        continue;
      }

      const s = spinner();
      s.start(`Sending ${action}...`);
      try {
        const res: any = await client.call(protocol as any, action, payload);
        s.stop(pc.green(`✔ ${action} Response:`));
        console.log(pc.gray(JSON.stringify(res, null, 2)));

        // --- POST SUCCESS STATE MACHINE MUTATIONS ---
        if (
          action === "StartTransaction" &&
          res.idTagInfo?.status === "Accepted"
        ) {
          currentTxId = res.transactionId;
          currentState = "Charging";
        } else if (
          action === "TransactionEvent" &&
          payload.eventType === "Started"
        ) {
          currentTxId = payload.transactionInfo.transactionId;
          currentState = "Charging";
        } else if (
          action === "StopTransaction" &&
          res.idTagInfo?.status === "Accepted"
        ) {
          currentTxId = null;
          currentState = "Available";
        } else if (
          action === "TransactionEvent" &&
          payload.eventType === "Ended"
        ) {
          currentTxId = null;
          currentState = "Available";
        } else if (action === "BootNotification" && res.status === "Accepted") {
          currentState = "Available";
        }
      } catch (err: any) {
        s.stop(pc.red(`✖ Command failed: ${err.message}`));
      }
    }
  }

  client.connect();
}
