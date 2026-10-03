import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Editor suggestions in handler returns and call params, asked of the
 * TypeScript language service, the engine editors such as VS Code run. The
 * source below is never compiled on its own: an incomplete `{ }` is exactly
 * where a user asks for suggestions.
 *
 * Two things must hold for them to appear: no untyped fallback overload that
 * the incomplete object matches (its expected type is `any`), and the
 * method-only overloads declared before the version-named ones (with every
 * overload failing, the editor uses the first that takes enough arguments).
 */
const source = `
import { BrowserOCPPClient } from "../src/browser/client.js";
import { OCPPClient } from "../src/client.js";
import { OCPPServer } from "../src/server.js";

const v16 = new OCPPServer({ protocols: ["ocpp1.6"] });
const mixed = new OCPPServer({ protocols: ["ocpp1.6", "ocpp2.0.1"] });

v16.on("client", (client) => {
  client.forProtocol("ocpp1.6")?.handle("BootNotification", () => {
    return { /*forProtocol-handle*/ };
  });
  client.handle("BootNotification", () => ({ /*handle*/ }));
  client.handle("BootNotification", () => ({ currentTime: "", /*handle-partial*/ }));
  client.handle("ocpp1.6", "BootNotification", () => ({ /*version-handle*/ }));
});

mixed.on("client", (client) => {
  client.handle("BootNotification", () => ({ /*mixed-handle*/ }));
});

v16.route("/ocpp/:identity").on("client", (client) => {
  client.handle("Heartbeat", () => ({ /*route-connection-handle*/ }));
});

const charger = new OCPPClient({ identity: "CP1", endpoint: "ws://x", protocols: ["ocpp1.6"] });
void charger.call("BootNotification", { /*call-params*/ });
void charger.call("ocpp1.6", "BootNotification", { /*version-call-params*/ });

v16.route("/r/:id").handle("Heartbeat", () => ({ /*router-handle*/ }));
void v16.sendToClient("CP1", "ChangeAvailability", { /*send-to-client-params*/ });
void v16.sendToClient("CP1", "ocpp1.6", "ChangeAvailability", { /*version-send-to-client-params*/ });
void v16.broadcast("ChangeAvailability", { /*broadcast-params*/ });

v16.on("client", (client) => {
  client.handle("Heartbeat", async () => ({ /*async-handle*/ }));
  client.handle("ocpp1.6", "Heartbeat", ({ unconfirmed }) => {
    void unconfirmed;
    return { /*block-handle*/ };
  });
});

const browser = new BrowserOCPPClient({ identity: "CP1", endpoint: "ws://x", protocols: ["ocpp1.6"] });
void browser.call("BootNotification", { /*browser-call-params*/ });
browser.handle("Heartbeat", () => ({ /*browser-handle*/ }));

v16.on("client", (client) => {
  client.handle("Heartbeat", () => ({ currentTime: "", /*full-handle*/ }));
  client.handle("Heartbeat", async () => ({ currentTime: "", /*full-async-handle*/ }));
  client.handle("ocpp1.6", "Heartbeat", ({ unconfirmed }) => {
    void unconfirmed;
    return { currentTime: "", /*full-block-handle*/ };
  });
  client.forProtocol("ocpp1.6")?.handle("Heartbeat", async () => ({ currentTime: "", /*full-forProtocol-handle*/ }));
});
charger.handle("Reset", () => ({ status: "Accepted", /*full-client-handle*/ }));
charger.handle("Reset", async () => ({ status: "Accepted", /*full-async-client-handle*/ }));
v16.route("/f/:id").handle("Heartbeat", () => ({ currentTime: "", /*full-router-handle*/ }));
v16.route("/fa/:id").handle("Heartbeat", async () => ({ currentTime: "", /*full-async-router-handle*/ }));
browser.handle("Heartbeat", () => ({ currentTime: "", /*full-browser-handle*/ }));
browser.handle("Heartbeat", async () => ({ currentTime: "", /*full-async-browser-handle*/ }));
`;

const pkg = join(__dirname, "..");
const file = join(pkg, "test", "__suggestions__.ts").replace(/\\/g, "/");
let service: ts.LanguageService;

