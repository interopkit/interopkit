import { callService, ServiceError } from "@interopkit/core";
import { checkRecord, describe, isRecord, nestsDeeperThan } from "@interopkit/core/checks";
import { readCredentialJwt } from "../jwt/index.js";
import type { IssuableCredential, VerifiableCredential, VerificationCheck } from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { isSet, MIN_LIST_LENGTH } from "./bitstring.js";
import { decodeList } from "./encoded-list.js";
import { type CheckSettings, checkSettings, type StatusCheckOptions } from "./options.js";

/** The `type` of the status entry that this module checks (Bitstring Status List 3.1). */
const ENTRY_TYPE = "BitstringStatusListEntry";

/** The types of the credential that holds a list. */
const LIST_TYPE = "BitstringStatusListCredential";

/** What a set bit means for each purpose that this module reads. */
const MEANING: Readonly<Record<string, string>> = { revocation: "revoked", suspension: "suspended" };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_DEPTH = 64;
const MILLISECONDS_PER_SECOND = 1000;
const CLOCK_SKEW_SECONDS = 60;

const check = (outcome: VerificationCheck["outcome"], detail: string): VerificationCheck => ({
  check: "status",
  outcome,
  detail,
});

/** A list credential that is not valid, with the sentence that says why: a verdict, never a thrown error. */
class ListFailure extends Error {}

/** A list credential that cannot be checked with what the host gave, which is not a fault of the credential. */
class ListUnavailable extends Error {}

/** The entry of a credential that this module reads, with the index it names. */
interface Entry {
  readonly url: string;
  readonly index: number;
  readonly purpose: string;
}

/** Reads the status entry of a credential, or says why there is nothing to check. */
function entryOf(credential: unknown): { readonly entry: Entry } | { readonly done: VerificationCheck } {
  const status: unknown = isRecord(credential) ? credential.credentialStatus : undefined;
  if (status === undefined) return { done: check("skipped", "The credential has no credentialStatus.") };
  if (!isRecord(status) || status.type !== ENTRY_TYPE) {
    const type = isRecord(status) ? describe(status.type) : describe(status);
    return { done: check("skipped", `The credentialStatus is ${type}, and only ${ENTRY_TYPE} is checked.`) };
  }
  const { statusPurpose, statusSize, statusListIndex, statusListCredential } = status;
  if (typeof statusPurpose !== "string" || MEANING[statusPurpose] === undefined) {
    return {
      done: check(
        "skipped",
        `The statusPurpose ${describe(statusPurpose)} is not revocation or suspension, so the status is not read as a bit.`,
      ),
    };
  }
  if (statusSize !== undefined && statusSize !== 1) {
    return {
      done: check(
        "skipped",
        `The statusSize ${describe(statusSize)} is not 1, so the list is not read as one bit for each entry.`,
      ),
    };
  }
  const index =
    typeof statusListIndex === "string" && /^\d{1,15}$/u.test(statusListIndex) ? Number(statusListIndex) : Number.NaN;
  if (Number.isNaN(index)) {
    return {
      done: check(
        "failed",
        `RANGE_ERROR: the statusListIndex ${describe(statusListIndex)} is not a non-negative integer.`,
      ),
    };
  }
  if (
    typeof statusListCredential !== "string" ||
    !URL.canParse(statusListCredential) ||
    !statusListCredential.startsWith("https://")
  ) {
    return {
      done: check(
        "failed",
        `STATUS_VERIFICATION_ERROR: the statusListCredential ${describe(statusListCredential)} is not an HTTPS address.`,
      ),
    };
  }
  return { entry: { url: statusListCredential, index, purpose: statusPurpose } };
}

