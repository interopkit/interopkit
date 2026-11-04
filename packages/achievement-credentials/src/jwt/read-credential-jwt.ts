import { DataError, raceAbort, readClock } from "@interopkit/core";
import { describe, isRecord, parseJsonText } from "@interopkit/core/checks";
import { compactVerify, importJWK } from "jose";
import { decodeBase64url } from "../base64url.js";
import { type JsonLimits, jsonRefusals } from "../json-text.js";
import { bindKey, publicJwk, thumbprintOf, thumbprintUri } from "../keys/internal.js";
import type { AnyVerifiableCredential, ProofResult, VerificationKey } from "../model/index.js";
import { carriedCredential, readCarried } from "./carried-credential.js";
import { dateTimeOf, disagreement, valuesOf } from "./claims.js";
import { type JwtReadOptions, type ReadSettings, readSettings } from "./options.js";

/** The most characters of the protected header: it names an algorithm and a key, and a key of 8,192 bits is under 1,500 characters. */
export const MAX_HEADER_CHARS = 16_384;

const MILLISECONDS_PER_SECOND = 1000;

/** The values of the `typ` header that a credential in a JWS may have, in lower case (RFC 7515 section 4.1.9, VC-JOSE-COSE). */
const TYPES: readonly string[] = ["jwt", "vc+jwt"];

/** What one step of reading ends with: its value, or the reason that the JWS is not valid. */
type Step<TValue> = { readonly value: TValue } | { readonly reason: string };

/** Reads the bytes of a part of the JWS as a JSON object: UTF-8, within the depth limit, and an object. */
function readObject(bytes: Uint8Array, name: string, limits: JsonLimits): Step<Readonly<Record<string, unknown>>> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { reason: `The ${name} of the JWS is not UTF-8.` };
  }
  // The levels and the tokens are counted before the parser builds anything.
  let value: unknown;
  try {
    value = parseJsonText(text, limits, jsonRefusals(`The ${name} of the JWS`, limits));
  } catch (error) {
    return { reason: error instanceof DataError ? error.message : `The ${name} of the JWS is not JSON.` };
  }
  return isRecord(value) ? { value } : { reason: `The ${name} of the JWS is not a JSON object.` };
}

/** Finds the key that verifies the JWS, from its header: the resolved `kid`, or the embedded `jwk`. */
async function keyOf(
  header: Readonly<Record<string, unknown>>,
  settings: ReadSettings,
): Promise<Step<VerificationKey>> {
  const { kid, jwk } = header;
  if ((kid === undefined) === (jwk === undefined)) {
    return { reason: "The header must name the key by exactly one of kid and jwk (Open Badges 8.2.3)." };
  }
  if (kid !== undefined) {
    if (typeof kid !== "string" || kid === "") return { reason: "The kid of the header must be a non-empty string." };
    // A resolver is the host's port and may ignore the signal it is given: the wait ends at the signal either way.
    const call = settings.signal === undefined ? undefined : { signal: settings.signal };
    const key = await raceAbort(settings.keys.resolve(kid, call), { signal: settings.signal });
    if (key === undefined) return { reason: `No key is named by the kid ${kid}.` };
    const resolved = publicJwk(key.publicKeyJwk);
    return resolved === undefined
      ? { reason: `The key ${kid} is not a public key that can verify a credential.` }
      : { value: { ...key, publicKeyJwk: resolved } };
  }
  const embedded = publicJwk(jwk);
  if (embedded === undefined) return { reason: "The jwk of the header must be a public RSA, EC or Ed25519 key." };
  return { value: { id: thumbprintUri(await thumbprintOf(embedded)), publicKeyJwk: embedded, relationships: [] } };
}

/** Checks the time claims against the clock: a NumericDate, not expired and not yet valid, within the skew. */
function timeProblem(payload: Readonly<Record<string, unknown>>, settings: ReadSettings): string | undefined {
  for (const claim of ["exp", "nbf", "iat"]) {
    const value = payload[claim];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      return `The claim ${claim} must be a number of seconds, found ${describe(value)}.`;
    }
  }
  const now = readClock(settings.clock) / MILLISECONDS_PER_SECOND;
  const { exp, nbf } = payload;
  if (typeof exp === "number" && exp + settings.clockSkewSeconds <= now)
    return `The JWT expired at ${dateTimeOf(exp)}.`;
  if (typeof nbf === "number" && nbf - settings.clockSkewSeconds > now)
    return `The JWT is not valid before ${dateTimeOf(nbf)}.`;
  return undefined;
}

