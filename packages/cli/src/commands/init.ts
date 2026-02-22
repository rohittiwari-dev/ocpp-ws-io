import { promises as fs } from "node:fs";
import { join } from "node:path";
import pc from "picocolors";

export async function initCommand(dir = ".") {
  const targetDir = join(process.cwd(), dir);
  console.log(pc.cyan(`\n⚡ ocpp-ws-cli: Scaffolding\n`));
  console.log(pc.gray(`Target directory: ${targetDir}`));

  try {
    await fs.mkdir(targetDir, { recursive: true });

    const packageJson = {
      name: "ocpp-charging-network",
      version: "1.0.0",
      description: "An OCPP network built with ocpp-ws-io",
      type: "module",
      scripts: {
        dev: "tsx src/index.ts",
        build: "tsc",
        start: "node dist/index.js",
      },
      dependencies: {
        "ocpp-ws-io": "^2.1.1",
      },
      devDependencies: {
        "@types/node": "^20.0.0",
        tsx: "^4.0.0",
        typescript: "^5.0.0",
      },
    };

    const tsConfig = {
      compilerOptions: {
        target: "ESNext",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        esModuleInterop: true,
        strict: true,
        skipLibCheck: true,
        outDir: "dist",
      },
      include: ["src"],
    };

    const indexTs = `import { OCPPServer } from "ocpp-ws-io";

const server = new OCPPServer({});

server.route("BootNotification", (ctx) => {
  return {
    currentTime: new Date().toISOString(),
    interval: 300,
    status: "Accepted",
  };
});

// Start the server
// await server.listen(3000);
console.log("OCPP Server initialized and ready!");
`;

    await fs.writeFile(
      join(targetDir, "package.json"),
      JSON.stringify(packageJson, null, 2),
    );
    await fs.writeFile(
      join(targetDir, "tsconfig.json"),
      JSON.stringify(tsConfig, null, 2),
    );

    await fs.mkdir(join(targetDir, "src"), { recursive: true });
    await fs.writeFile(join(targetDir, "src", "index.ts"), indexTs);

    console.log(pc.green(`✔ Base project files created successfully.`));
    console.log(`\nNext steps:`);
    console.log(pc.magenta(`  cd ${dir === "." ? "" : dir}`));
    console.log(pc.magenta(`  npm install`));
    console.log(pc.magenta(`  npm run dev`));
    console.log();
  } catch (error: any) {
    console.error(pc.red(`\nScaffolding failed: ${error.message}`));
    process.exit(1);
  }
}
