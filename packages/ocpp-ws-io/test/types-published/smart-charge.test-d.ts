import { expectTypeOf } from "vitest";
import {
  type SessionProfile,
  SmartChargingEngine,
  Strategies,
} from "ocpp-ws-io/smart-charge";
import {
  buildOcpp16Profile,
  buildOcpp21Profile,
  type Ocpp21ChargingProfile,
} from "ocpp-ws-io/smart-charge/builders";
import { equalShareStrategy } from "ocpp-ws-io/smart-charge/strategies";

// The smart-charge engine through the package's own exports (Consolidation
// Plan P4): each subpath resolves to its built declarations.
export function smartChargeSubpaths(profile: SessionProfile) {
  const engine = new SmartChargingEngine({
    siteId: "site-1",
    maxGridPowerKw: 100,
    algorithm: Strategies.EQUAL_SHARE,
    dispatcher: async () => {},
  });
  expectTypeOf(engine).toEqualTypeOf<SmartChargingEngine>();
  expectTypeOf(equalShareStrategy).toBeFunction();
  expectTypeOf(buildOcpp16Profile(profile).chargingProfileId).toBeNumber();
  // On 2.1 a period may carry its own dischargeLimit.
  expectTypeOf(
    buildOcpp21Profile(profile, {
      dischargeLimitW: 7400,
      periods: [{ startPeriod: 0, limit: 22000, dischargeLimit: -3000 }],
    }),
  ).toEqualTypeOf<Ocpp21ChargingProfile>();
}
