import { blogSource } from "@/lib/blog";
import { source } from "@/lib/source";

export const dynamic = "force-static";
const BASE_URL = "https://ocpp-ws-io.rohittiwari.me";

export function GET() {
  const lines = [
    "# ocpp-ws-io: OCPP for Node.js and TypeScript",
    "",
    "> TypeScript WebSocket RPC client and server library for OCPP 1.6J, 2.0.1 and 2.1. Provides building blocks for charging station clients and Charging Station Management Systems (CSMS).",
    "",
    "## Capabilities and scope",
    "",
    "- Protocol-aware request, response and handler types generated from OCPP JSON schemas. Enable strictMode for runtime schema validation; compile-time types do not replace it.",
    "- Framework integrations for NestJS, Express, Fastify and Hono; a browser client and Redis clustering adapter.",
    "- Related packages provide smart charging allocation, protocol translation, CLI simulation and monitoring. Consult each package's documentation for supported behavior and configuration.",
    "- Applications supply business workflows, persistence, authorization and billing. Schema validation is not OCA product certification.",
    "",
    "## Start here",
    "",
    `- [Quick start](${BASE_URL}/docs/ocpp-ws-io/quick-start): Install the library and connect a client to a server.`,
    `- [TypeScript guide](${BASE_URL}/docs/ocpp-ws-io/type-safety): Protocol inference, typed calls and handlers, vendor actions and escape hatches.`,
    `- [NestJS integration](${BASE_URL}/docs/ocpp-ws-io/frameworks/nestjs): Gateway decorators and dependency injection.`,
    `- [CSMS tutorial](${BASE_URL}/blog/building-csms-with-ocpp-ws-io): Application integration walkthrough.`,
    "- [Source and issues](https://github.com/rohittiwari-dev/ocpp-ws-io): Implementation, tests and releases.",
    "- [npm package](https://www.npmjs.com/package/ocpp-ws-io): Published versions and installation metadata.",
    "",
    "## Documentation",
    "",
  ];

  for (const page of source.getPages()) {
    lines.push(
      `- [${page.data.title}](${BASE_URL}${page.url}): ${page.data.description || page.data.title} ([Markdown](${BASE_URL}/llms.mdx${page.url}))`,
    );
  }

  lines.push("", "## Tutorials and articles", "");
  for (const page of blogSource.getPages()) {
    lines.push(
      `- [${page.title}](${BASE_URL}${page.url}): ${page.description} ([Markdown](${BASE_URL}/llms.mdx${page.url}))`,
    );
  }
  lines.push(
    "",
    "## Optional",
    "",
    `- [Full documentation text](${BASE_URL}/llms-full.txt): Documentation and blog content in one response.`,
  );

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
