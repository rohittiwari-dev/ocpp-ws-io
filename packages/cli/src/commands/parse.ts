import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { intro, log, outro } from "@clack/prompts";
import pc from "picocolors";

export async function parseCommand(
  rawPayload: string,
  options: { protocol?: string; method?: string },
) {
  console.clear();
  intro(pc.inverse(` ⚡ Payload Translator `));

  let payloadStr = rawPayload || "";

  // If a file path was passed instead of a raw string, load the file
  if (
    payloadStr.endsWith(".json") ||
    payloadStr.startsWith("./") ||
    payloadStr.startsWith("/")
  ) {
    try {
      const filePath = resolve(process.cwd(), payloadStr);
      payloadStr = await fs.readFile(filePath, "utf-8");
      log.info(pc.gray(`Loaded payload from file: ${filePath}`));
    } catch (err: any) {
      log.error(pc.red(`Failed to read input file: ${err.message}`));
      process.exit(1);
    }
  }

  try {
    const ocppTuple = JSON.parse(payloadStr);

    if (!Array.isArray(ocppTuple)) {
      throw new Error("OCPP Payloads must be valid JSON Arrays (tuples).");
    }

    const typeId = ocppTuple[0];
    const messageId = ocppTuple[1];
    let method = options.method || "Unknown";
    let body = {};

    if (typeId === 2) {
      method = ocppTuple[2];
      body = ocppTuple[3];
      log.success(
        pc.blue(
          `[CALL]  → Method: ${pc.green(method)}  | MsgID: ${pc.yellow(
            messageId,
          )}`,
        ),
      );
    } else if (typeId === 3) {
      body = ocppTuple[2];
      log.success(pc.green(`[REPLY] ← MsgID: ${pc.yellow(messageId)}`));
    } else if (typeId === 4) {
      body = ocppTuple[4];
      const errorText = ocppTuple[2];
      const errorDesc = ocppTuple[3];
      log.error(
        pc.red(
          `[ERROR] ✖ MsgID: ${pc.yellow(
            messageId,
          )}  | ${errorText} - ${errorDesc}`,
        ),
      );
    } else {
      throw new Error(`Unknown Transaction Type ID: ${typeId}`);
    }

    log.step(pc.gray(`════════════════ Payload Body ════════════════`));
    console.dir(body, { depth: null, colors: true });
    outro(pc.green(`Parsing complete.`));

    // Future expansion: we can link this to the internal Validator module
    // if the user passes a protocol directory here to run schema validation!
  } catch (error: any) {
    log.error(pc.red(`✖ Parse Error: Invalid JSON or OCPP protocol format.`));
    log.message(pc.gray(error.message));

    if (!payloadStr) {
      log.warn(pc.yellow(`Example syntax:`));
      log.message(`ocpp parse '[2, "123", "Heartbeat", {}]'`);
    }
    process.exit(1);
  }
}
