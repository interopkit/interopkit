import { DataError, InteropkitError } from "@interopkit/core";
import { describe, hasMoreTokensThan, isRecord, MAX_JSON_TOKENS } from "@interopkit/core/checks";
import { base64url, errors, type JWTVerifyGetKey, jwtVerify } from "jose";
import { LtiError } from "../errors.js";
import { APPROVED_ALGORITHMS, type Claims, type JwsAlgorithm } from "./claims/index.js";
import { CLOCK_SKEW_SECONDS } from "./clock-skew.js";

// The algorithm the tool and the platform sign with until their keys are signers: a token that either accepts is verified
// against `algorithms`, which never holds `none` or an HMAC algorithm, so that a token cannot choose a weaker check than the
// public key (Security Framework sections 5.1.3, 5.4 and 7.2).
const SIGNING_ALGORITHM = "RS256";

/** The protected header of a token that the tool or the platform signs with an RSA key: RS256 and the `kid` of the key set. */
export function rs256Header(keyId: string): { readonly alg: "RS256"; readonly typ: "JWT"; readonly kid: string } {
  return { alg: SIGNING_ALGORITHM, typ: "JWT", kid: keyId };
}

/** What a verified token must say about itself. */
interface JwtExpectation {
  /** The `iss` claim. */
  readonly issuer: string;
  /** The party the token is for: the `aud` claim must hold it. */
  readonly audience: string;
  /**
   * The parties besides `audience` that the `aud` claim may hold. Any other member is `audience-untrusted`.
   *
   * @defaultValue none
   */
  readonly trustedAudiences?: readonly string[];
  /**
   * The party that the `azp` claim must name when it is present. When set, a token with several audiences must have `azp`.
   *
   * @defaultValue not checked
   */
  readonly authorizedParty?: string;
  /** The `sub` claim, when the token must have one. */
  readonly subject?: string;
  /** The claims that must be present besides `iss`, `aud` and `sub`, such as `exp`. */
  readonly requiredClaims: string[];
  /**
   * The algorithms that the header may name.
   *
   * @defaultValue `APPROVED_ALGORITHMS`
   */
  readonly algorithms?: readonly JwsAlgorithm[];
  /**
   * The most JSON tokens of the payload, which is counted before it is parsed.
   *
   * @defaultValue `MAX_JSON_TOKENS`
   */
  readonly maxTokens?: number;
}

/** Returns whether text is the one canonical base64url of some bytes: decoding and encoding it again gives the same text. */
function isCanonicalBase64Url(part: string): boolean {
  try {
    return base64url.encode(base64url.decode(part)) === part;
  } catch {
    // jose throws a TypeError for a character that is not in the alphabet.
    return false;
  }
}

/**
 * Returns whether a compact JWS has three parts that are each the one canonical base64url of some bytes. jose decodes
 * more loosely, as `atob` does: it takes white space and bits that the encoding ignores, so that one signature has many
 * spellings.
 */
export function hasCanonicalParts(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && parts.every(isCanonicalBase64Url);
}

/**
 * Reads the claims of a token whose signature has not been verified, after it has the shape of a token: three canonical
 * base64url parts and a payload that is a JSON object of at most `maxTokens` JSON tokens. The tool uses them to find the key
 * that verifies the token, and they decide nothing until `verifyJwt` has accepted it.
 *
 * @param token - The compact JWS.
 * @param maxTokens - The most JSON tokens of the payload; the count comes before the parse, so that a payload of a million
 * small members does not cost the memory of its syntax tree.
 * @throws `LtiError` (`token-malformed`) when the token does not have the shape.
 */
