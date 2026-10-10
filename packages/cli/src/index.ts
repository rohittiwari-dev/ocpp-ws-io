#!/usr/bin/env node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

// The CLI now ships in ocpp-ws-io, as its "ocpp" binary. This package only
// runs that one, so existing scripts and installs keep working.
const require = createRequire(import.meta.url);
const dist = dirname(require.resolve("ocpp-ws-io"));
await import(pathToFileURL(join(dist, "cli.mjs")).href);
