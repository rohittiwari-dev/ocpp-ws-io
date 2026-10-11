import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { startFixture } from "./fixture.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const fixture = await startFixture();
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BOARD_BROWSER_PATH
    ? { executablePath: process.env.BOARD_BROWSER_PATH }
    : {}),
});
const directory = new URL("../.impeccable/review/", import.meta.url);
await mkdir(directory, { recursive: true });
const checks = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${fixture.url}/connections`);
  await page.getByLabel("Username", { exact: true }).fill("preview");
  await page.getByLabel("Password", { exact: true }).fill("preview");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByRole("heading", { name: "All stations", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Inspect Harbor-01", exact: true })
    .waitFor();
  await page.getByText("Live updates connected", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: new URL("desktop.png", directory).pathname.slice(1),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  console.log("check", checks.length + 1);
  checks.push(
    "Authenticated desktop render at 1440px, prefixed assets/API/SSE, no document overflow",
  );
  await page
    .getByRole("button", { name: "Star Harbor-01", exact: true })
    .click();
  await page.getByRole("link", { name: "Starred", exact: true }).click();
  await page.getByRole("heading", { name: "Starred stations" }).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.reload();
  await page
    .getByRole("button", { name: "Unstar Harbor-01", exact: true })
    .waitFor();
  console.log("check", checks.length + 1);
  checks.push("Favorite toggle, favorite view, and persistence across reload");
  await page.goto(`${fixture.url}/connections`);
  await page.getByRole("button", { name: "Next page" }).click();
  assert.equal(await page.locator("tbody tr").count(), 4);
  await page.getByLabel("Search stations or IP address...").fill("Harbor");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page
    .getByLabel("Search stations or IP address...")
    .fill("nothing-matches");
  await page.getByRole("heading", { name: "No stations match" }).waitFor();
  console.log("check", checks.length + 1);
  checks.push("Station search, no-result state, pagination, and page reset");
  await page.goto(`${fixture.url}/commands?identity=Harbor-01`);
  await page.getByRole("heading", { name: "Command center" }).waitFor();
  await page
    .getByText("I reviewed the target and payload.", { exact: false })
    .check();
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await page.locator("pre").filter({ hasText: "Accepted" }).first().waitFor();
  assert.ok(await page.getByText("succeeded", { exact: true }).count());
  await page.screenshot({
    path: new URL("commands.png", directory).pathname.slice(1),
    fullPage: true,
  });
  console.log("check", checks.length + 1);
  checks.push(
    "Real authenticated command from browser to core client; accepted response and audit history",
  );
  await page.getByLabel("Request payload", { exact: true }).fill("{invalid");
  await page
    .getByText("I reviewed the target and payload.", { exact: false })
    .check();
  await page.getByRole("button", { name: "Send command", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "not valid JSON" }).waitFor();
  console.log("check", checks.length + 1);
  checks.push("Malformed command JSON blocked before sending");
  for (const [route, heading] of [
    ["overview", "Network overview"],
    ["messages", "Message traffic"],
    ["telemetry", "Server telemetry"],
    ["security", "Security events"],
    ["diagnostics", "Diagnostics"],
    ["integrations", "Integrations"],
    ["settings", "Workspace"],
  ]) {
    await page.goto(`${fixture.url}/${route}`);
    await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `${route} overflows`,
    );
  }
  console.log("check", checks.length + 1);
  checks.push(
    "All 8 workspace sections render without runtime errors or document overflow",
  );
  await page.goto(`${fixture.url}/messages`);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByText("Paused", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith(".json"));
  console.log("check", checks.length + 1);
  checks.push("Message pause/resume and filtered JSON download");
  await page.goto(`${fixture.url}/connection/view/Harbor-01`);
  await page
    .getByRole("button", { name: "Disconnect station", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Disconnect this station?" })
    .waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await page
      .getByRole("heading", { name: "Disconnect this station?" })
      .count(),
    0,
  );
  console.log("check", checks.length + 1);
  checks.push("Station detail and cancelable destructive-action confirmation");
  await page.goto(`${fixture.url}/connections`);
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.screenshot({
    path: new URL("light.png", directory).pathname.slice(1),
    fullPage: true,
  });
  await page.getByRole("switch", { name: "Dark mode" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: new URL("mobile.png", directory).pathname.slice(1),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Commands", exact: true }).click();
  await page.getByRole("heading", { name: "Command center" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
  );
  await page.screenshot({
    path: new URL("mobile-commands.png", directory).pathname.slice(1),
    fullPage: true,
  });
  console.log("check", checks.length + 1);
  checks.push(
    "Light theme, 390px station and command layouts, mobile navigation",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    new URL("browser-results.json", directory),
    JSON.stringify(
      {
        passed: checks,
        pageErrors: errors,
        fixture:
          "Synthetic station records; real core RPC client and authenticated board HTTP adapter",
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks, pageErrors: errors }, null, 2));
} catch (error) {
  console.error(error);
  throw error;
} finally {
  await browser.close();
  await fixture.close();
}
