/** The exact-payload checks: keys a schema does not define are errors. */
import type {
  AllMethodNames,
  OCPPMethodMap,
  OCPPResponseType,
} from "../generated/index.js";
import type { CallOptions } from "./calls.js";
import type { JsonObject } from "./json.js";
import type { NOREPLY, RequestOf, UncheckedAction } from "./protocol.js";

// ─── Exact payloads ──────────────────────────────────────────────
//
// Typed methods reject keys a schema does not define, in params and in a
// handler's returned object, at any depth. The check sits on the action name,
// `method: M & ExactKeys<Shape, T>`, not in the payload's own type: the payload
// stays the plain inferred T, so inferring it and the editor's suggestions
// cost what they cost without a check, and the check runs once, on the
// inferred call. Put inside the payload type instead, it was re-evaluated all
// through inference: 5.2M type instantiations and 27.7s to check this
// package's sources, against 181k and 1.9s this way.

type ExactLeaf = string | number | boolean | bigint | symbol | null | undefined;
/** True for `any`, which the check lets through. */
type IsAny<T> = 0 extends 1 & T ? true : false;
/** The keys a type declares by name, without its index signature. */
type DeclaredKeys<S> = keyof {
  [K in keyof S as string extends K
    ? never
    : number extends K
      ? never
      : K]: true;
};
/**
 * The paths (`"statusInfo.nope"`) of keys in T that one member of Shape does
 * not define. A key an open object (an index signature) covers is allowed and
 * not recursed into: the signature's type, usually the recursive JsonValue,
 * is checked by plain assignability. A key whose value can only be undefined
 * is not on the wire (JSON drops it); TypeScript adds such keys to the
 * objects of a union, such as the calls of a sendBatch.
 */
type ExtraPathsIn<Shape, T, Prefix extends string> =
  true extends IsAny<T>
    ? never
    : unknown extends Shape
      ? never
      : T extends ExactLeaf
        ? never
        : T extends readonly (infer Item)[]
          ? Shape extends readonly (infer ShapeItem)[]
            ? ExtraPaths<ShapeItem, Item, `${Prefix}[]`>
            : never
          : {
              [K in keyof T & string]-?: K extends DeclaredKeys<Shape>
                ? ExtraPaths<Shape[K & keyof Shape], T[K], `${Prefix}${K}.`>
                : string extends keyof Shape
                  ? never
                  : T[K] extends undefined
                    ? never
                    : `${Prefix}${K}`;
            }[keyof T & string];
declare const exactMember: unique symbol;
/** Marks a member of Shape that T fits with no extra key. */
type ExactMemberMark = typeof exactMember;
/**
 * For each member of Shape that one value T fits: its extra paths, or the mark
 * when it has none.
 */
type ExtraPathsPerMember<
  Shape,
  T,
  Prefix extends string,
> = Shape extends unknown
  ? [T] extends [Shape]
    ? [ExtraPathsIn<Shape, T, Prefix>] extends [never]
      ? ExactMemberMark
      : ExtraPathsIn<Shape, T, Prefix>
    : never
  : never;
/**
 * Extra paths of one value T: none when it fits some member of Shape exactly
 * (on a client of several versions, any version), or fits none, which plain
 * assignability reports.
 */
type ExtraPathsOfOne<Shape, T, Prefix extends string> =
  ExactMemberMark extends ExtraPathsPerMember<Shape, T, Prefix>
    ? never
    : Exclude<ExtraPathsPerMember<Shape, T, Prefix>, ExactMemberMark>;
/**
 * Paths of keys in T that Shape does not define. When T is a union, such as a
 * handler that returns one of two objects, every member must fit.
 * Stop at identical nested types before distributing recursive JSON unions.
 */
type ExtraPaths<Shape, T, Prefix extends string = ""> =
  true extends IsIdentical<Shape, T>
    ? never
    : T extends unknown
      ? ExtraPathsOfOne<Shape, T, Prefix>
      : never;
/**
 * `unknown` when T has no key Shape does not define, at any depth; otherwise a
 * type whose one required property lists the extra keys, so the call fails
 * with a message naming them. A key is defined when the generated type
 * declares it, so regenerating the types for new schemas updates the check;
 * an object the schema leaves open (OCPP 2.x's `CustomDataType`) takes any key.
 */
export type ExactKeys<Shape, T> =
  true extends IsIdentical<Shape, T> ? unknown : ExactKeysOf<Shape, T>;
/**
 * True when X and Y are the same type. Assignable both ways is not enough to
 * skip the check: a type with an optional key Shape lacks is assignable both
 * ways, and so is a union whose shorter member TypeScript gave that key as
 * `?: undefined`.
 */
