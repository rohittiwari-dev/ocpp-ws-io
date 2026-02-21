import { describe, expect, it } from "vitest";
import { OCPPClient } from "../src/client.js";

describe("OCPPServerClient - Duplicate Handler Protection", () => {
  it("should throw when registering the same protocol-agnostic handler twice", () => {
    const client = new OCPPClient({
      identity: "test-client",
      endpoint: "ws://localhost",
    });

    client.handle("BootNotification", async () => ({
      currentTime: new Date().toISOString(),
      interval: 300,
      status: "Accepted",
    }));

    expect(() => {
      client.handle("BootNotification", async () => ({
        currentTime: new Date().toISOString(),
        interval: 300,
        status: "Rejected",
      }));
    }).toThrow("Handler for 'BootNotification' is already registered");
  });

  it("should throw when registering the same protocol-aware handler twice", () => {
    const client = new OCPPClient({
      identity: "test-client",
      endpoint: "ws://localhost",
    });

    client.handle("ocpp1.6", "StatusNotification", async () => ({}));

    expect(() => {
      client.handle("ocpp1.6", "StatusNotification", async () => ({}));
    }).toThrow(
      "Handler for 'StatusNotification' (protocol: ocpp1.6) is already registered",
    );
  });

  it("should NOT throw when registering the same method for DIFFERENT protocols", () => {
    const client = new OCPPClient({
      identity: "test-client",
      endpoint: "ws://localhost",
    });

    client.handle("ocpp1.6", "Heartbeat", async () => ({
      currentTime: new Date().toISOString(),
    }));

    expect(() => {
      client.handle("ocpp2.0.1", "Heartbeat", async () => ({
        currentTime: new Date().toISOString(),
      }));
    }).not.toThrow();
  });

  it("should throw when registering a wildcard handler twice", () => {
    const client = new OCPPClient({
      identity: "test-client",
      endpoint: "ws://localhost",
    });

    // First wildcard
    client.handle(async () => null);

    expect(() => {
      // Second wildcard
      client.handle(async () => null);
    }).toThrow("Wildcard handler is already registered");
  });
});