/** The parts of a JWS that passed the checks of its shape: the header, and the payload as bytes. */
interface Shape {
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: Uint8Array;
}

/** Checks the size and shape of a compact JWS, before anything is decoded, and decodes its header. */
function shapeOf(jws: string, settings: ReadSettings): Step<Shape> {
  if (jws.length > settings.maxInputBytes) {
    return {
      reason: `The JWS has ${jws.length} characters, more than the ${settings.maxInputBytes} that it may have.`,
    };
  }
  const parts = jws.split(".");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (parts.length !== 3 || !encodedHeader || !encodedPayload || !encodedSignature) {
    return { reason: "A compact JWS has three parts, none empty, separated by dots (RFC 7515 section 7.1)." };
  }
  if (encodedHeader.length > MAX_HEADER_CHARS) {
    return { reason: `The header of the JWS has more than ${MAX_HEADER_CHARS} characters.` };
  }
  const headerBytes = decodeBase64url(encodedHeader);
  const payload = decodeBase64url(encodedPayload);
  if (headerBytes === undefined || payload === undefined || decodeBase64url(encodedSignature) === undefined) {
    return { reason: "The parts of the JWS must be canonical base64url without padding (RFC 7515 section 2)." };
  }
  const header = readObject(headerBytes, "header", settings);
  return "reason" in header ? header : { value: { header: header.value, payload } };
}

/** Finds what is wrong with the algorithm and the other parameters of the header, or `undefined` when nothing is. */
function headerProblem(header: Readonly<Record<string, unknown>>, settings: ReadSettings): string | undefined {
  const { alg, typ, crit } = header;
  if (typeof alg !== "string" || !settings.algorithms.includes(alg)) {
    return `The algorithm ${describe(alg)} is not one of ${settings.algorithms.join(", ")}.`;
  }
  if (crit !== undefined) return "The header has crit, and no extension of it is understood.";
  if (typ !== undefined && !(typeof typ === "string" && TYPES.includes(typ.toLowerCase()))) {
    return `The typ ${describe(typ)} must be JWT or vc+jwt.`;
  }
  return undefined;
}

/** Finds the key that the header names and verifies the signature with it. */
async function verifiedKey(
  jws: string,
  header: Readonly<Record<string, unknown>>,
  settings: ReadSettings,
): Promise<Step<VerificationKey>> {
  const found = await keyOf(header, settings);
  if ("reason" in found) return found;
  const key = found.value;
  const alg = String(header.alg);
  if (key.publicKeyJwk.alg !== undefined && key.publicKeyJwk.alg !== alg) {
    return { reason: `The key ${key.id} is for ${key.publicKeyJwk.alg} and the JWS names ${alg}.` };
  }
  try {
    await compactVerify(jws, await importJWK({ ...key.publicKeyJwk }, alg), { algorithms: [alg] });
  } catch (error) {
    const why = error instanceof Error ? error.message : "failed";
    return { reason: `The signature does not verify with the key ${key.id}: ${why}.` };
  }
  return { value: key };
}

/** What is wrong with a JWS, and which check of a verification it belongs to: the form of the input, or the proof. */
interface Fault {
  readonly check: "format" | "proof";
  readonly reason: string;
}

/** What the payload of a JWS whose signature verified held. */
interface Payload {
  readonly credential: AnyVerifiableCredential;
  /** The credential as the payload wrote it, which a schema judges, before the model read it. */
  readonly raw: unknown;
  /** What is wrong with the time claims, or `undefined`: they are the validity of the credential and not its form or its proof. */
  readonly timeFault: string | undefined;
}

