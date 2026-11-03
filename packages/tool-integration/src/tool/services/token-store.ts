import { type CallOptions, type Clock, readClock } from "@interopkit/core";
import {
  looseRecord,
  methodsSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
} from "@interopkit/core/checks";
import type { AccessToken } from "@interopkit/core/oauth";
import * as v from "valibot";
import type { LtiDeployment } from "../../protocol/index.js";

/**
 * The host's store of the access tokens of the service clients, which the clients of several processes share, by a key that
 * names the platform, the tool's client, the deployment and the scopes of a token.
 *
 * @remarks
 * A client keeps a token in its own memory too, so it asks the store only when it has no good token of a scope. A store keeps a
 * token until its `expiresAt` and not after, as a time to live does; a client never uses one that the store returns at or past
 * `expiresAt`, less `refreshSkewSeconds`, by its clock, and asks the platform for a new one. Every call receives a `signal` that
 * aborts after the `timeoutMs` of the client, since the work of a token is shared by the callers of a scope.
 */
export interface TokenStore {
  /** Returns the token kept under a key, or `undefined` when there is none. */
  get(key: string, options?: CallOptions): Promise<AccessToken | undefined>;
  /** Keeps a token under a key, in place of any other, until its `expiresAt`, a time in milliseconds since 1970-01-01T00:00:00Z. */
  put(key: string, token: AccessToken, options?: CallOptions): Promise<void>;
  /** Drops the token under a key, which the platform answered 401 to, so that the next call asks for a new one. */
  delete(key: string, options?: CallOptions): Promise<void>;
}

/**
 * Checks a store, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not an object with the functions `get`, `put` and `delete`.
 */
export function checkTokenStore(value: unknown): asserts value is TokenStore {
  parseWith(methodsSchema<TokenStore>("get", "put", "delete"), value, "The option tokens");
}

/** A token as the store returns it: only a token that the client gave it, which has an expiry. */
const keptTokenSchema = looseRecord({
  accessToken: nonEmptyStringSchema,
  expiresAt: nonNegativeIntegerSchema,
  scopes: v.array(v.string()),
  refreshToken: v.optional(v.string()),
});

/**
 * Returns the key of the token of a deployment and its scopes: JSON text of the issuer, the client, the deployment and the scopes
 * in order, which no two of them share.
 */
export function tokenKey(deployment: LtiDeployment, scopes: readonly string[]): string {
  return JSON.stringify([deployment.issuer, deployment.clientId, deployment.deploymentId, [...scopes].sort()]);
}

/**
 * Returns the token that the store keeps under a key when it is good: it has the scope, and its expiry, less the skew, is
 * later than the time.
 *
 * @throws `DataError` when the store returns something that is not a token with an expiry.
 */
export async function keptToken(
  store: TokenStore,
  key: string,
  scope: string,
  timing: { readonly clock: Clock; readonly skewMs: number; readonly timeoutMs: number },
): Promise<AccessToken | undefined> {
  const kept: unknown = await store.get(key, { signal: AbortSignal.timeout(timing.timeoutMs) });
  if (kept === undefined) return undefined;
  const token = parseWith(keptTokenSchema, kept, "The token that the option tokens returned");
  const good = token.expiresAt - timing.skewMs > readClock(timing.clock) && token.scopes.includes(scope);
  return good ? token : undefined;
}
