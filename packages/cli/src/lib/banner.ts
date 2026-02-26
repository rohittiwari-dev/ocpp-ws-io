import pc from "picocolors";

const LOGO = `
  ██████   ██████ ██████  ██████       ██   ██ ███████       ██  ██████  
 ██    ██ ██      ██   ██ ██   ██      ██   ██ ██            ██ ██    ██ 
 ██    ██ ██      ██████  ██████  ████ ███ ███ ███████ ████  ██ ██    ██ 
 ██    ██ ██      ██      ██           ███████      ██       ██ ██    ██ 
  ██████   ██████ ██      ██           ██   ██ ███████       ██  ██████  
`;

const TAGLINE = "  The OCPP-WS-IO Developer Toolchain";

export function printBanner(version: string): void {
  const lines = LOGO.split("\n");
  const colors = [pc.cyan, pc.blue, pc.magenta, pc.magenta, pc.blue, pc.cyan];

  for (let i = 0; i < lines.length; i++) {
    const colorFn = colors[i % colors.length];
    process.stdout.write(`${colorFn(lines[i])}\n`);
  }

  console.log(pc.dim(TAGLINE) + pc.dim(`  v${version}`));
  console.log();
}

export function gradientText(text: string): string {
  const chars = text.split("");
  const colors = [pc.cyan, pc.blue, pc.magenta, pc.yellow];
  return chars.map((c, i) => colors[i % colors.length](c)).join("");
}
