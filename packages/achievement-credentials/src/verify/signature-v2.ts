import { createIssueSink, isRecord, parseJsonText } from "@interopkit/core/checks";
import { compactVerify, importSPKI } from "jose";
import { decodeBase64url } from "../base64url.js";
import { jsonRefusals } from "../json-text.js";
import { MAX_HEADER_CHARS } from "../jwt/internal.js";
import type { BadgeAssertionV2, CryptographicKeyV2, VerificationCheck } from "../model/index.js";
import { inspectDocumentV2 } from "../read/internal.js";
import type { Context } from "./context.js";
import { fetchDocumentV2 } from "./fetch-v2.js";
import type { Checks } from "./result.js";
import { checkOf } from "./result.js";

/**
 * The most keys of its issuer that a signed assertion without a `creator` is tried against, each a fetch. An issuer lists one
 * key, or a few while it rotates them.
 */
const MAX_ISSUER_KEYS = 8;

/** The most bits of the modulus of an RSA key: a larger one costs more to verify than any issuer needs. */
const MAX_RSA_MODULUS_BITS = 8192;

/** The levels and tokens of the protected header. */
const HEADER_LIMITS = { maxDepth: 4, maxTokens: 64 };

/** Reads the `alg` of the protected header of a compact JWS, whose parts are canonical base64url, when it is a JSON object. */
function algorithmOf(header: string): string | undefined {
  if (header.length > MAX_HEADER_CHARS) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64url(header));
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = parseJsonText(text, HEADER_LIMITS, jsonRefusals("The header of the JWS", HEADER_LIMITS));
  } catch {
    // The header is not JSON within its limits, so it names no algorithm.
    return undefined;
  }
  return isRecord(parsed) && typeof parsed.alg === "string" ? parsed.alg : undefined;
}

/** The id of a key that a badge names: the IRI, or the `id` of a key that it embeds. */
function keyIdOf(key: string | CryptographicKeyV2): string | undefined {
  return typeof key === "string" ? key : key.id;
}

/** A key that a verification may use: its id, and the key as the issuer embeds it, or undefined when it is fetched. */
interface Candidate {
  readonly id: string;
  readonly embedded: CryptographicKeyV2 | undefined;
}

/**
 * Lists the keys that may verify a signed assertion: the `creator` of its verification when it names one, else the keys of its
 * issuer. A key counts only when the issuer lists it in `publicKey` (Open Badges 2.0, SignedBadge Verification: do not trust a
 * key that is not properly linked from the issuer Profile).
 */
function candidatesOf({
  assertion,
  issuer,
}: BadgeAssertionV2): { readonly keys: readonly Candidate[] } | VerificationCheck {
  const listed = (issuer.publicKey ?? []).flatMap((key) => {
    const id = keyIdOf(key);
    return id === undefined ? [] : [{ id, embedded: typeof key === "string" ? undefined : key }];
  });
  const creator = assertion.verification.creator;
  if (creator === undefined) {
    if (listed.length === 0) return checkOf("issuer", "failed", `The issuer ${issuer.id} lists no key in publicKey.`);
    return { keys: listed.slice(0, MAX_ISSUER_KEYS) };
  }
  const id = keyIdOf(creator);
  const found = listed.find((key) => key.id === id);
  return found === undefined
    ? checkOf(
        "issuer",
        "failed",
        `The assertion is signed by the key ${id}, which its issuer ${issuer.id} does not list.`,
      )
    : { keys: [found] };
}

/** What a key is to a verification: its PEM, or the checks that say why it is not one. */
type KeyStep = { readonly pem: string } | { readonly checks: Checks };

