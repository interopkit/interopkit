import type { CallOptions } from "@interopkit/core";
import { DataError } from "@interopkit/core";
import {
  describe,
  httpsUrlSchema,
  isRecord,
  looseRecord,
  mapSchema,
  nonEmptyStringSchema,
  parseWith,
} from "@interopkit/core/checks";
import { errors, type JWTVerifyGetKey } from "jose";
import * as v from "valibot";
import { APPROVED_ALGORITHMS, type JwsAlgorithm } from "../protocol/index.js";
import { checkAllowList, IDENTIFIER, isVerifyKey, type JwksCache } from "../protocol/internal.js";

/** The host's record of one tool that the platform launches, as the platform's administrator and the tool agreed on it. */
export interface ToolRegistration {
  /** The OAuth 2.0 client identifier of the tool at this platform. */
  readonly clientId: string;
  /** The deployments of the tool at this platform (LTI 1.3 Core section 3.1.3), each of 1 to 255 characters. */
  readonly deploymentIds: readonly string[];
  /** The tool's login initiation URL (Security Framework section 5.1.1): where the platform sends the browser first. */
  readonly loginUrl: string;
  /** The tool's launch URLs that the platform may post an `id_token` to: the redirect URIs of the tool. */
  readonly redirectUris: readonly string[];
  /** The URL of the tool's key set, which holds the keys that sign its client assertions. Exactly one of this and `keys`. */
  readonly jwksUrl?: string;
  /**
   * The tool's public keys by `kid`, for a tool that gives keys and not a URL: RSA keys of at least 2,048 bits or elliptic curve
   * keys on P-256, P-384 or P-521, at least one. Exactly one of this and `jwksUrl`.
   */
  readonly keys?: ReadonlyMap<string, CryptoKey>;
  /** The scopes of the services that the platform grants the tool; a token request receives those of them that it asks for. */
  readonly scopes: readonly string[];
  /**
   * The algorithms that the platform accepts on the tool's tokens.
   *
   * @defaultValue `APPROVED_ALGORITHMS`
   */
  readonly algorithms?: readonly JwsAlgorithm[];
  /**
   * The custom properties of the tool (Dynamic Registration 1.0 section 2.2.2), which every message carries under its own: a
   * property of the message wins over one of the tool with the same name.
   *
   * @defaultValue none
   */
  readonly custom?: Readonly<Record<string, string>>;
  /**
   * The `allow` attribute of the tool's frame: the features of the browser, such as `microphone`, that the tool may use
   * when it runs in an item.
   *
   * @defaultValue none, so that the tool may use no feature that needs permission
   */
  readonly allow?: string;
}

const keysSchema = v.custom<ReadonlyMap<string, CryptoKey>>(
  (keys) =>
    keys instanceof Map && keys.size > 0 && [...keys].every(([id, key]) => typeof id === "string" && isVerifyKey(key)),
  (issue) =>
    `expected a Map of at least one public RSA key of at least 2048 bits or elliptic curve key on P-256, P-384 or P-521 by kid, found ${issue.received}`,
);

const registrationSchema = v.pipe(
  looseRecord({
    clientId: nonEmptyStringSchema,
    deploymentIds: v.pipe(v.array(IDENTIFIER), v.minLength(1)),
    loginUrl: httpsUrlSchema,
    redirectUris: v.pipe(v.array(httpsUrlSchema), v.minLength(1)),
    jwksUrl: v.optional(httpsUrlSchema),
    keys: v.optional(keysSchema),
    scopes: v.array(nonEmptyStringSchema),
    algorithms: v.optional(v.pipe(v.array(v.picklist(APPROVED_ALGORITHMS)), v.minLength(1))),
    custom: v.optional(mapSchema(v.string())),
    allow: v.optional(v.string()),
  }),
  v.check(
    (registration) => (registration.jwksUrl === undefined) !== (registration.keys === undefined),
    "expected exactly one of the properties jwksUrl and keys",
  ),
);

/**
 * Checks a registration that the host's lookup returned.
 *
 * @throws `DataError` when it is not a registration: a field is missing or of the wrong type, a URL is not `https`, a deployment
 * is not 1 to 255 characters, an algorithm is not approved, a key is not a public key of an approved algorithm, the tool has
 * both or neither of `jwksUrl` and `keys`, or it or its `custom` has a property named `__proto__`, `constructor` or `prototype`.
 */
export function checkToolRegistration(value: unknown): asserts value is ToolRegistration {
  parseWith(registrationSchema, value, "The registration of the tool");
  if (isRecord(value) && value.allow !== undefined) checkAllowList(value.allow, "The allow list of a tool");
}

/**
 * Returns the function that resolves the tool's public key from the header of an assertion: the key set at its `jwksUrl`,
 * or the key of `keys` that has the `kid`.
 */
export function toolKeySet(registration: ToolRegistration, jwks: JwksCache, options?: CallOptions): JWTVerifyGetKey {
  if (registration.jwksUrl !== undefined) return jwks.keySet(registration.jwksUrl, options);
  const keys = registration.keys ?? new Map<string, CryptoKey>();
  return (header) => {
    const key = typeof header.kid === "string" ? keys.get(header.kid) : undefined;
    if (key === undefined) throw new errors.JWKSNoMatchingKey();
    return Promise.resolve(key);
  };
}

/**
 * Finds the registration of a tool with the host's lookup, as it returned it, and checks it.
 *
 * @returns The registration, or `undefined` when the host has none for the client.
 * @throws `DataError` when the lookup returns something that is not a registration, or the registration of another client.
 */
export function readToolRegistration(value: unknown, clientId: string): ToolRegistration | undefined {
  if (value === undefined) return undefined;
  checkToolRegistration(value);
  if (value.clientId !== clientId) {
    throw new DataError(
      `The lookup of the client ${describe(clientId)} returned the registration of ${describe(value.clientId)}.`,
    );
  }
  return value;
}
