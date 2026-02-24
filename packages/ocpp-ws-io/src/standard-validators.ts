import ocpp16 from "./schemas/ocpp1_6.json";
import ocpp201 from "./schemas/ocpp2_0_1.json";
import ocpp21 from "./schemas/ocpp2_1.json";
import {
  createValidator,
  type Validator,
  type ValidatorSchema,
} from "./validator.js";

/**
 * E2: Lazily-initialized validators for all supported OCPP protocol versions.
 * Schemas are only loaded and registered when strict mode is first activated,
 * reducing startup time for non-strict servers to near-zero.
 *
 * E5: Uses the global validator registry via createValidator(), so multiple
 * calls to this function return the same cached instances.
 */
let _cached: Validator[] | null = null;

export function getStandardValidators(): Validator[] {
  if (_cached) return _cached;
  _cached = [
    createValidator("ocpp1.6", ocpp16 as ValidatorSchema[]),
    createValidator("ocpp2.0.1", ocpp201 as ValidatorSchema[]),
    createValidator("ocpp2.1", ocpp21 as ValidatorSchema[]),
  ];
  return _cached;
}
