import { expectTypeOf } from "vitest";
import { UseOcppRpcMiddleware } from "../../src/frameworks/nestjs/decorators/class.decorators.js";
import type { OcppModuleAsyncOptions } from "../../src/frameworks/nestjs/interfaces.js";
import type { OcppHonoNodeBinding } from "../../src/frameworks/hono/middleware.js";
import type {
  RedisAdapter,
  RedisAdapterMetrics,
} from "../../src/adapters/redis/index.js";
import { createLoggingMiddleware } from "../../src/helpers/index.js";
import { type MiddlewareFunction, MiddlewareStack } from "../../src/core/middleware.js";
import type {
  CloseOptions,
  LoggerLike,
  MiddlewareContext,
} from "../../src/types/index.js";

/**
 * T5b: published declarations that took `any` take their exact types.
 * Compiled by `typecheck`; never run.
 */
declare const logger: LoggerLike;

export function honoCloseTakesCloseOptions(binding: OcppHonoNodeBinding) {
  expectTypeOf(binding.close).parameter(0).toEqualTypeOf<
    CloseOptions | undefined
  >();
  // @ts-expect-error not a close option
  void binding.close({ timeout: 5 });
}

export function nestAsyncOptions() {
  class ConfigService {
    get(key: string): string {
      return key;
    }
  }
  const options: OcppModuleAsyncOptions = {
    imports: [],
    inject: [ConfigService, { token: "OPTIONAL", optional: true }],
    useFactory: (config: ConfigService) => ({
      protocols: [config.get("protocol")],
    }),
  };
  // @ts-expect-error an injection token is a class, string or symbol
  const wrong: OcppModuleAsyncOptions = { inject: [42] };
  return [options, wrong];
}

export function rpcMiddlewareContext() {
  UseOcppRpcMiddleware(async (ctx, next) => {
    expectTypeOf(ctx).toEqualTypeOf<MiddlewareContext>();
    // @ts-expect-error no such field on any middleware context
    void ctx.bogus;
    return next();
  });
}

export function loggingMiddlewareType() {
  const mw = createLoggingMiddleware(logger, "CP1");
  expectTypeOf(mw).toEqualTypeOf<MiddlewareFunction<MiddlewareContext>>();
  new MiddlewareStack<MiddlewareContext>().use(mw);
}

export async function redisMetricsTyped(adapter: RedisAdapter) {
  // T6a: what RedisAdapter.metrics() reports, field by field.
  const m = await adapter.metrics();
  expectTypeOf(m).toEqualTypeOf<RedisAdapterMetrics>();
  expectTypeOf(m.pollErrors).toEqualTypeOf<number>();
  expectTypeOf(m.lastPollError).toEqualTypeOf<string | undefined>();
}
