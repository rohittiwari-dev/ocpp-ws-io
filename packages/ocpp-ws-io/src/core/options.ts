/** `T` as {@link withoutUndefined} returns it: no member holds undefined. */
export type WithoutUndefined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/**
 * The options without the ones given as `undefined`, so `undefined` means not
 * set: spread over the defaults it keeps the default, and applied by
 * reconfigure() it leaves the current value. Spreading the options as given
 * let `{ callTimeoutMs: undefined }` replace the default with undefined.
 */
export function withoutUndefined<T extends object>(
  options: T,
): WithoutUndefined<T> {
  const given = { ...options };
  for (const key of Object.keys(given) as Array<keyof T>) {
    if (given[key] === undefined) Reflect.deleteProperty(given, key);
  }
  return given as WithoutUndefined<T>;
}
