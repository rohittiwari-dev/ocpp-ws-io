import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import pc from "picocolors";

export async function parseCommand(
  rawPayload: string,
  options: { protocol?: string; method?: string },
) {
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Payload Translator`));

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
      console.log(pc.gray(`Loaded payload from file: ${filePath}`));
    } catch (err: any) {
      console.error(pc.red(`Failed to read input file: ${err.message}`));
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
      console.log(
        pc.blue(
          `\n[CALL]  → Method: ${pc.green(method)}  | MsgID: ${pc.yellow(
            messageId,
          )}`,
        ),
      );
    } else if (typeId === 3) {
      body = ocppTuple[2];
      console.log(pc.green(`\n[REPLY] ← MsgID: ${pc.yellow(messageId)}`));
    } else if (typeId === 4) {
      body = ocppTuple[4];
      const errorText = ocppTuple[2];
      const errorDesc = ocppTuple[3];
      console.log(
        pc.red(
          `\n[ERROR] ✖ MsgID: ${pc.yellow(
            messageId,
          )}  | ${errorText} - ${errorDesc}`,
        ),
      );
    } else {
      throw new Error(`Unknown Transaction Type ID: ${typeId}`);
    }

    console.log(pc.gray(`══════════════════════════════════════════════════`));
    console.dir(body, { depth: null, colors: true });

    // Future expansion: we can link this to the internal Validator module
    // if the user passes a protocol directory here to run schema validation!
  } catch (error: any) {
    console.error(
      pc.red(`\n✖ Parse Error: Invalid JSON or OCPP protocol format.`),
    );
    console.error(pc.gray(error.message));

    if (!payloadStr) {
      console.log(pc.yellow(`\nExample syntax:`));
      console.log(`ocpp parse '[2, "123", "Heartbeat", {}]'`);
    }
  }
}
