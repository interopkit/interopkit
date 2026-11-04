import type { CallOptions, Clock } from "@interopkit/core";
import { DataError } from "@interopkit/core";
import { checkAbortSignal, checkNonEmptyString, checkRecord, isRecord } from "@interopkit/core/checks";
import { publicJwk } from "../keys/internal.js";
import type { KeyResolver } from "../model/index.js";
import { checkFlag } from "../option-checks.js";

/** The options of `readCredentialJwt`. */
export interface JwtReadOptions extends CallOptions {
  /** Resolves the key that a `kid` names and reads what the issuer publishes. */
  readonly keys: KeyResolver;
  /**
   * Gives the time that `exp` and `nbf` are compared with.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * The algorithms that a JWS may name in its header. `none` and the HMAC algorithms are never accepted.
   *
   * @defaultValue `["RS256", "RS384", "RS512", "ES256", "ES384", "EdDSA"]`
   */
  readonly algorithms?: readonly string[];
  /**
   * The seconds by which `exp` and `nbf` may differ from the clock.
   *
   * @defaultValue `60`
   */
  readonly clockSkewSeconds?: number;
  /**
   * Accept a key that the issuer does not publish. The binding is then not looked up, and the result has `bound: false`.
   *
   * @defaultValue `false`
   */
  readonly allowUnboundKeys?: boolean;
  /**
   * The most bytes of the compact JWS. A longer one is refused before it is decoded.
   *
   * @defaultValue `1048576`
   */
  readonly maxInputBytes?: number;
  /**
   * The most levels that the header and the payload nest. A deeper one is refused before it is parsed.
   *
   * @defaultValue `64`
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of JSON in the header and in the payload: the memory of a parse grows with the tokens and not with the
   * bytes. A longer one is refused before it is parsed.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
}

/** The options of `signCredentialJwt`. */
export interface JwtSignOptions extends CallOptions {
  /**
   * The address of the key that verifies the JWT, written to the `kid` header. Exactly one of `kid` and `jwk` is given.
   *
   * @defaultValue none
   */
  readonly kid?: string;
  /**
   * The public key that verifies the JWT, written to the `jwk` header. A key that holds a private member is refused.
   *
   * @defaultValue none
   */
  readonly jwk?: JsonWebKey;
  /**
   * Write `typ: "JWT"` to the header.
   *
   * @defaultValue `true`
   */
  readonly typ?: boolean;
  /**
   * For a CLR: sign the credentials nested in it, with the same signer, when they are not compact JWS (CLR 7.2.4.1). Without it,
   * a nested credential that is not a compact JWS is refused.
   *
   * @defaultValue `false`
   */
  readonly signNested?: boolean;
}

/** The options of a signature, checked: the header that names the key, whether to sign nested credentials, and the signal. */
export interface SignSettings {
  readonly header: Readonly<Record<string, unknown>>;
  readonly signNested: boolean;
  readonly signal: AbortSignal | undefined;
}

/** Checks the options of a signature as a host passes them from JavaScript, and builds the header. */
export function signSettings(options: unknown): SignSettings {
  checkRecord(options, "The options of signCredentialJwt must be an object");
  const { kid, jwk, typ = true, signNested = false, signal } = options;
  if ((kid === undefined) === (jwk === undefined)) {
    throw new DataError(
      "The options of signCredentialJwt must give exactly one of kid and jwk, the key that verifies the JWT.",
    );
  }
  if (kid !== undefined) checkNonEmptyString(kid, "The option kid");
  if (jwk !== undefined && !(isRecord(jwk) && publicJwk(jwk) !== undefined)) {
    throw new DataError(
      "The option jwk must be a public RSA, EC or Ed25519 key without private members such as d: a JWT that names a private key would publish it.",
    );
  }
  checkFlag(typ, "The option typ");
  checkFlag(signNested, "The option signNested");
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  return { header: { ...(typ ? { typ: "JWT" } : {}), ...(kid === undefined ? { jwk } : { kid }) }, signNested, signal };
}