export function unverifiedClaims(token: string, maxTokens: number = MAX_JSON_TOKENS): Claims {
  if (!hasCanonicalParts(token)) {
    throw new LtiError(
      "The token must have three parts separated by dots, each in base64url without padding (RFC 7515 sections 2 and 7.1).",
      "token-malformed",
    );
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(base64url.decode(token.split(".")[1] ?? ""));
  } catch {
    throw new LtiError("The payload of the token must be in UTF-8 (RFC 7519 section 7.2).", "token-malformed");
  }
  if (hasMoreTokensThan(text, maxTokens)) {
    throw new LtiError(`The payload of the token has more than ${maxTokens} JSON tokens.`, "token-malformed");
  }
  let claims: unknown;
  try {
    claims = JSON.parse(text);
  } catch {
    throw new LtiError("The payload of the token must be a JSON object (RFC 7519 section 7.2).", "token-malformed");
  }
  if (!isRecord(claims)) {
    throw new LtiError("The payload of the token must be a JSON object (RFC 7519 section 7.2).", "token-malformed");
  }
  return claims;
}

/** Says what is wrong with a claim that jose rejected, as an `LtiError` with the reason of the failed check. */
function claimError(error: errors.JWTClaimValidationFailed | errors.JWTExpired, expected: JwtExpectation): LtiError {
  const { claim, reason, payload } = error;
  if (error instanceof errors.JWTExpired) {
    return new LtiError(
      `The token expired at ${describe(payload.exp)} (Security Framework section 5.1.3).`,
      "token-expired",
    );
  }
  if (claim === "aud") {
    const found = describe(payload.aud);
    return new LtiError(
      `The audience of the token must be ${describe(expected.audience)}, found ${found}.`,
      "audience-mismatch",
    );
  }
  if (reason === "missing" || reason === "invalid") {
    return new LtiError(`The token has no valid ${JSON.stringify(claim)} claim: ${error.message}.`, `claim-${reason}`);
  }
  switch (claim) {
    case "iss":
      return new LtiError(
        `The issuer of the token must be ${describe(expected.issuer)}, found ${describe(payload.iss)}.`,
        "issuer-mismatch",
      );
    case "sub":
      return new LtiError(
        `The subject of the token must be ${describe(expected.subject)}, found ${describe(payload.sub)}.`,
        "subject-mismatch",
      );
    default:
      return new LtiError(`The token is not valid yet: ${error.message}.`, "issued-in-future");
  }
}

/**
 * Turns what jose throws into what the module throws: an `LtiError` with the reason of the failed check, and a `DataError`
 * for a key set that is not one. The errors of the key function that are `InteropkitError`s, such as a failed fetch, pass.
 */
function refuse(error: unknown, expected: JwtExpectation): never {
  if (error instanceof InteropkitError) throw error;
  if (error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired) {
    throw claimError(error, expected);
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    throw new LtiError(
      `The token must be signed with one of ${(expected.algorithms ?? APPROVED_ALGORITHMS).join(", ")} (Security Framework sections 5.1.3 and 7.2).`,
      "algorithm-unsupported",
    );
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    throw new LtiError("The signature of the token is not valid for the key of its issuer.", "signature-invalid");
  }
  // jose throws a TypeError for a key that cannot verify with the algorithm of the header, such as an RSA key of fewer than
  // 2,048 bits (RFC 7518 section 3.3) or an elliptic curve key on another curve than the algorithm names (RFC 7518 section 3.4).
  if (
    error instanceof errors.JWKSNoMatchingKey ||
    error instanceof errors.JWKSMultipleMatchingKeys ||
    error instanceof TypeError
  ) {
    throw new LtiError(`The key set has no usable key for the token: ${error.message}.`, "key-unknown");
  }
  if (
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JOSENotSupported
  ) {
    throw new LtiError(
      `The token is malformed, or it names extensions the tool does not support: ${error.message}.`,
      "token-malformed",
    );
  }
  if (error instanceof errors.JOSEError) {
    throw new DataError(`The key set must be a JWK Set (RFC 7517 section 5): ${error.message}.`);
  }
  throw error;
}

