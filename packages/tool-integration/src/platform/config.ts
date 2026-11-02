import { DataError } from "@interopkit/core";
import { checkArray, checkHttpsUrl, checkRecord, describe, isRecord, parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import type { KeySet, PlatformInstance } from "../protocol/index.js";
import { checkKeySet, IDENTIFIER } from "../protocol/internal.js";

/** The paths of the routes of `handlePlatformRequest` under the origin of the platform. */
export const PATHS = {
  authorization: "/authorize",
  jwks: "/jwks",
  token: "/token",
  storage: "/storage",
  registration: "/registration",
} as const;

/** The path that the OpenID configuration of a platform has below its issuer (Dynamic Registration 1.0 section 3.4). */
const CONFIGURATION_PATH = "/.well-known/openid-configuration";
const TRAILING_SLASH = /\/$/u;

/** What the platform is: its identity, its origins and its keys. */
export interface PlatformConfig {
  /**
   * The issuer identifier of the platform: the `iss` of its tokens, an `https` URL without query or fragment. It may have a
   * path, such as one for each tenant.
   */
  readonly issuer: string;
  /** The origin that serves `handlePlatformRequest`. It differs from every other origin of the configuration. */
  readonly origin: string;
  /** The origin of the page that frames the tool and the storage page. */
  readonly frameOrigin: string;
  /** Other origins of the host from which a tool must never launch, such as the origin of its assets. An empty list is a choice. */
  readonly reservedOrigins: readonly string[];
  /** The signer of the platform's tokens and the public keys it publishes at `/jwks`, the current one and any kept for a rotation. */
  readonly keys: KeySet;
  /**
   * The HMAC key (SHA-256, at least 256 bits, usages `sign` and `verify`) that seals the hints, the access tokens, the session
   * data of a proctored attempt and the data of a Deep Linking request, each with a `typ` of its own.
   */
  readonly hintKey: CryptoKey;
  /**
   * Earlier hint keys, which still open what they sealed, so that a rotation of `hintKey` breaks no launch, token or Deep
   * Linking request in flight. Nothing is sealed with them.
   *
   * @defaultValue none
   */
  readonly previousHintKeys?: readonly CryptoKey[];
  /**
   * The instance of the platform, which every message carries as its `tool_platform` claim (LTI 1.3 Core section 5.4.3).
   *
   * @defaultValue none, and the messages carry no such claim
   */
  readonly instance?: PlatformInstance;
}

/** The URLs of the platform's endpoints, which the tool's administrator registers with the tool. */
export interface PlatformEndpoints {
  /** The OpenID Connect authentication endpoint, where the tool sends the browser after its login. */
  readonly authorization: string;
  /** The key set of the platform, which verifies its `id_token`s. */
  readonly jwks: string;
  /** The OAuth 2.0 token endpoint, where the tool asks for access tokens; also the audience of its client assertions. */
  readonly token: string;
  /** The storage page that the host shows in a frame beside the frame of the tool. */
  readonly storage: string;
}

/** The smallest HMAC key in bits: the size of the output of SHA-256 (RFC 2104 section 3). */
const MIN_HMAC_KEY_BITS = 256;

/** Returns whether a value is an HMAC key with SHA-256 of at least 256 bits that signs and verifies. */
function isHmacKey(key: unknown): boolean {
  if (!isRecord(key)) return false;
  const { algorithm, usages } = key;
  return (
    isRecord(algorithm) &&
    algorithm.name === "HMAC" &&
    typeof algorithm.length === "number" &&
    algorithm.length >= MIN_HMAC_KEY_BITS &&
    isRecord(algorithm.hash) &&
    algorithm.hash.name === "SHA-256" &&
    Array.isArray(usages) &&
    usages.includes("sign") &&
    usages.includes("verify")
  );
}

/** Checks that a value is the origin of an `https` URL, such as `https://platform.example`. */
function checkOrigin(value: unknown, label: string): asserts value is string {
  checkHttpsUrl(value, label);
  if (new URL(value).origin !== value) {
    throw new DataError(
      `${label} must be an origin without a path, such as "https://platform.example", found ${describe(value)}.`,
    );
  }
}

const TEXT = v.optional(v.string());

/** The platform instance of the configuration, as the `tool_platform` claim carries it. */
const instanceSchema = v.strictObject({
  guid: IDENTIFIER,
  contactEmail: TEXT,
  description: TEXT,
  name: TEXT,
  url: TEXT,
  productFamilyCode: TEXT,
  version: TEXT,
});

/** Checks that a value is an HMAC key that seals and opens tokens. */
function checkHintKey(key: unknown, label: string): void {
  if (!isHmacKey(key)) {
    throw new DataError(
      `${label} must be an HMAC key with SHA-256 of at least ${MIN_HMAC_KEY_BITS} bits for signing and verifying.`,
    );
  }
}

/**
 * Checks a platform configuration, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not one: the issuer is not an `https` URL without query or fragment, an origin is not an
 * `https` origin, two of the origins coincide, the key set is not one (`checkKeySet`), a hint key is not an HMAC key of at
 * least 256 bits, or the instance has no `guid` of 1 to 255 characters.
 */
export function checkPlatformConfig(value: unknown): asserts value is PlatformConfig {
  checkRecord(value, "The platform configuration must be an object");
  checkHttpsUrl(value.issuer, "The issuer of the platform");
  const issuer = new URL(value.issuer);
  if (issuer.search !== "" || issuer.hash !== "") {
    throw new DataError(
      `The issuer of the platform must not have a query or a fragment, found ${describe(value.issuer)}.`,
    );
  }
  checkOrigin(value.origin, "The origin of the platform");
  checkOrigin(value.frameOrigin, "The origin of the frame page");
  checkArray(value.reservedOrigins, "The reserved origins of the platform must be an array");
  for (const reserved of value.reservedOrigins) checkOrigin(reserved, "A reserved origin of the platform");
  const origins = [value.origin, value.frameOrigin, ...value.reservedOrigins];
  if (new Set(origins).size !== origins.length) {
    // The tool's frame has allow-same-origin, so a platform page on the origin of the frame page would share it with that page.
    throw new DataError(
      `The origin of the platform, the origin of the frame page and the reserved origins must all differ, found ${origins.map((origin) => describe(origin)).join(", ")}.`,
    );
  }
  checkKeySet(value.keys);
  checkHintKey(value.hintKey, "The hint key of the platform");
  if (value.previousHintKeys !== undefined) {
    checkArray(value.previousHintKeys, "The previous hint keys of the platform must be an array");
    for (const key of value.previousHintKeys) checkHintKey(key, "A previous hint key of the platform");
  }
  if (value.instance !== undefined) parseWith(instanceSchema, value.instance, "The instance of the platform");
}

/** Returns the URLs of the endpoints of a platform whose configuration has been checked. */
export function endpointsOf(config: PlatformConfig): PlatformEndpoints {
  return {
    authorization: `${config.origin}${PATHS.authorization}`,
    jwks: `${config.origin}${PATHS.jwks}`,
    token: `${config.origin}${PATHS.token}`,
    storage: `${config.origin}${PATHS.storage}`,
  };
}

/**
 * Returns the URLs of the endpoints of a platform: what its administrator registers with a tool. `handlePlatformRequest`
 * serves them.
 *
 * @param config - The platform's configuration.
 * @returns The URLs.
 * @throws `DataError` when the configuration is not one.
 */
export function buildPlatformEndpoints(config: PlatformConfig): PlatformEndpoints {
  checkPlatformConfig(config);
  return endpointsOf(config);
}

/**
 * Returns the URL of the OpenID configuration of a platform: its issuer with `/.well-known/openid-configuration` appended, which
 * a tool accepts only below the issuer (Dynamic Registration 1.0 section 3.4).
 */
export function configurationUrl(config: PlatformConfig): string {
  return `${config.issuer.replace(TRAILING_SLASH, "")}${CONFIGURATION_PATH}`;
}

/** Returns the keys that open a sealed token: the hint key, then the earlier ones of a rotation. */
export function openingKeys(config: PlatformConfig): readonly CryptoKey[] {
  return [config.hintKey, ...(config.previousHintKeys ?? [])];
}
