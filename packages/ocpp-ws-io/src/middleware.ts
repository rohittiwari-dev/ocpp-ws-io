/**
 * Middleware handling for intercepting and modifying OCPP operations.
 *
 * Implements an onion-model middleware stack (similar to Koa/Axios)
 * allowing cross-cutting concerns like logging, authentication, and validation.
 */

export type MiddlewareNext<TReturn = unknown> = () => Promise<TReturn>;

export type MiddlewareFunction<TContext, TReturn = unknown> = (
  context: TContext,
  next: MiddlewareNext<TReturn>,
) => Promise<TReturn> | TReturn;

export class MiddlewareStack<TContext> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _stack: MiddlewareFunction<TContext, any>[] = [];

  /**
   * Add a middleware function to the stack.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  use<TReturn = any>(middleware: MiddlewareFunction<TContext, TReturn>): void {
    this._stack.push(middleware);
  }

  /**
   * Execute the middleware stack composed with a runner function.
   *
   * @param context The context object to pass through middleware
   * @param runner The final function to execute (the "core" logic)
   */
  async execute<TReturn = unknown>(
    context: TContext,
    runner: (context: TContext) => Promise<TReturn> | TReturn,
  ): Promise<TReturn> {
    let index = -1;

    const dispatch = async (i: number): Promise<TReturn> => {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      const fn = this._stack[i];

      if (i === this._stack.length) {
        return runner(context);
      }

      if (!fn) {
        return undefined as unknown as TReturn;
      }

      return fn(context, () => dispatch(i + 1));
    };

    return dispatch(0);
  }
}
