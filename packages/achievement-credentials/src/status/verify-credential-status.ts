import { callService, readClock, ServiceError } from "@interopkit/core";
import { checkRecord, describe, isRecord } from "@interopkit/core/checks";
import { parseJsonText } from "../json-text.js";
import { readCredentialJwt } from "../jwt/index.js";
import type { CredentialV1p1, IssuableCredential, VerifiableCredential, VerificationCheck } from "../model/index.js";
import { credentialOrReason } from "../read/internal.js";
import { isSet, MIN_LIST_LENGTH } from "./bitstring.js";
import { decodeList } from "./encoded-list.js";
import { type CheckSettings, checkSettings, type StatusCheckOptions } from "./options.js";

/** The `type` of the status entry of Bitstring Status List (3.1). */
const ENTRY_TYPE = "BitstringStatusListEntry";

/** The `type` of the status of the 1EdTech Revocation List Status Method, which credentials of Open Badges 3.0 named first. */
const REVOCATION_LIST_TYPE = "1EdTechRevocationList";

/** The types of the credential that holds a list. */
const LIST_TYPE = "BitstringStatusListCredential";

/** What a set bit means for each purpose that this module reads. */
const MEANING: Readonly<Record<string, string>> = { revocation: "revoked", suspension: "suspended" };

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_048_576;
const MAX_DEPTH = 64;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

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

/** Tells whether text is an absolute HTTPS address, the only kind of list that is fetched. */
function isHttpsAddress(text: unknown): text is string {
  return typeof text === "string" && text.startsWith("https://") && URL.canParse(text);
}

/** What the status of a credential names: an entry of a Bitstring Status List, or a 1EdTech Revocation List. */
type Named = { readonly entry: Entry } | { readonly revocationList: string } | { readonly done: VerificationCheck };

/** Reads an entry of a Bitstring Status List, or says why there is nothing to check. */
function bitstringEntryOf(status: Readonly<Record<string, unknown>>): Named {
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
  if (!isHttpsAddress(statusListCredential)) {
    return {
      done: check(
        "failed",
        `STATUS_VERIFICATION_ERROR: the statusListCredential ${describe(statusListCredential)} is not an HTTPS address.`,
      ),
    };
  }
  return { entry: { url: statusListCredential, index, purpose: statusPurpose } };
}

/** Reads the status of a credential, or says why there is nothing to check. */
function entryOf(credential: unknown): Named {
  const status: unknown = isRecord(credential) ? credential.credentialStatus : undefined;
  if (status === undefined) return { done: check("skipped", "The credential has no credentialStatus.") };
  if (isRecord(status) && status.type === ENTRY_TYPE) return bitstringEntryOf(status);
  if (!isRecord(status) || status.type !== REVOCATION_LIST_TYPE) {
    const type = isRecord(status) ? describe(status.type) : describe(status);
    return {
      done: check(
        "skipped",
        `The credentialStatus is ${type}, and ${ENTRY_TYPE} and ${REVOCATION_LIST_TYPE} are checked.`,
      ),
    };
  }
  if (isHttpsAddress(status.id)) return { revocationList: status.id };
  return {
    done: check(
      "failed",
      `STATUS_VERIFICATION_ERROR: the id of the revocation list, ${describe(status.id)}, is not an HTTPS address.`,
    ),
  };
}

