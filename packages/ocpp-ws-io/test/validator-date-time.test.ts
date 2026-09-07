import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { createValidator, isISODateTime } from "../src/validator.js";

/**
 * The date-time format is hand-written for speed, so the thing worth testing
 * is not that it works but that it accepts and rejects exactly what
 * ajv-formats' "full" mode does. Anything else is a silent loosening of
 * validation, and a bad timestamp reaching a transaction record is worse than
 * a slow one being rejected.
 */
const reference = (() => {
  const ajv = new Ajv({ strict: false });
  addFormats(ajv, { mode: "full" });
  return ajv.compile({ type: "string", format: "date-time" });
})();

const CASES = [
  // Well-formed
  "2026-09-07T10:00:00Z",
  "2026-09-07T10:00:00z",
  "2026-09-07t10:00:00Z",
  "2026-09-07T10:00:00.1Z",
  "2026-09-07T10:00:00.123456Z",
  "2026-09-07T10:00:00+00:00",
  "2026-09-07T10:00:00.123+05:30",
  "2026-09-07T10:00:00-12:00",
  // Leap years
  "2024-02-29T10:00:00Z",
  "2000-02-29T10:00:00Z",
  "2026-02-29T10:00:00Z",
  "1900-02-29T10:00:00Z",
  // Day bounds per month
  "2026-01-31T10:00:00Z",
  "2026-04-30T10:00:00Z",
  "2026-04-31T10:00:00Z",
  "2026-02-30T10:00:00Z",
  "2026-09-31T10:00:00Z",
  "2026-09-00T10:00:00Z",
  // Month bounds
  "2026-00-01T10:00:00Z",
  "2026-13-01T10:00:00Z",
  // Time bounds
  "2026-09-07T23:59:59Z",
  "2026-09-07T24:00:00Z",
  "2026-09-07T10:60:00Z",
  "2026-09-07T10:00:61Z",
  // Offset bounds
  "2026-09-07T10:00:00+25:00",
  "2026-09-07T10:00:00+00:60",
  // Malformed
  "not-a-date",
  "2026-09-07 10:00:00",
  "2026-09-07T10:00:00",
  "2026-9-7T10:00:00Z",
  "",
];

describe("date-time format", () => {
  it.each(CASES)("matches ajv-formats 'full' for %j", (value) => {
    expect(isISODateTime(value)).toBe(!!reference(value));
  });

  it("permits a leap second, as RFC 3339 does", () => {
    expect(isISODateTime("2026-09-07T23:59:60Z")).toBe(true);
  });

  it("rejects a timestamp that ajv-formats 'fast' mode would let through", () => {
    // The reason "fast" was not used: these are not edge cases, they are
    // timestamps that cannot exist.
    expect(isISODateTime("2026-13-01T10:00:00Z")).toBe(false);
    expect(isISODateTime("2026-09-07T25:00:00Z")).toBe(false);
  });

  it("is wired into the OCPP validators", () => {
    const v = createValidator("ocpp1.6", []);
    expect(v._ajv.formats["date-time"]).toBe(isISODateTime);
  });

  it("still enforces every other format for custom schemas", () => {
    const v = createValidator("ocpp1.6", []);
    const check = v._ajv.compile({
      type: "object",
      properties: {
        mail: { type: "string", format: "email" },
        addr: { type: "string", format: "ipv4" },
        link: { type: "string", format: "uri" },
      },
    });
    expect(check({ mail: "nope" })).toBe(false);
    expect(check({ addr: "999.1.1.1" })).toBe(false);
    expect(check({ link: "  " })).toBe(false);
    expect(
      check({ mail: "a@b.co", addr: "10.0.0.1", link: "https://x.y" }),
    ).toBe(true);
  });
});