/** Reads the payload of a JWS whose signature verified into a credential, and checks its other claims against it. */
function payloadOf(bytes: Uint8Array, settings: ReadSettings): { readonly value: Payload } | Fault {
  const payload = readObject(bytes, "payload", settings);
  if ("reason" in payload) return { check: "format", reason: payload.reason };
  const raw = carriedCredential(payload.value);
  const carried = readCarried(raw);
  if ("reason" in carried) return { check: "format", reason: carried.reason };
  const conflict = disagreement(payload.value, carried.value);
  if (conflict !== undefined) return { check: "proof", reason: conflict };
  return { value: { credential: carried.value, raw, timeFault: timeProblem(payload.value, settings) } };
}

/** What reading a JWS found: the credential with the key that verified it, or the fault. A key is not yet bound to the issuer. */
type JwtInspection =
  | ({ readonly valid: true; readonly key: VerificationKey } & Payload)
  | ({ readonly valid: false } & Fault);

/**
 * Reads a credential from a compact JWS as `readCredentialJwt` does, but tells the faults of the form from those of the proof,
 * keeps the time claims as a finding and not a fault, and leaves the key unbound: the caller binds it.
 */
export async function inspectJwt(jws: string, settings: ReadSettings): Promise<JwtInspection> {
  settings.signal?.throwIfAborted();
  const shape = shapeOf(jws, settings);
  if ("reason" in shape) return { valid: false, check: "format", reason: shape.reason };
  const headerFault = headerProblem(shape.value.header, settings);
  if (headerFault !== undefined) return { valid: false, check: "proof", reason: headerFault };
  const verified = await verifiedKey(jws, shape.value.header, settings);
  if ("reason" in verified) return { valid: false, check: "proof", reason: verified.reason };
  settings.signal?.throwIfAborted();
  const payload = payloadOf(shape.value.payload, settings);
  return "check" in payload ? { valid: false, ...payload } : { valid: true, key: verified.value, ...payload.value };
}

/**
 * Reads a credential from a compact JWS: verifies the signature with the key that the header names, checks the claims against
 * the credential, and checks that the key belongs to the issuer.
 *
 * @remarks
 * The JWS is checked for its size, then its shape, before anything is decoded; the header and the payload for their depth
 * before they are parsed. The algorithm must be one of `algorithms`, the key must be named by exactly one of `kid` and
 * `jwk` (a `jwk` with a private member is refused), and `crit` is refused. The payload is a credential in the form of Open
 * Badges 8.2 (the credential with the claims `iss`, `jti`, `nbf`, `sub` and `exp`), in the form of VC-JOSE-COSE (the credential
 * alone) or in the `vc` claim form of VC-JWT 1.1; the claims that are present must say what the credential says. A key
 * belongs to the issuer when `verifyIssuerKey` says so, and an unbound key is a proof that is not valid unless
 * `allowUnboundKeys` is set, which skips the binding and gives `bound: false`.
 *
 * A proof that is not valid is a value. A service that fails is not: the key and the keys of the issuer are read through the
 * resolver.
 *
 * @param jws - The compact JWS.
 * @param options - The resolver, the clock and the other options of the read.
 * @returns The credential with the key that verified it, or the reason that the JWS is not valid.
 * @throws `DataError` when an argument is not valid.
 * @throws `ServiceError` when the key or the keys of the issuer cannot be read.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/#proof-formats | Open Badges 3.0, JSON Web Token proof}
 * @see {@link https://www.w3.org/TR/vc-jose-cose/ | Securing Verifiable Credentials using JOSE and COSE}
 */
export async function readCredentialJwt(jws: string, options: JwtReadOptions): Promise<ProofResult> {
  const settings = readSettings(options);
  if (typeof jws !== "string") throw new DataError(`The JWS must be a string, found ${describe(jws)}.`);
  const invalid = (reason: string): ProofResult => ({ valid: false, reason });
  const inspected = await inspectJwt(jws, settings);
  if (!inspected.valid) return invalid(inspected.reason);
  if (inspected.timeFault !== undefined) return invalid(inspected.timeFault);
  const { key, credential } = inspected;
  const binding = await bindKey(key, valuesOf(credential).issuer, settings);
  return "reason" in binding ? invalid(binding.reason) : { valid: true, credential, key, bound: binding.bound };
}