/** Reads the text of a list credential as a credential, verifying its proof and its issuer's hold on the key. */
async function verifiedList(text: string, settings: CheckSettings): Promise<VerifiableCredential> {
  const keyed = {
    keys: settings.keys,
    clock: settings.clock,
    ...(settings.signal === undefined ? {} : { signal: settings.signal }),
  };
  if (!text.trimStart().startsWith("{")) {
    const result = await readCredentialJwt(text.trim(), keyed);
    if (!result.valid) throw new ListFailure(result.reason);
    return asList(result.credential);
  }
  if (nestsDeeperThan(text, MAX_DEPTH))
    throw new ListFailure(`The status list credential nests more than ${MAX_DEPTH} levels.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ListFailure("The status list credential is not JSON.");
  }
  const checked = credentialOrReason(parsed, "The status list credential");
  if ("reason" in checked) throw new ListFailure(checked.reason);
  if (settings.contexts === undefined) {
    throw new ListUnavailable(
      "The status list credential has a Data Integrity proof, and no loader of contexts was given to check it.",
    );
  }
  // Loaded when a list credential with a Data Integrity proof is checked, so that a verifier of JWTs never loads JSON-LD.
  const { verifyProof } = await import("../data-integrity/index.js");
  const result = await verifyProof(parsed as IssuableCredential, { ...keyed, contexts: settings.contexts });
  if (!result.valid) throw new ListFailure(result.reason);
  return asList(result.credential);
}

/** Checks that a credential is a list credential of the types that Bitstring Status List names. */
function asList(credential: unknown): VerifiableCredential {
  const record = isRecord(credential) ? credential : {};
  if (!Array.isArray(record.type) || !record.type.includes(LIST_TYPE)) {
    throw new ListFailure(`The credential at the address is not a ${LIST_TYPE}.`);
  }
  return credential as VerifiableCredential;
}

/** Fetches a list credential and checks it, or throws what is wrong with it. */
async function fetchList(url: string, settings: CheckSettings): Promise<VerifiableCredential> {
  const text = await callService(
    { fetch: settings.fetch, timeoutMs: settings.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    `The status list credential at ${url}`,
    url,
    { method: "GET", headers: { accept: "application/vc+jwt, application/ld+json, application/json" } },
    { maxBytes: settings.maxBytes ?? DEFAULT_MAX_BYTES },
  );
  return await verifiedList(text, settings);
}

/** Reads the identifier of the issuer of a credential. */
function issuerOf(credential: { readonly issuer: unknown }): string {
  const { issuer } = credential;
  return typeof issuer === "string" ? issuer : isRecord(issuer) && typeof issuer.id === "string" ? issuer.id : "";
}

/** Checks a verified list against the entry that names it, and reads the bit. */
async function readEntry(
  list: VerifiableCredential,
  entry: Entry,
  issuer: string,
  settings: CheckSettings,
): Promise<VerificationCheck> {
  const listIssuer = issuerOf(list);
  if (listIssuer !== issuer && !settings.statusIssuers.includes(listIssuer)) {
    return check(
      "failed",
      `STATUS_VERIFICATION_ERROR: the status list credential is issued by ${listIssuer}, not by ${issuer} or an issuer allowed to publish its status.`,
    );
  }
  const now = settings.clock.now();
  const expires = list.validUntil === undefined ? Infinity : Date.parse(list.validUntil);
  if (
    now + CLOCK_SKEW_SECONDS * MILLISECONDS_PER_SECOND < Date.parse(list.validFrom) ||
    now - CLOCK_SKEW_SECONDS * MILLISECONDS_PER_SECOND >= expires
  ) {
    return check("failed", "STATUS_VERIFICATION_ERROR: the status list credential is not valid at this time.");
  }
  const subject: unknown = list.credentialSubject;
  const purposes = isRecord(subject) ? [subject.statusPurpose].flat() : [];
  if (!purposes.includes(entry.purpose)) {
    return check(
      "failed",
      `STATUS_VERIFICATION_ERROR: purpose mismatch, the entry is for ${entry.purpose} and the list is for ${describe(isRecord(subject) ? subject.statusPurpose : undefined)}.`,
    );
  }
  const decoded = await decodeList(isRecord(subject) ? subject.encodedList : undefined);
  if ("reason" in decoded) return check("failed", `STATUS_VERIFICATION_ERROR: ${decoded.reason}`);
  const length = decoded.bits.byteLength * 8;
  if (length < MIN_LIST_LENGTH) {
    return check(
      "failed",
      `STATUS_LIST_LENGTH_ERROR: the list has ${length} entries, and the least is ${MIN_LIST_LENGTH}.`,
    );
  }
  if (entry.index >= length) {
    return check("failed", `RANGE_ERROR: the index ${entry.index} is outside a list of ${length} entries.`);
  }
  return isSet(decoded.bits, entry.index)
    ? check("failed", `The credential is ${MEANING[entry.purpose]}: entry ${entry.index} of ${entry.url} is set.`)
    : check("passed", `Entry ${entry.index} of ${entry.url} is not set.`);
}

/**
 * Checks the status of a credential: fetches the status list credential that its `credentialStatus` names, verifies it, and reads
 * the bit.
 *
 * @remarks
 * The algorithm is that of Bitstring Status List 3.2. The list credential is a compact JWS or a credential with a Data Integrity
 * proof; its proof is verified and its key is bound to its issuer, which must be the credential's issuer or one of
 * `statusIssuers`. Its purpose must be the entry's, its validity must hold, its `encodedList` is inflated through a
 * `DecompressionStream` that stops at 16,777,216 bytes, it must have at least 131,072 entries, and the index must be inside it.
 * Every failure is a `failed` check that names its code. A credential with no status, a status of another type, a purpose other
 * than revocation and suspension, or entries wider than one bit give `skipped` and say so: the list is never read as one bit
 * then. A list that cannot be fetched, or whose Data Integrity proof cannot be checked for want of contexts, gives `unavailable`.
 * With a `cache` the list credential is kept across verifications until its `ttl` or `validUntil`.
 *
 * @param credential - The credential.
 * @param options - The `fetch`, the keys, the clock and the other options.
 * @returns The `status` check.
 * @throws `DataError` when an argument is not valid.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-bitstring-status-list/#validate-algorithm | Bitstring Status List, validate algorithm}
 */
export async function verifyCredentialStatus(
  credential: IssuableCredential,
  options: StatusCheckOptions,
): Promise<VerificationCheck> {
  const settings = checkSettings(options);
  checkRecord(credential, "The credential must be an object");
  settings.signal?.throwIfAborted();
  const read = entryOf(credential);
  if ("done" in read) return read.done;
  const { entry } = read;
  try {
    const load = () => fetchList(entry.url, settings);
    const withSignal = settings.signal === undefined ? undefined : { signal: settings.signal };
    const list = settings.cache === undefined ? await load() : await settings.cache.get(entry.url, load, withSignal);
    return await readEntry(list, entry, issuerOf(credential), settings);
  } catch (error) {
    if (error instanceof ListFailure) return check("failed", `STATUS_VERIFICATION_ERROR: ${error.message}`);
    if (error instanceof ServiceError || error instanceof ListUnavailable) {
      return check("unavailable", `STATUS_RETRIEVAL_ERROR: ${error.message}`);
    }
    throw error;
  }
}
