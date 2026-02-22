import { describe, it, expect } from "vitest";
import { isIPAllowed } from "../src/utils/cidr.js";
import { checkCORS } from "../src/cors.js";
import type { IncomingMessage } from "node:http";
import { TLSSocket } from "node:tls";

describe("CORS Utilities - isIPAllowed", () => {
  it("should match exact IPv4 addresses", () => {
    expect(isIPAllowed("192.168.1.5", ["192.168.1.5"])).toBe(true);
    expect(isIPAllowed("192.168.1.6", ["192.168.1.5"])).toBe(false);
  });

  it("should match exact IPv6 addresses", () => {
    expect(isIPAllowed("2001:db8::1", ["2001:db8::1"])).toBe(true);
    expect(isIPAllowed("2001:db8::2", ["2001:db8::1"])).toBe(false);
  });

  it("should normalize IPv4-mapped IPv6 addresses", () => {
    expect(isIPAllowed("::ffff:192.168.1.5", ["192.168.1.5"])).toBe(true);
    expect(isIPAllowed("::ffff:10.0.0.1", ["10.0.0.1"])).toBe(true);
  });

  it("should match IPv4 CIDR blocks", () => {
    // 10.0.0.0/8
    expect(isIPAllowed("10.0.0.5", ["10.0.0.0/8"])).toBe(true);
    expect(isIPAllowed("10.255.255.255", ["10.0.0.0/8"])).toBe(true);
    expect(isIPAllowed("11.0.0.1", ["10.0.0.0/8"])).toBe(false);

    // 192.168.1.0/24
    expect(isIPAllowed("192.168.1.100", ["192.168.1.0/24"])).toBe(true);
    expect(isIPAllowed("192.168.2.100", ["192.168.1.0/24"])).toBe(false);

    // /0 (all IPv4)
    expect(isIPAllowed("8.8.8.8", ["0.0.0.0/0"])).toBe(true);
  });

  it("should ignore invalid CIDR blocks safely", () => {
    expect(isIPAllowed("10.0.0.5", ["invalid/cidr"])).toBe(false);
    expect(isIPAllowed("10.0.0.5", ["10.0.0.0/"])).toBe(false);
  });
});

describe("CORS Utilities - checkCORS", () => {
  const mockRequest = (overrides: any = {}): IncomingMessage => {
    return {
      socket: {
        remoteAddress: "127.0.0.1",
        ...overrides.socket,
      },
      headers: {
        ...overrides.headers,
      },
    } as unknown as IncomingMessage;
  };

  it("should allow if no options are set", () => {
    const req = mockRequest();
    const result = checkCORS(req, {});
    expect(result.allowed).toBe(true);
  });

  it("should enforce allowedIPs", () => {
    const req = mockRequest({ socket: { remoteAddress: "192.168.1.5" } });

    expect(checkCORS(req, { allowedIPs: ["192.168.1.0/24"] }).allowed).toBe(
      true,
    );
    expect(checkCORS(req, { allowedIPs: ["10.0.0.0/8"] }).allowed).toBe(false);
  });

  it("should enforce allowedSchemes via socket instanceof TLSSocket", () => {
    // mockRequest uses object spread for overrides which destroys prototype chains.
    // We instantiate the mock request normally, then explicitly swap the socket reference.
    const wssReq = mockRequest();
    wssReq.socket = Object.create(TLSSocket.prototype);

    const wsReq = mockRequest();

    expect(checkCORS(wssReq, { allowedSchemes: ["wss"] }).allowed).toBe(true);
    expect(checkCORS(wsReq, { allowedSchemes: ["wss"] }).allowed).toBe(false);

    expect(checkCORS(wsReq, { allowedSchemes: ["ws"] }).allowed).toBe(true);
    expect(checkCORS(wssReq, { allowedSchemes: ["ws"] }).allowed).toBe(false);
  });

  it("should enforce allowedSchemes via X-Forwarded-Proto header", () => {
    const httpsReq = mockRequest({ headers: { "x-forwarded-proto": "https" } });
    const wssFwdReq = mockRequest({ headers: { "x-forwarded-proto": "wss" } });
    const httpReq = mockRequest({ headers: { "x-forwarded-proto": "http" } });

    expect(checkCORS(httpsReq, { allowedSchemes: ["wss"] }).allowed).toBe(true);
    expect(checkCORS(wssFwdReq, { allowedSchemes: ["wss"] }).allowed).toBe(
      true,
    );
    expect(checkCORS(httpReq, { allowedSchemes: ["wss"] }).allowed).toBe(false);
  });

  it("should allow if Origin header is missing (charger safe) but allowedOrigins is set", () => {
    const req = mockRequest({ headers: {} }); // no origin
    expect(
      checkCORS(req, { allowedOrigins: ["https://dashboard.example.com"] })
        .allowed,
    ).toBe(true);
  });

  it("should reject if Origin header is present but not allowed", () => {
    const req = mockRequest({ headers: { origin: "https://evil.com" } });
    const res = checkCORS(req, {
      allowedOrigins: ["https://dashboard.example.com"],
    });

    expect(res.allowed).toBe(false);
    expect(res.reason).toBe("Origin not allowed");
  });

  it("should allow if Origin header is present and matches allowedOrigins", () => {
    const req = mockRequest({
      headers: { origin: "https://dashboard.example.com" },
    });
    expect(
      checkCORS(req, { allowedOrigins: ["https://dashboard.example.com"] })
        .allowed,
    ).toBe(true);
  });
});
