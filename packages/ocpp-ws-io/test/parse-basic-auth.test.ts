import { describe, it, expect } from "vitest";
import { parseBasicAuth } from "../src/ws-util";

describe("parseBasicAuth", () => {
  const encode = (s: string) => "Basic " + Buffer.from(s).toString("base64");

  it("should parse standard username:password", () => {
    const result = parseBasicAuth(encode("station01:secret"), "station01");
    expect(result).toBeDefined();
    expect(result?.toString()).toBe("secret");
  });

  it("should support colons in the identity (OCPP convention)", () => {
    const result = parseBasicAuth(
      encode("station:01:secret:password"),
      "station:01",
    );
    expect(result).toBeDefined();
    expect(result?.toString()).toBe("secret:password");
  });

  it("should support binary passwords", () => {
    const binaryPassword = Buffer.from([0x00, 0xff, 0x80, 0x01]);
    const raw = Buffer.concat([Buffer.from("station01:"), binaryPassword]);
    const header = "Basic " + raw.toString("base64");
    const result = parseBasicAuth(header, "station01");
    expect(result).toBeDefined();
    expect(result?.equals(binaryPassword)).toBe(true);
  });

  it("should return undefined for empty auth header", () => {
    expect(parseBasicAuth("", "station01")).toBeUndefined();
  });

  it("should return undefined for non-Basic auth", () => {
    expect(parseBasicAuth("Bearer token123", "station01")).toBeUndefined();
  });

  it("should return undefined for mismatched identity", () => {
    const result = parseBasicAuth(encode("other:password"), "station01");
    expect(result).toBeUndefined();
  });

  it("should return undefined for malformed base64", () => {
    const result = parseBasicAuth("Basic !!!invalid!!!", "station01");
    expect(result).toBeUndefined();
  });

  it("should handle identity with special characters", () => {
    const id = "CP/Test#001";
    const result = parseBasicAuth(encode(`${id}:pass`), id);
    expect(result).toBeDefined();
    expect(result?.toString()).toBe("pass");
  });

  it("should handle empty password", () => {
    // "station01:" → password is empty buffer
    const result = parseBasicAuth(encode("station01:"), "station01");
    // With identity-prefix, decoded.length must be > prefix.length, so empty password won't match prefix path
    // But fallback with colonIdx will find colonIdx at the right place
    // decoded = "station01:", colon at index 9
    // user = "station01" matches identity, password = "" (empty buffer)
    expect(result).toBeDefined();
    expect(result?.length).toBe(0);
  });
});
