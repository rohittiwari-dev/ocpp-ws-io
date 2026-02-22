import pc from "picocolors";

export function createStubCommand(name: string, description: string) {
  return (_options: any) => {
    console.log(pc.cyan(`\n⚡ ocpp-ws-io: ${name}\n`));
    console.log(
      pc.yellow(`(Feature '${name}' is currently under development!)`),
    );
    console.log(pc.gray(`Description: ${description}\n`));
  };
}

export const loadTestCommand = createStubCommand(
  "load-test",
  "Distributed Load Testing Engine",
);
export const topCommand = createStubCommand(
  "top",
  "Live Cluster Dashboard (Redis TUI)",
);
export const tailCommand = createStubCommand(
  "tail",
  "WebSocket Network Sniffer / Stream Tailing",
);
export const certsCommand = createStubCommand(
  "certs",
  "Local TLS Certificate Authority Manager",
);
export const mockCommand = createStubCommand(
  "mock",
  "Mock API Server Generator for Frontend Teams",
);
export const parseCommand = createStubCommand(
  "parse",
  "Payload Translator and Validater",
);
export const otaCommand = createStubCommand(
  "ota",
  "Local Firmware Hosting Server (chunked/bytes)",
);
export const fuzzCommand = createStubCommand(
  "fuzz",
  "Protocol Fuzzing & Security Tester",
);
export const replayCommand = createStubCommand(
  "replay",
  "Network Frame Replay Engine",
);
