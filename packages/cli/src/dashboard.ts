import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  outro,
  select,
  text,
} from "@clack/prompts";
import pc from "picocolors";

export async function runDashboard() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const binaryPath = join(__dirname, "index.js");

  while (true) {
    console.clear();
    intro(pc.inverse(pc.bold(" ⚡ ocpp-ws-cli dashboard ")));

    const cmdType = await select({
      message: "What do you want to launch?",
      options: [
        {
          value: "virtual-station",
          label: "Virtual Station",
          hint: "Automated CP Simulator",
        },
        {
          value: "simulate",
          label: "Simulate",
          hint: "Interactive Terminal Simulator",
        },
        { value: "call", label: "Call", hint: "Send one-off JSON payload" },
        {
          value: "tail",
          label: "Tail",
          hint: "WebSocket Network Stream Sniffer",
        },
        { value: "top", label: "Top", hint: "Live Redis Cluster Dashboard" },
        {
          value: "load-test",
          label: "Load Test",
          hint: "Distributed Load Engine",
        },
        { value: "fuzz", label: "Fuzz", hint: "Protocol Security Tester" },
        { value: "mock", label: "Mock", hint: "API Server for Frontend Devs" },
        { value: "ota", label: "OTA", hint: "Firmware Hosting Server" },
        { value: "parse", label: "Parse", hint: "Payload Translator" },
        { value: "replay", label: "Replay", hint: "Network Engine Replay" },
        { value: "audit", label: "Audit", hint: "CSMS Compliance Auditor" },
        { value: "proxy", label: "Proxy", hint: "MITM Reverse Proxy" },
        {
          value: "generate",
          label: "Generate",
          hint: "JSON Schema to Typescript",
        },
        { value: "sdk", label: "SDK", hint: "Typescript API SDK Generator" },
        { value: "certs", label: "Certs", hint: "Local TLS CA Manager" },
        { value: "init", label: "Init", hint: "Scaffold new project" },
        { value: "quit", label: pc.red("Quit"), hint: "Exit Dashboard" },
      ],
      maxItems: 12,
    });

    if (isCancel(cmdType) || cmdType === "quit") {
      cancel("Goodbye! ⚡");
      process.exit(0);
    }

    const command = cmdType as string;
    const args: string[] = [command];

    // --- Dynamic Argument Prompting ---

    // 1. Endpoint
    if (
      [
        "virtual-station",
        "simulate",
        "load-test",
        "fuzz",
        "call",
        "replay",
        "audit",
        "proxy",
      ].includes(command)
    ) {
      if (command === "proxy") {
        const ep = await text({ message: "Remote Target CSMS URL:" });
        if (isCancel(ep)) continue;
        if (ep) {
          args.push("--target");
          args.push(ep as string);
        }
      } else if (command === "replay") {
        const ep = await text({
          message: "Target CSMS URL:",
          initialValue: "ws://localhost:3000",
        });
        if (isCancel(ep)) continue;
        if (ep) {
          args.push("--target");
          args.push(ep as string);
        }
      } else {
        const ep = await text({
          message: "Target CSMS Endpoint:",
          initialValue: "ws://localhost:3000",
        });
        if (isCancel(ep)) continue;
        if (ep) {
          args.push("--endpoint");
          args.push(ep as string);
        }
      }
    }

    // 2. Identity
    if (
      ["virtual-station", "simulate", "call", "tail", "certs"].includes(command)
    ) {
      const id = await text({
        message: "Charge Point Identity:",
        initialValue: "CP-001",
      });
      if (isCancel(id)) continue;
      if (id) {
        args.push("--identity");
        args.push(id as string);
      }
    }

    // 2.5 Protocol
    if (["virtual-station", "simulate"].includes(command)) {
      const proto = await select({
        message: "OCPP Protocol version:",
        options: [
          { value: "ocpp1.6", label: "OCPP 1.6-J" },
          { value: "ocpp2.0.1", label: "OCPP 2.0.1" },
          { value: "ocpp2.1", label: "OCPP 2.1" },
        ],
      });
      if (isCancel(proto)) continue;
      if (proto) {
        args.push("--protocol");
        args.push(proto as string);
      }
    }

    // 3. Port / Listen
    if (["mock", "ota", "proxy"].includes(command)) {
      const p = await text({
        message: "Local Port:",
        initialValue: command === "mock" ? "8080" : "4000",
      });
      if (isCancel(p)) continue;
      if (p) {
        args.push(command === "proxy" ? "--listen" : "--port");
        args.push(p as string);
      }
    }

    // 4. Redis URL
    if (["top", "tail"].includes(command)) {
      const ru = await text({
        message: "Redis URL:",
        initialValue: "redis://localhost:6379",
      });
      if (isCancel(ru)) continue;
      if (ru) {
        args.push("--redis");
        args.push(ru as string);
      }
    }

    // 5. Folders (Schemas / Out)
    if (["generate", "sdk"].includes(command)) {
      const s = await text({
        message: "JSON Schemas Folder:",
        initialValue: "./schemas",
      });
      if (isCancel(s)) continue;
      if (s) {
        args.push("--schemas");
        args.push(s as string);
      }

      const o = await text({
        message: "Output Directory/File:",
        initialValue:
          command === "sdk" ? "./src/generated/sdk.ts" : "./src/generated",
      });
      if (isCancel(o)) continue;
      if (o) {
        args.push("--out");
        args.push(o as string);
      }
    }

    // Command specific arguments
    if (command === "tail" || command === "parse") {
      const m = await text({
        message: "OCPP Method Filter (optional, pass to skip):",
      });
      if (isCancel(m)) continue;
      if (m) {
        args.push("--method");
        args.push(m as string);
      }
    }

    outro(pc.green(`Executing: ocpp ${args.join(" ")}`));

    // Spawn native process
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [binaryPath, ...args], {
        stdio: "inherit",
      });

      child.on("close", async () => {
        // Post-execution pause so the user can see errors or output before it clears
        console.log(`\n${pc.gray("─".repeat(40))}`);
        const restart = await confirm({
          message: "Press Enter to return to the dashboard...",
          active: "Return",
          inactive: "Quit",
        });

        if (!restart || isCancel(restart)) {
          process.exit(0);
        }
        resolve();
      });
    });
  }
}