/** Reads the text of a list credential as a credential, verifying its proof and its issuer's hold on the key. */
async function verifiedList(text: string, settings: CheckSettings): Promise<VerifiableCredential> {
  const keyed = {
    keys: settings.keys,
    clock: settings.clock,
    maxTokens: settings.maxTokens,
    allowUnboundKeys: settings.allowUnboundKeys,
    ...(settings.algorithms === undefined ? {} : { algorithms: settings.algorithms }),
    ...(settings.clockSkewSeconds === undefined ? {} : { clockSkewSeconds: settings.clockSkewSeconds }),
    ...(settings.signal === undefined ? {} : { signal: settings.signal }),
  };
  if (!text.trimStart().startsWith("{")) {
    const result = await readCredentialJwt(text.trim(), keyed);
    if (!result.valid) throw new ListFailure(result.reason);
    return asList(result.credential);
  }
  const parsed = parseJsonText(
    text,
    { maxDepth: MAX_DEPTH, maxTokens: settings.maxTokens },
    "The status list credential",
  );
  if ("reason" in parsed) throw new ListFailure(parsed.reason);
  const checked = credentialOrReason(parsed.value, "The status list credential");
  if ("reason" in checked) throw new ListFailure(checked.reason);
  if (settings.contexts === undefined) {
    throw new ListUnavailable(
      "The status list credential has a Data Integrity proof, and no loader of contexts was given to check it.",
    );
  }
  // Loaded when a list credential with a Data Integrity proof is checked, so that a verifier of JWTs never loads JSON-LD.
  const { verifyProof } = await import("../data-integrity/index.js");
  const result = await verifyProof(parsed.value as IssuableCredential, {
    ...keyed,
    contexts: settings.contexts,
    legacyProofs: settings.legacyProofs,
    suites: settings.suites,
  });
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

/** Fetches the text of a list, within the time and size of the options. */
async function fetchText(url: string, what: string, accept: string, settings: CheckSettings): Promise<string> {
  return await callService(
    { fetch: settings.fetch, timeoutMs: settings.timeoutMs ?? DEFAULT_TIMEOUT_MS },
    `${what} at ${url}`,
    url,
    { method: "GET", headers: { accept } },
    { maxBytes: settings.maxBytes ?? DEFAULT_MAX_BYTES },
  );
}

/** Fetches a list credential and checks it, or throws what is wrong with it. */
async function fetchList(url: string, settings: CheckSettings): Promise<VerifiableCredential> {
  const accept = "application/vc+jwt, application/ld+json, application/json";
  return await verifiedList(await fetchText(url, "The status list credential", accept, settings), settings);
}

/** Fetches a revocation list of the 1EdTech Revocation List Status Method, a JSON object, or throws what is wrong with it. */
async function fetchRevocationList(url: string, settings: CheckSettings): Promise<Readonly<Record<string, unknown>>> {
  const text = await fetchText(url, "The revocation list", "application/json", settings);
  const parsed = parseJsonText(text, { maxDepth: MAX_DEPTH, maxTokens: settings.maxTokens }, "The revocation list");
  if ("reason" in parsed) throw new ListFailure(parsed.reason);
  if (!isRecord(parsed.value)) throw new ListFailure("The revocation list is not a JSON object.");
  return parsed.value;
}

/** Reads the identifier of the issuer of a credential. */
function issuerOf(credential: { readonly issuer: unknown }): string {
  const { issuer } = credential;
  return typeof issuer === "string" ? issuer : isRecord(issuer) && typeof issuer.id === "string" ? issuer.id : "";
}

/** Tells whether a list of the issuers it names may publish the status of a credential: its issuer, or one of `statusIssuers`. */
function mayPublish(issuers: readonly unknown[], issuer: string, settings: CheckSettings): boolean {
  return issuers.some(
    (named) => named === issuer || (typeof named === "string" && settings.statusIssuers.includes(named)),
  );
}

/** Reads what a property holds as a list: its members, or none when it is absent. */
function listOf(value: unknown): readonly unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Reads a revocation list of the 1EdTech Revocation List Status Method: the credential is revoked when the list names its `id`
 * with `revoked` true or absent. A list that names its issuers must name the credential's, or one of `statusIssuers`.
 */
function readRevocation(
  list: Readonly<Record<string, unknown>>,
  credential: Readonly<Record<string, unknown>>,
  settings: CheckSettings,
): VerificationCheck {
  const issuer = issuerOf({ issuer: credential.issuer });
  if (list.issuer !== undefined && !mayPublish(listOf(list.issuer), issuer, settings)) {
    return check(
      "failed",
      `STATUS_VERIFICATION_ERROR: the revocation list is issued by ${describe(list.issuer)}, not by ${issuer} or an issuer allowed to publish its status.`,
    );
  }
  const { id } = credential;
  if (typeof id !== "string") return check("skipped", "The credential has no id, which a revocation list names.");
  // The data model names the list revokedCredential, and its protocol and example revokedCredentials.
  const entries = [...listOf(list.revokedCredential), ...listOf(list.revokedCredentials)].filter(isRecord);
  const revoked = entries.find(
    (entry) => entry.id === id && (entry.revoked === undefined || entry.revoked === true || entry.revoked === "true"),
  );
  if (revoked === undefined) return check("passed", "The revocation list does not name the credential as revoked.");
  const reason = typeof revoked.revocationReason === "string" ? `: ${revoked.revocationReason}` : ".";
  return check("failed", `The credential is revoked${reason}`);
}

/** The bits of the list of each list credential, decoded once: a list is read again for each credential that names it. */
const decodedLists = new WeakMap<object, ReturnType<typeof decodeList>>();

/** Decodes the list of a list credential, or returns the decoding that was made of it before. */
function decodedList(list: VerifiableCredential, encoded: unknown): ReturnType<typeof decodeList> {
  const earlier = decodedLists.get(list);
  if (earlier !== undefined) return earlier;
  const decoding = decodeList(encoded);
  decodedLists.set(list, decoding);
  return decoding;
}

/** Checks a verified list against the entry that names it, and reads the bit. */
async function readEntry(
  list: VerifiableCredential,
  entry: Entry,
  issuer: string,
  settings: CheckSettings,
): Promise<VerificationCheck> {
  const listIssuer = issuerOf(list);
  if (!mayPublish([listIssuer], issuer, settings)) {
    return check(
      "failed",
      `STATUS_VERIFICATION_ERROR: the status list credential is issued by ${listIssuer}, not by ${issuer} or an issuer allowed to publish its status.`,
    );
  }
  const now = readClock(settings.clock);
  const skew = (settings.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS) * MILLISECONDS_PER_SECOND;
  const expires = list.validUntil === undefined ? Infinity : Date.parse(list.validUntil);
  if (now + skew < Date.parse(list.validFrom) || now - skew >= expires) {
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
  const decoded = await decodedList(list, isRecord(subject) ? subject.encodedList : undefined);
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
 * `statusIssuers`. Its purpose must be the entry's, its validity must hold within `clockSkewSeconds`, its `encodedList` is
 * inflated through a `DecompressionStream` that stops at 16,777,216 bytes, once for each list credential, it must have at least
 * 131,072 entries, and the index must be inside it. Every failure is a `failed` check that names its code. A credential with no
 * status, a status of another type, a purpose other than revocation and suspension, or entries wider than one bit give `skipped`
 * and say so: the list is never read as one bit then.
 *
 * A status of the type `1EdTechRevocationList` (the 1EdTech Revocation List Status Method, which credentials of Open Badges 3.0
 * named before Bitstring Status List) is read from the JSON list at its HTTPS `id`: the credential is revoked when the list
 * names its `id` with `revoked` true or absent, and a list that names its issuers must name the credential's or one of
 * `statusIssuers`. Such a list is not signed, so it is as true as the HTTPS of its address.
 *
 * A list that cannot be fetched, or whose Data Integrity proof cannot be checked for want of contexts, gives `unavailable`. With a
 * `cache` a list is kept across verifications until its `ttl` or `validUntil`, and 300,000 ms for a revocation list.
 *
 * @param credential - The credential.
 * @param options - The `fetch`, the keys, the clock and the other options.
 * @returns The `status` check.
 * @throws `DataError` when an argument is not valid.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-bitstring-status-list/#validate-algorithm | Bitstring Status List, validate algorithm}
 * @see {@link https://www.imsglobal.org/spec/vcrl/v1p0/ | 1EdTech Revocation List Status Method}
 */
export async function verifyCredentialStatus(
  credential: IssuableCredential | CredentialV1p1,
  options: StatusCheckOptions,
): Promise<VerificationCheck> {
  const settings = checkSettings(options);
  checkRecord(credential, "The credential must be an object");
  settings.signal?.throwIfAborted();
  const read = entryOf(credential);
  if ("done" in read) return read.done;
  const withSignal = settings.signal === undefined ? undefined : { signal: settings.signal };
  const cached = <TDocument extends object>(url: string, load: () => Promise<TDocument>): Promise<object> =>
    settings.cache === undefined ? load() : settings.cache.get(url, load, withSignal);
  try {
    if ("revocationList" in read) {
      const list = await cached(read.revocationList, () => fetchRevocationList(read.revocationList, settings));
      return readRevocation(isRecord(list) ? list : {}, credential, settings);
    }
    const { entry } = read;
    const list = await cached(entry.url, () => fetchList(entry.url, settings));
    return await readEntry(asList(list), entry, issuerOf(credential), settings);
  } catch (error) {
    if (error instanceof ListFailure) return check("failed", `STATUS_VERIFICATION_ERROR: ${error.message}`);
    if (error instanceof ServiceError || error instanceof ListUnavailable) {
      return check("unavailable", `STATUS_RETRIEVAL_ERROR: ${error.message}`);
    }
    throw error;
  }
}