/** Has the key of a candidate: the one that the issuer embeds, or the document at its address. */
async function keyOf(candidate: Candidate, badge: BadgeAssertionV2, context: Context): Promise<KeyStep> {
  let key = candidate.embedded;
  if (key === undefined) {
    const fetched = await fetchDocumentV2(candidate.id, `The key ${candidate.id}`, context);
    if ("unavailable" in fetched) return { checks: { proof: checkOf("proof", "unavailable", fetched.unavailable) } };
    if (!("document" in fetched)) {
      return {
        checks: { proof: checkOf("proof", "failed", "failed" in fetched ? fetched.failed : "The key is gone.") },
      };
    }
    const sink = createIssueSink(1000, true);
    key = inspectDocumentV2("cryptographic-key", fetched.document, sink);
    if (key === undefined || sink.list().length > 0 || key.id !== candidate.id) {
      return {
        checks: { proof: checkOf("proof", "failed", `The document at ${candidate.id} is not the key that it names.`) },
      };
    }
  }
  if (key.owner !== undefined && key.owner !== badge.issuer.id) {
    const detail = `The key ${candidate.id} is owned by ${key.owner}, not by the issuer ${badge.issuer.id}.`;
    return { checks: { issuer: checkOf("issuer", "failed", detail) } };
  }
  return key.publicKeyPem === undefined
    ? { checks: { proof: checkOf("proof", "failed", `The key ${candidate.id} has no publicKeyPem.`) } }
    : { pem: key.publicKeyPem };
}

/** Verifies a compact JWS with a public key in PEM, under the algorithm of its header. */
async function verifies(jws: string, pem: string, alg: string): Promise<string | undefined> {
  try {
    const key = await importSPKI(pem, alg);
    const { algorithm } = key;
    if ("modulusLength" in algorithm && typeof algorithm.modulusLength === "number") {
      if (algorithm.modulusLength > MAX_RSA_MODULUS_BITS) return `The key has more than ${MAX_RSA_MODULUS_BITS} bits.`;
    }
    await compactVerify(jws, key, { algorithms: [alg] });
    return undefined;
  } catch {
    // jose throws for a key that is not of the algorithm, a damaged PEM and a signature that does not verify alike.
    return "The signature does not verify with the key.";
  }
}

/**
 * Checks the signature of a signed 2.0 assertion (Open Badges 2.0, SignedBadge Verification): the key is the `creator` of its
 * verification, or one of the keys of its issuer, it must be listed by the issuer, and it is fetched from its address unless
 * the issuer embeds it. The parts of the JWS must be canonical base64url, and its header must name an algorithm that the host
 * allows, which are checked before any key is fetched.
 *
 * @returns The checks of the proof and the issuer.
 */
export async function checkSignature(jws: string, badge: BadgeAssertionV2, context: Context): Promise<Checks> {
  const parts = jws.split(".");
  if (parts.some((part) => decodeBase64url(part) === undefined)) {
    return { proof: checkOf("proof", "failed", "The parts of the JWS must be canonical base64url without padding.") };
  }
  const [header = ""] = parts;
  const alg = algorithmOf(header);
  const { algorithms } = context.settings;
  if (alg === undefined || !algorithms.includes(alg)) {
    const detail = `The header of the JWS names no algorithm that the verifier allows (${algorithms.join(", ")}).`;
    return { proof: checkOf("proof", "failed", detail) };
  }
  const candidates = candidatesOf(badge);
  if ("check" in candidates) return { issuer: candidates };
  let last: Checks = { proof: checkOf("proof", "failed", "No key of the issuer verifies the signature.") };
  for (const candidate of candidates.keys) {
    const key = await keyOf(candidate, badge, context);
    if ("checks" in key) {
      last = key.checks;
      continue;
    }
    const problem = await verifies(jws, key.pem, alg);
    if (problem === undefined) {
      return {
        proof: checkOf("proof", "passed", `The signature verifies with the key ${candidate.id}.`),
        issuer: checkOf("issuer", "passed", `The issuer ${badge.issuer.id} lists the key ${candidate.id}.`),
      };
    }
    last = { proof: checkOf("proof", "failed", problem) };
  }
  return last;
}
