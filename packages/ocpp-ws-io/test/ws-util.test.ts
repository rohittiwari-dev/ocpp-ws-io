import { describe, it, expect } from "vitest";
import { parseSubprotocols, isValidStatusCode } from "../src/ws-util.js";

describe("parseSubprotocols", () => {
  it("should parse a single subprotocol", () => {
    const result = parseSubprotocols("ocpp1.6");
    expect(result).toEqual(new Set(["ocpp1.6"]));
  });

  it("should parse multiple subprotocols", () => {
    const result = parseSubprotocols("ocpp1.6, ocpp2.0.1");
    expect(result).toEqual(new Set(["ocpp1.6", "ocpp2.0.1"]));
  });

  it("should parse multiple subprotocols with extra whitespace", () => {
    const result = parseSubprotocols("ocpp1.6 , ocpp2.0.1 ,  ocpp2.1");
    expect(result).toEqual(new Set(["ocpp1.6", "ocpp2.0.1", "ocpp2.1"]));
  });

  it("should parse a single protocol without commas", () => {
    const result = parseSubprotocols("chat");
    expect(result).toEqual(new Set(["chat"]));
  });

  it("should throw on empty string", () => {
    expect(() => parseSubprotocols("")).toThrow(SyntaxError);
  });

  it("should throw on leading comma", () => {
    expect(() => parseSubprotocols(",ocpp1.6")).toThrow(SyntaxError);
  });

  it("should throw on trailing comma", () => {
    expect(() => parseSubprotocols("ocpp1.6,")).toThrow(SyntaxError);
  });

  it("should throw on duplicate protocols", () => {
    expect(() => parseSubprotocols("ocpp1.6, ocpp1.6")).toThrow(SyntaxError);
    expect(() => parseSubprotocols("ocpp1.6, ocpp1.6")).toThrow("duplicated");
  });

  it("should throw on invalid characters", () => {
    expect(() => parseSubprotocols("ocpp[1.6]")).toThrow(SyntaxError);
  });

  it("should handle tab whitespace", () => {
    const result = parseSubprotocols("ocpp1.6\t,\tocpp2.0.1");
    expect(result).toEqual(new Set(["ocpp1.6", "ocpp2.0.1"]));
  });
});

describe("isValidStatusCode", () => {
  it("should accept 1000 (normal close)", () => {
    expect(isValidStatusCode(1000)).toBe(true);
  });

  it("should accept 1001 (going away)", () => {
    expect(isValidStatusCode(1001)).toBe(true);
  });

  it("should accept 1002 (protocol error)", () => {
    expect(isValidStatusCode(1002)).toBe(true);
  });

  it("should accept 1011 (unexpected condition)", () => {
    expect(isValidStatusCode(1011)).toBe(true);
  });

  it("should reject 1004 (reserved)", () => {
    expect(isValidStatusCode(1004)).toBe(false);
  });

  it("should reject 1005 (no status received)", () => {
    expect(isValidStatusCode(1005)).toBe(false);
  });

  it("should reject 1006 (abnormal closure)", () => {
    expect(isValidStatusCode(1006)).toBe(false);
  });

  it("should accept 3000-4999 (application defined)", () => {
    expect(isValidStatusCode(3000)).toBe(true);
    expect(isValidStatusCode(4999)).toBe(true);
    expect(isValidStatusCode(4000)).toBe(true);
  });

  it("should reject codes outside valid ranges", () => {
    expect(isValidStatusCode(999)).toBe(false);
    expect(isValidStatusCode(5000)).toBe(false);
    expect(isValidStatusCode(0)).toBe(false);
    expect(isValidStatusCode(2000)).toBe(false);
  });
});