/** Property names the editor suggests at a marker. */
function suggestionsAt(marker: string): string[] {
  const pos = source.indexOf(`/*${marker}*/`);
  if (pos < 0) throw new Error(`no marker ${marker}`);
  const list = service.getCompletionsAtPosition(file, pos, {});
  return (list?.entries ?? [])
    .filter((e) => e.kind === ts.ScriptElementKind.memberVariableElement)
    .map((e) => e.name)
    .sort();
}

describe("editor suggestions", () => {
  beforeAll(() => {
    const config = ts.getParsedCommandLineOfConfigFile(
      join(pkg, "tsconfig.test.json"),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: (d) => {
          throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
        },
      },
    );
    if (!config) throw new Error("tsconfig.test.json did not parse");
    const host: ts.LanguageServiceHost = {
      getScriptFileNames: () => [file],
      getScriptVersion: () => "1",
      getScriptSnapshot: (name) => {
        if (name.replace(/\\/g, "/") === file) {
          return ts.ScriptSnapshot.fromString(source);
        }
        return ts.sys.fileExists(name)
          ? ts.ScriptSnapshot.fromString(readFileSync(name, "utf8"))
          : undefined;
      },
      getCurrentDirectory: () => pkg,
      getCompilationSettings: () => config.options,
      getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
      fileExists: (name) =>
        name.replace(/\\/g, "/") === file || ts.sys.fileExists(name),
      readFile: (name) =>
        name.replace(/\\/g, "/") === file ? source : ts.sys.readFile(name),
      readDirectory: ts.sys.readDirectory,
      directoryExists: ts.sys.directoryExists,
      getDirectories: ts.sys.getDirectories,
    };
    service = ts.createLanguageService(host, ts.createDocumentRegistry());
  }, 120_000);

  const boot16 = ["currentTime", "interval", "status"];

  it.each([
    ["forProtocol-handle", boot16],
    ["handle", boot16],
    ["handle-partial", ["interval", "status"]],
    ["version-handle", boot16],
    ["route-connection-handle", ["currentTime"]],
    ["browser-handle", ["currentTime"]],
    ["router-handle", ["currentTime"]],
  ])("suggests the response fields in %s", (marker, expected) => {
    expect(suggestionsAt(marker)).toEqual(expected);
  });

  // A handler may return a promise, but its answer is never one: the
  // promise's own members must not be suggested as response fields, in an
  // empty object or in one that has every field.
  it.each([
    ["handle"],
    ["async-handle"],
    ["block-handle"],
    ["version-handle"],
    ["router-handle"],
    ["browser-handle"],
    ["forProtocol-handle"],
    ["full-handle"],
    ["full-async-handle"],
    ["full-block-handle"],
    ["full-forProtocol-handle"],
    ["full-client-handle"],
    ["full-async-client-handle"],
    ["full-router-handle"],
    ["full-async-router-handle"],
    ["full-browser-handle"],
    ["full-async-browser-handle"],
  ])("does not suggest then, catch or finally in %s", (marker) => {
    const pos = source.indexOf(`/*${marker}*/`);
    const all = (service.getCompletionsAtPosition(file, pos, {})?.entries ?? []).map((e) => e.name);
    expect(all).not.toEqual(expect.arrayContaining(["then"]));
    expect(all).not.toEqual(expect.arrayContaining(["catch"]));
    expect(all).not.toEqual(expect.arrayContaining(["finally"]));
  });

  it("suggests the fields of every configured version on a mixed server", () => {
    expect(suggestionsAt("mixed-handle")).toEqual([
      "currentTime",
      "customData",
      "interval",
      "status",
      "statusInfo",
    ]);
  });

  it.each([
    ["send-to-client-params"],
    ["version-send-to-client-params"],
    ["broadcast-params"],
  ])("suggests the request fields in %s", (marker) => {
    expect(suggestionsAt(marker)).toEqual(["connectorId", "type"]);
  });

  it.each([
    ["call-params"],
    ["version-call-params"],
    ["browser-call-params"],
  ])("suggests the request fields in %s", (marker) => {
    expect(suggestionsAt(marker)).toEqual(
      expect.arrayContaining(["chargePointModel", "chargePointVendor"]),
    );
  });
});
