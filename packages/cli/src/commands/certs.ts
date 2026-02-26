import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import * as p from "@clack/prompts";
import pc from "picocolors";

export interface CertsOptions {
  type?: "ca" | "server" | "client";
  identity?: string;
  out?: string;
}

export async function runCerts(options: CertsOptions = {}): Promise<void> {
  p.intro(pc.bgMagenta(pc.white(" 🔐 OCPP Certificate Generator ")));

  // Ensure openssl is installed
  try {
    execSync("openssl version", { stdio: "ignore" });
  } catch (_err) {
    p.log.error("OpenSSL is not installed or not in your PATH.");
    p.log.error(
      pc.dim(
        "Windows Users: You can use Git Bash, WSL, or install OpenSSL via 'winget install -e --id ShiningLight.OpenSSL'",
      ),
    );
    p.log.error(pc.dim("Mac Users: 'brew install openssl'"));
    return;
  }

  let type = options.type;
  if (!type || !["ca", "server", "client"].includes(type)) {
    const result = await p.select({
      message: "What type of certificate do you want to generate?",
      options: [
        { value: "ca", label: "Root CA (ca.key, ca.pem) - Run this first!" },
        { value: "server", label: "Server Certificate (signed by Root CA)" },
        {
          value: "client",
          label: "Client Certificate (mTLS, signed by Root CA)",
        },
      ],
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    type = result as "ca" | "server" | "client";
  }

  let identity = options.identity;
  if (type !== "ca" && !identity) {
    const defaultId = type === "server" ? "localhost" : "CP-001";
    const result = await p.text({
      message: `Identity (Common Name / CN) for the ${type}`,
      initialValue: defaultId,
      validate: (val) => {
        if (!val?.trim()) return "Identity is required";
      },
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    identity = result as string;
  } else if (type === "ca") {
    identity = "OCPP-Local-CA";
  }

  let out = options.out;
  if (!out) {
    const result = await p.text({
      message: "Output directory for the certificates",
      initialValue: "./certs",
    });
    if (p.isCancel(result)) {
      p.cancel("Cancelled.");
      return;
    }
    out = result as string;
  }

  // Ensure output directory exists
  const outDir = path.resolve(process.cwd(), out);
  await fs.mkdir(outDir, { recursive: true });

  const s = p.spinner();

  if (type === "ca") {
    s.start("Generating Root CA (ca.key, ca.pem)...");
    try {
      const keyPath = path.join(outDir, "ca.key");
      const pemPath = path.join(outDir, "ca.pem");

      // Generate CA Private Key
      execSync(`openssl genrsa -out "${keyPath}" 4096`, { stdio: "ignore" });

      // Generate CA Certificate
      execSync(
        `openssl req -x509 -new -nodes -key "${keyPath}" -sha256 -days 3650 -out "${pemPath}" -subj "/CN=${identity}/O=OCPP-WS-IO"`,
        { stdio: "ignore" },
      );

      s.stop(pc.green("✔ Root CA generated successfully."));
      p.log.success(`CA Key: ${pc.cyan(keyPath)}`);
      p.log.success(`CA Cert: ${pc.cyan(pemPath)}`);
      p.note(
        "For clients to trust this server (or vice-versa), they must add ca.pem to their trusted root store.",
        "Next Steps",
      );
    } catch (err) {
      s.stop(pc.red("✖ Failed to generate Root CA."));
      p.log.error((err as { message: string }).message);
      process.exit(1);
    }
  } else {
    // Both server and client follow similar steps: Generate private key, create CSR, sign with CA.
    s.start(`Generating ${type} certificate for ${identity}...`);
    try {
      const caKeyPath = path.join(outDir, "ca.key");
      const caPemPath = path.join(outDir, "ca.pem");

      // Check if CA exists
      try {
        await fs.access(caKeyPath);
        await fs.access(caPemPath);
      } catch (_e) {
        s.stop(pc.red("✖ Root CA not found."));
        p.log.error(`Could not find ca.key and ca.pem in ${outDir}.`);
        p.log.error(
          `You must generate the Root CA first:\n  ocpp certs --type ca --out ${out}`,
        );
        process.exit(1);
      }

      const keyPath = path.join(outDir, `${identity}.key`);
      const csrPath = path.join(outDir, `${identity}.csr`);
      const pemPath = path.join(outDir, `${identity}.pem`);

      // 1. Generate Private Key
      execSync(`openssl genrsa -out "${keyPath}" 2048`, { stdio: "ignore" });

      // 2. Generate CSR (Certificate Signing Request)
      execSync(
        `openssl req -new -key "${keyPath}" -out "${csrPath}" -subj "/CN=${identity}/O=OCPP-WS-IO"`,
        { stdio: "ignore" },
      );

      // 3. Sign the CSR with our Root CA
      execSync(
        `openssl x509 -req -in "${csrPath}" -CA "${caPemPath}" -CAkey "${caKeyPath}" -CAcreateserial -out "${pemPath}" -days 825 -sha256`,
        { stdio: "ignore" },
      );

      // Cleanup CSR (no longer needed after signing)
      await fs.unlink(csrPath).catch(() => {});

      s.stop(
        pc.green(
          `✔ ${
            type.charAt(0).toUpperCase() + type.slice(1)
          } certificate generated successfully.`,
        ),
      );
      p.log.success(`Key: ${pc.cyan(keyPath)}`);
      p.log.success(`Cert: ${pc.cyan(pemPath)}`);

      if (type === "server") {
        p.note(
          "In your server configuration, supply the server key/pem and the CA pem.",
          "Server Setup",
        );
      } else {
        p.note(
          "Provide this key and cert to the Charge Point emulator for mTLS connection.",
          "mTLS Setup",
        );
      }
    } catch (err) {
      s.stop(pc.red(`✖ Failed to generate ${type} certificate.`));
      p.log.error((err as Error).message);
      process.exit(1);
    }
  }

  p.outro(pc.green("Done!"));
}
