/**
 * Middleware handling for intercepting and modifying OCPP operations.
 *
 * Implements an onion-model middleware stack (similar to Koa/Axios)
 * allowing cross-cutting concerns like logging, authentication, and validation.
 */

export type MiddlewareNext = () => Promise<void>;

export type MiddlewareFunction<TContext> = (
  context: TContext,
  next: MiddlewareNext,
) => Promise<void> | void;

export class MiddlewareStack<TContext> {
  private _stack: MiddlewareFunction<TContext>[] = [];

  /**
   * Add a middleware function to the stack.
   */
  use(middleware: MiddlewareFunction<TContext>): void {
    this._stack.push(middleware);
  }

  /**
   * Execute the middleware stack composed with a runner function.
   *
   * @param context The context object to pass through middleware
   * @param runner The final function to execute (the "core" logic)
   */
  async execute(
    context: TContext,
    runner: (context: TContext) => Promise<void> | void,
  ): Promise<void> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;

      const fn = this._stack[i];

      if (i === this._stack.length) {
        return runner(context);
      }

      if (!fn) {
        return;
      }

      await fn(context, () => dispatch(i + 1));
    };

    return dispatch(0);
  }
}
