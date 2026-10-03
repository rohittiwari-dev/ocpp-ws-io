import fs from "node:fs";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { generateProtocolFiles } from "../lib/protocol-files.js";
import { fetchSchema } from "../lib/schema-fetcher.js";
import type { SchemaEntry } from "../lib/type-generator.js";

const EXAMPLE_SCHEMA_URL =
  "https://ocpp-ws-io.rohittiwari.me/schema-example.json";

interface GenerateOptions {
  out?: string;
  schema?: string;
  name?: string;
}

export async function runGenerate(options: GenerateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" ⚡ OCPP Type Generator ")));

  // ── Schema source ───────────────────────────────────────────

  let schemaSource: string;

  if (options.schema) {
    schemaSource = options.schema;
  } else {
    const result = await p.text({
      message:
        "Enter a schema URL or local file path to generate types from.\n" +
        pc.dim(
          "  This should be a JSON array of OCPP-style schema entries with $id fields.\n" +
            `  Example: ${pc.underline(EXAMPLE_SCHEMA_URL)}`,
        ),
      initialValue: EXAMPLE_SCHEMA_URL,
      validate: (val) => {
        if (!val?.trim()) return "Schema source is required";
      },
    });

    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }

    schemaSource = result as string;
  }

  // ── Subprotocol name ────────────────────────────────────────

  let subprotocol: string;

  if (options.name) {
    subprotocol = options.name;
  } else {
    const result = await p.text({
      message:
        "What subprotocol name should these types be registered under?\n" +
        pc.dim(
          "  This maps to the protocol string in OCPPClient<P> / server.handle(protocol, ...).\n" +
            '  Examples: "ocpp1.6", "ocpp2.0.1", "my-custom-protocol"',
        ),
      initialValue: "my-custom-protocol",
      validate: (val) => {
        if (!val?.trim()) return "Subprotocol name is required";
      },
    });

    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }

    subprotocol = result as string;
  }

  // ── Output directory ────────────────────────────────────────

  let outDir: string;

  if (options.out) {
    outDir = path.resolve(options.out);
  } else {
    const result = await p.text({
      message: "Where should the types be generated?",
      initialValue: "./@types/ocpp-ws-io",
      validate: (val) => {
        if (!val?.trim()) return "Directory path is required";
      },
    });

    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }

    outDir = path.resolve(result as string);
  }

  // ── Fetch & Generate ────────────────────────────────────────

  const spinner = p.spinner();

  spinner.start(
    `Fetching schema from ${pc.cyan(
      schemaSource.length > 60 ? `...${schemaSource.slice(-57)}` : schemaSource,
    )}`,
  );

  let schema: SchemaEntry[];
  try {
    schema = await fetchSchema(schemaSource);
  } catch (err) {
    spinner.stop(`${pc.red("✗")} Failed to fetch schema`);
    p.log.error((err as Error).message);
    p.outro(pc.red("Generation failed."));
    process.exit(1);
  }

  spinner.stop(`${pc.green("✓")} Schema loaded — ${schema.length} entries`);

  // ── Generate types, augmentation and validator ─────────────

  spinner.start(`Generating ${pc.cyan(subprotocol)} types and validator...`);

  const generated = generateProtocolFiles(
    schema,
    subprotocol,
    path.basename(schemaSource),
  );
  const { methods, sendMethods, validatorName, version } = generated;

  if (methods.size === 0 && sendMethods.size === 0) {
    spinner.stop(`${pc.yellow("⚠")} No methods found in schema`);
    p.log.warn(
      "The schema must contain entries with $id fields matching:\n" +
        pc.dim("  urn:MethodName.req / urn:MethodName.conf\n") +
        pc.dim("  urn:MethodNameRequest / urn:MethodNameResponse\n") +
        pc.dim("  urn:MessageName (an unconfirmed SEND message)"),
    );
    p.outro(pc.red("No types generated."));
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, content] of generated.files) {
    fs.writeFileSync(path.join(outDir, name), content);
  }

  const fileNames = [...generated.files.keys()].join(", ");
  const sendNote = sendMethods.size
    ? `, ${sendMethods.size} SEND messages`
    : "";
  spinner.stop(
    `${pc.green("✓")} ${pc.bold(subprotocol)} — ${
      methods.size
    } methods${sendNote} → ${pc.dim(fileNames)}`,
  );

  // ── Summary ─────────────────────────────────────────────────

  const methodNames = [...methods.keys(), ...sendMethods.keys()].slice(0, 5);
  const moreCount = methods.size + sendMethods.size - methodNames.length;
  const relDir = path.relative(process.cwd(), outDir).split(path.sep).join("/");
  // An import needs "./" before a directory below this one; one on another
  // drive stays absolute.
  let importDir = relDir || ".";
  if (!path.isAbsolute(importDir) && !/^\.\.?(\/|$)/.test(importDir)) {
    importDir = `./${importDir}`;
  }

  p.note(
    [
      `${pc.bold("Output:")}      ${pc.dim(outDir)}`,
      `${pc.bold("Protocol:")}    ${subprotocol}`,
      `${pc.bold("Methods:")}     ${methods.size} total${sendNote}`,
      `${pc.bold("Files:")}       ${fileNames}`,
      "",
      pc.dim("Methods: ") +
        methodNames.map((m) => pc.cyan(m)).join(", ") +
        (moreCount > 0 ? pc.dim(` +${moreCount} more`) : ""),
      "",
      pc.dim("Add to tsconfig.json:"),
      "",
      pc.cyan(`  "include": ["${relDir}/**/*"]`),
      "",
      pc.dim("Validate in strict mode:"),
      "",
      pc.cyan(
        `  import { ${validatorName} } from "${importDir}/${version.key}.validator.js";`,
      ),
      pc.cyan(`  strictModeValidators: [${validatorName}]`),
    ].join("\n"),
    "✨ Generation Complete",
  );

  p.outro(
    `${pc.green("Done!")} Types and validator ready at ${pc.underline(
      path.relative(process.cwd(), outDir),
    )}`,
  );
}
