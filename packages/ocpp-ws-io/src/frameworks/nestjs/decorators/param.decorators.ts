import { PARAM_ARGS_METADATA } from "../constants.js";
import { OcppParamType } from "../interfaces.js";

function createOcppParamDecorator(type: OcppParamType) {
  return (): ParameterDecorator => (target, key, index) => {
    const args =
      Reflect.getMetadata(
        PARAM_ARGS_METADATA,
        target.constructor,
        key as string,
      ) || {};
    Reflect.defineMetadata(
      PARAM_ARGS_METADATA,
      { ...args, [index]: type },
      target.constructor,
      key as string,
    );
  };
}

export const Client = createOcppParamDecorator(OcppParamType.CLIENT);
export const Message = createOcppParamDecorator(OcppParamType.MESSAGE);
export const Params = createOcppParamDecorator(OcppParamType.PARAMS);
export const Context = createOcppParamDecorator(OcppParamType.CONTEXT);
export const Identity = createOcppParamDecorator(OcppParamType.IDENTITY);
export const Path = createOcppParamDecorator(OcppParamType.PATH);
export const Session = createOcppParamDecorator(OcppParamType.SESSION);
