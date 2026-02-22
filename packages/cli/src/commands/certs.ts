import { exec } from "node:child_process";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import pc from "picocolors";

const execAsync = promisify(exec);

export async function certsCommand(options: {
  identity?: string;
  out?: string;
  type?: "ca" | "server" | "client";
}) {
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Local TLS Certificate Authority`));

  const type = options.type || "server";
  const identity = options.identity || "CP-001";
  const outDir = options.out || "./certs";

  try {
    await fs.mkdir(outDir, { recursive: true });

    if (type === "ca") {
      console.log(pc.gray(`Generating Root Certificate Authority (CA)...`));
      await execAsync(
        `openssl req -x509 -newkey rsa:4096 -keyout ${join(
          outDir,
          "ca.key",
        )} -out ${join(
          outDir,
          "ca.crt",
        )} -days 3650 -nodes -subj "/CN=OCPP-Local-Root-CA"`,
      );
      console.log(
        pc.green(`✔ Success: CA Key and Cert generated at ${outDir}`),
      );
    } else if (type === "server") {
      console.log(pc.gray(`Generating Server Certificate...`));
      await execAsync(
        `openssl req -newkey rsa:4096 -keyout ${join(
          outDir,
          "server.key",
        )} -out ${join(outDir, "server.csr")} -nodes -subj "/CN=localhost"`,
      );
      console.log(pc.green(`✔ Success: Server CSR generated!`));
      console.log(
        pc.yellow(`ℹ Ensure you sign it with a CA (or use --type ca first)`),
      );
    } else if (type === "client") {
      console.log(
        pc.gray(`Generating Client Certificate for [${identity}]...`),
      );
      await execAsync(
        `openssl req -newkey rsa:2048 -keyout ${join(
          outDir,
          `${identity}.key`,
        )} -out ${join(
          outDir,
          `${identity}.csr`,
        )} -nodes -subj "/CN=${identity}"`,
      );
      console.log(pc.green(`✔ Success: Signed Client Cert for ${identity}`));
    }

    console.log();
  } catch (error: any) {
    console.error(
      pc.red(`\nGeneration failed. Ensure OpenSSL is installed on your OS.`),
    );
    console.error(pc.gray(error.message));
    process.exit(1);
  }
}
