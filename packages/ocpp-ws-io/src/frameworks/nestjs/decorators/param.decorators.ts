import { PARAM_ARGS_METADATA } from "../constants.js";
import { type OcppParamMetadata, OcppParamType } from "../interfaces.js";

function createOcppParamDecorator(type: OcppParamType, data?: string) {
  return (): ParameterDecorator => (target, key, index) => {
    const args =
      Reflect.getMetadata(
        PARAM_ARGS_METADATA,
        target.constructor,
        key as string,
      ) || {};
    const metadata: OcppParamMetadata = { type, data };
    Reflect.defineMetadata(
      PARAM_ARGS_METADATA,
      { ...args, [index]: metadata },
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
export const PathParam = (name?: string): ParameterDecorator =>
  createOcppParamDecorator(OcppParamType.PATH_PARAMS, name)();
export const Protocol = createOcppParamDecorator(OcppParamType.PROTOCOL);
export const MessageId = createOcppParamDecorator(OcppParamType.MESSAGE_ID);
export const Handshake = createOcppParamDecorator(OcppParamType.HANDSHAKE);