/**
 * Verifies a compact JWS as the JWT of an LTI message or a client assertion: an approved algorithm, a `kid` that the key
 * function resolves, the signature, the parties that `expected` names, the times with the leeway for clock skew, and the
 * audiences (Security Framework sections 5.1.3, 5.2.3 and 4.1.1; RFC 7523 section 3).
 *
 * @param keys - Resolves the public key from the header of the token, such as a key set of `createJwksCache`.
 * @param expected - What the token must say about itself. A present `exp` or `iat` must be a number.
 * @param nowMilliseconds - The time in milliseconds since 1970-01-01T00:00:00Z.
 * @returns The claims.
 * @throws `LtiError` with the reason of the failed check: `token-malformed`, `algorithm-unsupported`, `key-unknown`,
 * `signature-invalid`, `issuer-mismatch`, `audience-mismatch`, `audience-untrusted`, `authorized-party-missing`,
 * `authorized-party-mismatch`, `subject-mismatch`, `token-expired`, `issued-in-future`, `claim-missing` or `claim-invalid`.
 * @throws `ServiceError` when the key set cannot be fetched, and `DataError` when what the platform serves is not a JWK Set.
 */
export async function verifyJwt(
  token: string,
  keys: JWTVerifyGetKey,
  expected: JwtExpectation,
  nowMilliseconds: number,
): Promise<Claims> {
  // A token that is not one is refused before any key is fetched.
  unverifiedClaims(token, expected.maxTokens);
  // Security Framework section 6.3: every key of a key set has a `kid`, and a token names the one it is signed with.
  const keyOf: JWTVerifyGetKey = (header, jws) => {
    if (typeof header.kid !== "string" || header.kid === "") {
      throw new LtiError(
        "The token must name its key with the header kid (Security Framework section 6.3).",
        "key-unknown",
      );
    }
    return keys(header, jws);
  };
  let claims: Claims;
  try {
    ({ payload: claims } = await jwtVerify(token, keyOf, {
      issuer: expected.issuer,
      audience: expected.audience,
      subject: expected.subject,
      requiredClaims: expected.requiredClaims,
      algorithms: [...(expected.algorithms ?? APPROVED_ALGORITHMS)],
      clockTolerance: CLOCK_SKEW_SECONDS,
      currentDate: new Date(nowMilliseconds),
    }));
  } catch (error) {
    return refuse(error, expected);
  }
  checkAudiences(claims, expected);
  checkIssuedAt(claims, nowMilliseconds / 1000);
  return claims;
}

/**
 * Checks the audiences and the authorized party of a token (Security Framework sections 5.1.3 and 5.2.3): the audience that
 * `expected` names is one member, every other member is trusted, and a token with several audiences names its authorized
 * party. jose has checked that `aud` holds the audience.
 */
function checkAudiences(claims: Claims, expected: JwtExpectation): void {
  const { audience, trustedAudiences = [], authorizedParty } = expected;
  const audiences: readonly unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const untrusted = audiences.find((item) => item !== audience && !trustedAudiences.includes(String(item)));
  if (untrusted !== undefined) {
    throw new LtiError(
      `The audience of the token names ${describe(untrusted)}, which is neither ${describe(audience)} nor a trusted audience.`,
      "audience-untrusted",
    );
  }
  if (authorizedParty === undefined) return;
  const { azp } = claims;
  if (azp === undefined) {
    if (new Set(audiences).size > 1) {
      throw new LtiError(
        "A token with several audiences must name its authorized party in azp.",
        "authorized-party-missing",
      );
    }
    return;
  }
  if (typeof azp !== "string") {
    throw new LtiError(`The azp claim of the token must be a string, found ${describe(azp)}.`, "claim-invalid");
  }
  if (azp !== authorizedParty) {
    throw new LtiError(
      `The authorized party of the token must be ${describe(authorizedParty)}, found ${describe(azp)}.`,
      "authorized-party-mismatch",
    );
  }
}

/** Checks that a token is not issued in the future (Security Framework section 5.1.3), allowing the leeway for clock skew. */
function checkIssuedAt(claims: Claims, nowSeconds: number): void {
  const { iat } = claims;
  if (typeof iat === "number" && iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new LtiError(`The token was issued at ${iat}, after the time ${nowSeconds}.`, "issued-in-future");
  }
}
