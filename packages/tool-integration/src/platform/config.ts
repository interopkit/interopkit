import { DataError } from "@interopkit/core";
import { checkArray, checkHttpsUrl, checkRecord, describe, isRecord } from "@interopkit/core/checks";
import { calculateJwkThumbprint } from "jose";
import { isRsaKey } from "../protocol/internal.js";

const AUTHORIZATION_PATH = "/authorize";
const JWKS_PATH = "/jwks";
const TOKEN_PATH = "/token";
const STORAGE_PATH = "/storage";
/** The path under which the platform serves its line items; the segment after it names a line item. */
export const LINE_ITEM_PATH = "/ags/";

/** What the platform is: its identity, its origins and its keys. */
export interface PlatformConfig {
  /** The issuer identifier of the platform: the `iss` of its tokens, an `https` URL without query or fragment. */
  readonly issuer: string;
  /** The origin that serves the platform's handlers. It differs from every other origin of the configuration. */
  readonly origin: string;
  /** The origin of the page that frames the tool and the storage page. */
  readonly frameOrigin: string;
  /** Other origins of the host from which a tool must never launch, such as the origin of its assets. An empty list is a choice. */
  readonly reservedOrigins: readonly string[];
  /** The RSA key pair (RS256) that signs the `id_token`s. The public key must be extractable. */
  readonly keys: CryptoKeyPair;
  /** The HMAC key (SHA-256, usages `sign` and `verify`) that signs hints, line item identifiers and access tokens. */
  readonly hintKey: CryptoKey;
}

/** The URLs of the platform's endpoints, which the tool's administrator registers with the tool. */
export interface PlatformEndpoints {
  /** The OpenID Connect authentication endpoint, served by `ltiPlatformAuthorize`. */
  readonly authorization: string;
  /** The key set, served by `platformJwks`. */
  readonly jwks: string;
  /** The OAuth 2.0 token endpoint, served by `platformToken`; also the audience of the tool's client assertions. */
  readonly token: string;
  /** The storage page that the player shows in a frame beside the frame of the tool, served by `platformStorage`. */
  readonly storage: string;
}

/** Returns whether a value is an HMAC key with SHA-256 that signs and verifies. */
function isHmacKey(key: unknown): boolean {
  if (!isRecord(key)) return false;
  const { algorithm, usages } = key;
  return (
    isRecord(algorithm) &&
    algorithm.name === "HMAC" &&
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

/**
 * Checks a platform configuration, as a host passes it from JavaScript.
 *
 * @throws `DataError` when it is not one: the issuer is not an `https` URL without query or fragment, an origin is not an
 * `https` origin, two of the three origins coincide, a key is not what its property says, or the public key cannot be
 * exported.
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
  checkRecord(value.keys, "The keys of the platform must be an object");
  if (!isRsaKey(value.keys.privateKey, "sign")) {
    throw new DataError("The private key of the platform must be an RSASSA-PKCS1-v1_5 key with SHA-256 for signing.");
  }
  const publicKey = value.keys.publicKey;
  if (!isRsaKey(publicKey, "verify") || !isRecord(publicKey) || publicKey.extractable !== true) {
    throw new DataError(
      "The public key of the platform must be an extractable RSASSA-PKCS1-v1_5 key with SHA-256 for verifying.",
    );
  }
  if (!isHmacKey(value.hintKey)) {
    throw new DataError("The hint key of the platform must be an HMAC key with SHA-256 for signing and verifying.");
  }
}

/** Returns the URLs of the endpoints of a platform whose configuration has been checked. */
export function endpointsOf(config: PlatformConfig): PlatformEndpoints {
  return {
    authorization: `${config.origin}${AUTHORIZATION_PATH}`,
    jwks: `${config.origin}${JWKS_PATH}`,
    token: `${config.origin}${TOKEN_PATH}`,
    storage: `${config.origin}${STORAGE_PATH}`,
  };
}

/**
 * Returns the URLs of the endpoints of a platform: what its administrator registers with a tool.
 *
 * @param config - The platform's configuration.
 * @returns The URLs.
 * @throws `DataError` when the configuration is not one.
 */
export function platformEndpoints(config: PlatformConfig): PlatformEndpoints {
  checkPlatformConfig(config);
  return endpointsOf(config);
}

const keyIds = new WeakMap<CryptoKey, Promise<string>>();

/**
 * Returns the `kid` of the platform's signing key: its JWK thumbprint (RFC 7638), so that a new key has a new `kid` and no
 * host needs to name it. Security Framework section 6.3 requires a `kid` for every key of a key set.
 */
export function platformKeyId(config: PlatformConfig): Promise<string> {
  const { publicKey } = config.keys;
  const known = keyIds.get(publicKey);
  if (known !== undefined) return known;
  const computed = calculateJwkThumbprint(publicKey);
  keyIds.set(publicKey, computed);
  return computed;
}