type IsIdentical<X, Y> =
  (<G>() => G extends X ? 1 : 2) extends <G>() => G extends Y ? 1 : 2
    ? true
    : false;
/** {@link ExactKeys} once T is known not to be Shape itself. */
type ExactKeysOf<Shape, T> = [ExtraPaths<Shape, T>] extends [never]
  ? unknown
  : {
      readonly "Error: keys not defined by the OCPP schema": ExtraPaths<
        Shape,
        T
      >;
    };
/** True when T is a union of two or more members. */
type IsUnion<T, U = T> = T extends unknown
  ? [U] extends [T]
    ? false
    : true
  : never;
/**
 * The action name a typed method takes: M, plus the {@link ExactKeys} check of
 * the payload T once M is a single action. M is still a union only when the
 * name given is not an action at all; that call fails anyway, and checking
 * every action's payload would only exceed the compiler's instantiation limit.
 */
export type CheckedAction<M, Shape, T> = M &
  (true extends IsUnion<M> ? unknown : ExactKeys<Shape, T>);
/**
 * The action name a typed handler takes: {@link CheckedAction} for what the
 * handler answers, its return R awaited, without NOREPLY.
 */
export type CheckedHandler<M, Shape, R> = CheckedAction<
  M,
  Shape,
  Exclude<Awaited<R>, typeof NOREPLY>
>;
/**
 * What a typed handler may return: its answer, or NOREPLY, now or as a
 * promise. The runtime awaits the handler, then answers unless it got NOREPLY.
 *
 * The promise also takes any `symbol`: an async function whose only return is
 * NOREPLY is typed `Promise<symbol>`, as TypeScript keeps NOREPLY's own type
 * there only when the expected return type is a single promise. Another symbol
 * would be sent as the answer.
 */
export type HandlerResult<Shape> =
  | Shape
  | typeof NOREPLY
  | Promise<Shape | typeof NOREPLY | symbol>;
/**
 * A typed handler's return type: {@link HandlerResult}, whatever R is. R, the
 * handler's actual return, is still inferred, as inference reaches a
 * conditional type's branches, whole (two objects a handler may return stay
 * one union), and {@link CheckedHandler} checks it. The type the handler is
 * checked and suggested against does not depend on R: with R in it, an editor
 * reads that type twice, with R inferred and with R blocked at the cursor,
 * and TypeScript drops a promise's `then`, `catch` and `finally` from the
 * first reading only, so they were suggested in an answer with every field.
 */
export type HandlerReturn<R, Shape> = [R] extends [unknown]
  ? HandlerResult<Shape>
  : R;
// ─── sendBatch ───────────────────────────────────────────────────

/**
 * One call of `sendBatch`: a typed action with its params, or an action the
 * types do not check (`unchecked()`).
 */
export type BatchCall<V extends keyof OCPPMethodMap> =
  | {
      [M in AllMethodNames<V>]: {
        method: M;
        params: RequestOf<V, M>;
        options?: CallOptions;
      };
    }[AllMethodNames<V>]
  | { method: UncheckedAction; params?: object; options?: CallOptions };
/**
 * The extra keys of one batch call, as `{ action: "Reset"; keys: "bogus" }`.
 * An object, not a template literal: a template over the recursive
 * ExtraPaths makes the compiler check it generically and never finish.
 */
type BatchCallExtraKeys<V extends keyof OCPPMethodMap, C> = C extends {
  method: infer M;
  params: infer T;
}
  ? M extends UncheckedAction
    ? never
    : true extends IsUnion<M>
      ? never
      : [ExtraPaths<RequestOf<V, M>, T>] extends [never]
        ? never
        : {
            readonly action: M;
            readonly keys: ExtraPaths<RequestOf<V, M>, T>;
          }
  : never;
/**
 * `unknown` when no call of a batch has a key the schema does not define;
 * otherwise a type naming them. `sendBatch` puts it on the identity, as typed
 * methods put {@link ExactKeys} on the action name.
 */
export type BatchExactKeys<V extends keyof OCPPMethodMap, C> = [
  BatchCallExtraKeys<V, C>,
] extends [never]
  ? unknown
  : {
      readonly "Error: keys not defined by the OCPP schema": BatchCallExtraKeys<
        V,
        C
      >;
    };
/** The response of one batch call: typed by its action, or a JSON object. */
export type BatchResult<V extends keyof OCPPMethodMap, C> = C extends {
  method: infer M;
}
  ? M extends UncheckedAction
    ? JsonObject
    : M extends AllMethodNames<V>
      ? OCPPResponseType<V, M>
      : never
  : never;
