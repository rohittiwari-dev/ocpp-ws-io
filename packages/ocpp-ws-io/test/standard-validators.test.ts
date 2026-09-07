import { describe, expect, it } from "vitest";
import {
  getStandardProtocols,
  getStandardValidator,
  getStandardValidators,
} from "../src/standard-validators.js";

describe("standard validators", () => {
  it("returns every bundled protocol when none are named", () => {
    const all = getStandardValidators();
    expect(all.map((v) => v.subprotocol)).toEqual([
      "ocpp1.6",
      "ocpp2.0.1",
      "ocpp2.1",
    ]);
  });

  it("returns only the protocols asked for", () => {
    const one = getStandardValidators(["ocpp1.6"]);
    expect(one).toHaveLength(1);
    expect(one[0]!.subprotocol).toBe("ocpp1.6");
  });

  it("skips protocols with no bundled schemas rather than throwing", () => {
    expect(getStandardValidators(["ocpp1.6", "acme1.0"])).toHaveLength(1);
    expect(getStandardValidator("acme1.0")).toBeNull();
  });

  it("hands back the same instance rather than rebuilding", () => {
    const a = getStandardValidator("ocpp2.1");
    const b = getStandardValidator("ocpp2.1");
    const c = getStandardValidators(["ocpp2.1"])[0];
    expect(a).toBe(b);
    expect(a).toBe(c);
    // ...and the all-protocols call reuses them too.
    expect(getStandardValidators().find((v) => v.subprotocol === "ocpp2.1")).toBe(a);
  });

  it("reports the protocols it can validate", () => {
    expect(getStandardProtocols()).toEqual(["ocpp1.6", "ocpp2.0.1", "ocpp2.1"]);
  });

  it("validates through the protocol it was built for", () => {
    const v = getStandardValidator("ocpp1.6")!;
    expect(() =>
      v.validate("urn:BootNotification.req", {
        chargePointVendor: "Acme",
        chargePointModel: "X1",
      }),
    ).not.toThrow();
    expect(() =>
      v.validate("urn:BootNotification.req", {
        chargePointVendor: 12345,
        chargePointModel: "X1",
      }),
    ).toThrow();
  });
});
