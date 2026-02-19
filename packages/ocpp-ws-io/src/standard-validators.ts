import ocpp16 from "./schemas/ocpp1_6.json";
import ocpp201 from "./schemas/ocpp2_0_1.json";
import ocpp21 from "./schemas/ocpp2_1.json";
import {
  createValidator,
  type Validator,
  type ValidatorSchema,
} from "./validator.js";

/**
 * Pre-built validators for all supported OCPP protocol versions.
 * These are automatically registered when strict mode is enabled.
 */
export const standardValidators: Validator[] = [
  createValidator("ocpp1.6", ocpp16 as ValidatorSchema[]),
  createValidator("ocpp2.0.1", ocpp201 as ValidatorSchema[]),
  createValidator("ocpp2.1", ocpp21 as ValidatorSchema[]),
];
