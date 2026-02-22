import { intro, log, outro, spinner, text } from "@clack/prompts";
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

  console.clear();
  intro(pc.inverse(` ⚡ Automated Virtual Station Simulator [${protocol}] `));

  const authId = await text({
    message: "Default RFID Token for Auto-Starts:",
    initialValue: "AUTO-TAG-01",
  });
  const chargeRate = await text({
    message: "Charging Rate (Wh per 10s):",
    initialValue: "1500",
  });

  log.info(`Identity:    ${pc.bold(id)}`);
  log.info(`Target:      ${pc.blue(url)}`);
  log.info(`Auth Token:  ${pc.magenta(authId as string)}`);
  log.info(`Charge Rate: ${pc.cyan(`${chargeRate as string} Wh / 10s`)}\n`);

  const stationSpinner = spinner();
  stationSpinner.start(pc.gray(`Connecting automated engine to CSMS...`));

  // Internal State Machine
  let state: ChargePointState = "Available";
  let transactionId: number | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let currentMeter = 0;
  let sessionStartTime: number | null = null;

  // Render Live ATS Dashboard Panel
  function updateDashboard(actionStr: string) {
    const uptime = sessionStartTime
      ? Math.floor((Date.now() - sessionStartTime) / 1000)
      : 0;
    stationSpinner.message(
      `${pc.yellow(state.padEnd(14))} | Tx: ${pc.cyan(
        String(transactionId || "None").padEnd(5),
      )} | Meter: ${pc.blue(
        String(currentMeter).padEnd(6),
      )} Wh | Uptime: ${uptime}s\n` + `  └─ ${pc.gray(actionStr)}`,
    );
  }

  // Mock Configuration / Variables Database
  const configDatabase: Record<string, string> = {
    HeartbeatInterval: "60",
    ConnectionTimeOut: "30",
    MeterValueSampleInterval: "60",
    ResetRetries: "3",
  };

  const client = new OCPPClient({
    identity: id,
    endpoint: url,
    protocols: [protocol],
  });

  const stateToConnectorStatus = (s: ChargePointState) =>
    s === "Available"
      ? "Available"
      : s === "Charging" ||
          s === "Preparing" ||
          s === "Finishing" ||
          s === "SuspendedEV" ||
          s === "SuspendedEVSE"
        ? "Occupied"
        : s === "Reserved"
          ? "Reserved"
          : s === "Unavailable" || s === "Faulted"
            ? s
            : "Available";

  const setState = async (newState: ChargePointState) => {
    state = newState;
    updateDashboard(`[STATE] ➡ ${state}`);
    const payload =
      protocol === "ocpp1.6"
        ? { connectorId: 1, errorCode: "NoError", status: state }
        : {
            timestamp: new Date().toISOString(),
            connectorStatus: stateToConnectorStatus(state),
            evseId: 0,
            connectorId: 1,
          };
    await client
      .call(protocol as any, "StatusNotification", payload)
      .catch(() => {});
  };

  client.on("open", async () => {
    updateDashboard(`Connected to CSMS.`);

    // 1. Boot Sequence (payload shape differs by OCPP version)
    updateDashboard(`Initiating Boot Sequence...`);
    const bootPayload =
      protocol === "ocpp1.6"
        ? {
            chargePointVendor: "ocpp-ws-cli",
            chargePointModel: "VirtualStation-v1.0",
          }
        : {
            chargingStation: {
              model: "VirtualStation-v1.0",
              vendorName: "ocpp-ws-cli",
            },
            reason: "PowerUp",
          };
    const bootRes: any = await client.call(
      protocol as any,
      "BootNotification",
      bootPayload,
    );

    if (bootRes.status === "Accepted") {
      log.success(`BootNotification Accepted. Interval: ${bootRes.interval}s`);

      await setState("Available");

      heartbeatInterval = setInterval(async () => {
        // We don't log heartbeats to avoid spamming the beautiful UI spinner
        await client.call(protocol as any, "Heartbeat", {}).catch(() => {});
      }, bootRes.interval * 1000);
    } else {
      log.error(`Boot rejected. Configuration mismatch.`);
      stationSpinner.stop("Boot Rejected");
      process.exit(1);
    }
  });

  // -------------------------------------------------------------
  // AUTOMATED HARDWARE HANDLERS (method names differ by OCPP version)
  // OCPP 1.6: RemoteStartTransaction, RemoteStopTransaction, GetDiagnostics
  // OCPP 2.0.1/2.1: RequestStartTransaction, RequestStopTransaction, GetLog
  // -------------------------------------------------------------

  const idTagFromParams = (p: any) =>
    p.idToken?.idToken ??
    p.idTag ??
    (typeof p.idTag === "string" ? p.idTag : "");

  const handleRemoteStart = async (params: any) => {
    const idTag = idTagFromParams(params);
    updateDashboard(`[CSMS] Remote start requested for idTag ${idTag}`);

    if (state !== "Available") {
      updateDashboard(`[ERROR] Rejecting: Station is currently ${state}`);
      return { status: "Rejected" as const };
    }

    setTimeout(async () => {
      await setState("Preparing");
      const authPayload =
        protocol === "ocpp1.6"
          ? { idTag }
          : { idToken: { idToken: idTag, type: "Central" as const } };
      const authRes: any = await client.call(
        protocol as any,
        "Authorize",
        authPayload,
      );
      const accepted =
        authRes.idTagInfo?.status === "Accepted" ||
        authRes.idTokenInfo?.status === "Accepted";

      if (accepted) {
        if (protocol === "ocpp1.6") {
          const startRes: any = await client.call(
            protocol as any,
            "StartTransaction",
            {
              connectorId: 1,
              idTag,
              meterStart: currentMeter,
              timestamp: new Date().toISOString(),
            },
          );
          transactionId = startRes.transactionId;
        } else {
          // OCPP 2.0.1/2.1: report start via TransactionEvent
          const newTxId = transactionId || Math.floor(Math.random() * 1000);
          transactionId = newTxId;
          await client.call(protocol as any, "TransactionEvent", {
            eventType: "Started",
            timestamp: new Date().toISOString(),
            triggerReason: "RemoteStart",
            seqNo: 0,
            transactionInfo: {
              transactionId: String(newTxId),
              chargingState: "Charging",
            },
          });
        }
        await setState("Charging");
        sessionStartTime = Date.now();

        const meterInterval = setInterval(async () => {
          if (state !== "Charging") clearInterval(meterInterval);
          else {
            currentMeter += parseInt(String(chargeRate), 10);
            updateDashboard(
              `[CHARGING] Meter incremented by ${String(chargeRate)} Wh`,
            );
            await client
              .call(protocol as any, "MeterValues", {
                connectorId: 1,
                ...(transactionId && protocol === "ocpp1.6"
                  ? { transactionId }
                  : {}),
                meterValue: [
                  {
                    timestamp: new Date().toISOString(),
                    sampledValue: [{ value: String(currentMeter) }],
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

    return { status: "Accepted" as const };
  };

  const handleRemoteStop = async (params: any) => {
    const txId = params.transactionId;
    const txIdNum = typeof txId === "string" ? parseInt(txId, 10) : txId;
    updateDashboard(`[CSMS] Remote stop requested for txId ${txId}`);

    if (transactionId !== txIdNum && transactionId !== txId) {
      updateDashboard(`[ERROR] Rejecting stop: txId mismatch.`);
      return { status: "Rejected" as const };
    }

    setTimeout(async () => {
      await setState("Finishing");
      const txIdVal = transactionId ?? txIdNum;
      if (protocol === "ocpp1.6") {
        await client.call(protocol as any, "StopTransaction", {
          transactionId: txIdVal,
          idTag: "RemoteStop",
          meterStop: currentMeter,
          timestamp: new Date().toISOString(),
        });
      } else {
        await client.call(protocol as any, "TransactionEvent", {
          eventType: "Ended",
          timestamp: new Date().toISOString(),
          triggerReason: "RemoteStop",
          seqNo: 1,
          transactionInfo: {
            transactionId: String(txIdVal),
            chargingState: "SuspendedEV",
            stoppedReason: "Remote",
          },
        });
      }
      transactionId = null;
      sessionStartTime = null;
      await setState("Available");
    }, 1000);

    return { status: "Accepted" as const };
  };

  if (protocol === "ocpp1.6") {
    client.handle("ocpp1.6", "RemoteStartTransaction", (ctx) =>
      handleRemoteStart(ctx.params),
    );
    client.handle("ocpp1.6", "RemoteStopTransaction", (ctx) =>
      handleRemoteStop(ctx.params),
    );
  } else {
    client.handle(protocol as any, "RequestStartTransaction", (ctx) =>
      handleRemoteStart(ctx.params),
    );
    client.handle(protocol as any, "RequestStopTransaction", (ctx) =>
      handleRemoteStop(ctx.params),
    );
  }

  // CHANGE AVAILABILITY
  client.handle(protocol as any, "ChangeAvailability", async ({ params }) => {
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
  client.handle(protocol as any, "Reset", async ({ params }) => {
    console.log(
      pc.magenta(`\n[CSMS] Hardware Reset Requested: ${(params as any).type}`),
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
  client.handle(protocol as any, "UpdateFirmware", async ({ params }) => {
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
      await client.call(protocol as any, "FirmwareStatusNotification", {
        status: "Downloading",
      });

      console.log(
        pc.yellow(`[SIMULATOR] Downloading Firmware chunks via HTTP...`),
      );
      setTimeout(async () => {
        await client.call(protocol as any, "FirmwareStatusNotification", {
          status: "Downloaded",
        });

        console.log(pc.yellow(`[SIMULATOR] Installing...`));
        setTimeout(async () => {
          await client.call(protocol as any, "FirmwareStatusNotification", {
            status: "Installing",
          });

          console.log(pc.green(`✔ Firmware Installed.`));
          await client.call(protocol as any, "FirmwareStatusNotification", {
            status: "Installed",
          });
        }, 3000);
      }, 3000);
    }, 1000);

    return protocol === "ocpp1.6"
      ? ({} as any)
      : { status: "Accepted" as const };
  });

  // GET DIAGNOSTICS (OCPP 1.6 only; 2.0.1/2.1 use GetLog)
  if (protocol === "ocpp1.6") {
    client.handle("ocpp1.6", "GetDiagnostics", async ({ params }) => {
      const loc = (params as any).location ?? "Unknown location";
      console.log(pc.magenta(`\n[CSMS] Diagnostic Logs Upload Requested.`));
      console.log(pc.gray(` Upload Location:  ${loc}`));

      setTimeout(async () => {
        console.log(pc.yellow(`[SIMULATOR] Generating support .zip bundle...`));
        await client
          .call("ocpp1.6", "DiagnosticsStatusNotification", {
            status: "Uploading",
          })
          .catch(() => {});
        setTimeout(async () => {
          console.log(pc.green(`✔ Upload to ${loc} completed.`));
          await client
            .call("ocpp1.6", "DiagnosticsStatusNotification", {
              status: "Uploaded",
            })
            .catch(() => {});
        }, 3000);
      }, 1000);

      return { fileName: `diagnostics-${id}.zip` } as any;
    });
  } else {
    client.handle(protocol as any, "GetLog", async ({ params }) => {
      const loc =
        (params as any).log?.remoteLocation ??
        (params as any).location ??
        "Unknown location";
      console.log(pc.magenta(`\n[CSMS] GetLog (diagnostics) requested.`));
      console.log(pc.gray(` Upload Location:  ${loc}`));

      setTimeout(async () => {
        console.log(pc.yellow(`[SIMULATOR] Generating log bundle...`));
        await client
          .call(protocol as any, "LogStatusNotification", {
            status: "Uploading",
            requestId: (params as any).requestId ?? 0,
          })
          .catch(() => {});
        setTimeout(async () => {
          console.log(pc.green(`✔ Upload to ${loc} completed.`));
          await client
            .call(protocol as any, "LogStatusNotification", {
              status: "Uploaded",
              requestId: (params as any).requestId ?? 0,
            })
            .catch(() => {});
        }, 3000);
      }, 1000);

      return { status: "Accepted" as const, filename: `log-${id}.zip` };
    });
  }

  // CLEAR CACHE
  client.handle(protocol as any, "ClearCache", async () => {
    log.message(pc.magenta(`\n[CSMS] ClearCache Requested.`));
    log.info(pc.yellow(`[SIMULATOR] Wiping local RFID storage...`));
    return { status: "Accepted" };
  });

  // CONFIGURATION MANAGEMENT
  if (protocol === "ocpp1.6") {
    client.handle("ocpp1.6", "GetConfiguration", async ({ params }) => {
      const keys = (params as any).key || [];
      log.message(
        pc.magenta(
          `\n[CSMS] GetConfiguration requested for ${
            keys.length ? keys.join(", ") : "ALL"
          }`,
        ),
      );

      const configurationKey = [];
      const unknownKey = [];

      if (!keys.length) {
        for (const [k, v] of Object.entries(configDatabase)) {
          configurationKey.push({ key: k, readonly: false, value: v });
        }
      } else {
        for (const k of keys) {
          if (configDatabase[k] !== undefined) {
            configurationKey.push({
              key: k,
              readonly: false,
              value: configDatabase[k],
            });
          } else {
            unknownKey.push(k);
          }
        }
      }
      return { configurationKey, unknownKey } as any;
    });

    client.handle("ocpp1.6", "ChangeConfiguration", async ({ params }) => {
      const { key, value } = params as any;
      log.message(
        pc.magenta(`\n[CSMS] ChangeConfiguration requested: ${key} = ${value}`),
      );
      if (configDatabase[key] !== undefined || key) {
        configDatabase[key] = value;
        return { status: "Accepted" } as any;
      }
      return { status: "NotSupported" } as any;
    });
  } else {
    client.handle(protocol as any, "GetVariables", async ({ params }) => {
      const reqData = (params as any).getVariableData || [];
      log.message(
        pc.magenta(
          `\n[CSMS] GetVariables requested for ${reqData.length} items.`,
        ),
      );

      const getVariableResult = reqData.map((req: any) => {
        const val = configDatabase[req.variable.name];
        return {
          attributeStatus: val !== undefined ? "Accepted" : "UnknownVariable",
          component: req.component,
          variable: req.variable,
          attributeValue: val,
        };
      });
      return { getVariableResult } as any;
    });

    client.handle(protocol as any, "SetVariables", async ({ params }) => {
      const reqData = (params as any).setVariableData || [];
      log.message(
        pc.magenta(
          `\n[CSMS] SetVariables requested for ${reqData.length} items.`,
        ),
      );

      const setVariableResult = reqData.map((req: any) => {
        configDatabase[req.variable.name] = req.attributeValue;
        return {
          attributeStatus: "Accepted",
          component: req.component,
          variable: req.variable,
        };
      });
      return { setVariableResult } as any;
    });
  }

  client.on("close", () => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    stationSpinner.stop(pc.red(`Socket disconnected.`));
  });

  process.on("SIGINT", async () => {
    stationSpinner.stop(pc.yellow(`Shutting down Virtual Station...`));
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    await client.close();
    outro("Goodbye! ⚡");
    process.exit(0);
  });

  client.connect();
}
