import { callService, type DataError, raceAbort, readClock, ServiceError } from "@interopkit/core";
import { checkRecord, describe, isRecord, parseJsonText } from "@interopkit/core/checks";
import { jsonRefusals } from "../json-text.js";
import { readCredentialJwtWith } from "../jwt/internal.js";
import type { AnyVerifiableCredential, CredentialV1p1, IssuableCredential, VerificationCheck } from "../model/index.js";
import { fetchOf } from "../option-checks.js";
import { credentialOrReason } from "../read/internal.js";
import { isSet, MIN_LIST_LENGTH } from "./bitstring.js";
import { decodeList } from "./encoded-list.js";
import { type StatusCheckOptions, type StatusSettings, statusSettings } from "./options.js";

/** The `type` of the status entry of Bitstring Status List (3.1). */
const ENTRY_TYPE = "BitstringStatusListEntry";

/** The `type` of the status of the 1EdTech Revocation List Status Method, which credentials of Open Badges 3.0 named first. */
const REVOCATION_LIST_TYPE = "1EdTechRevocationList";

/** The types of the credential that holds a list. */
const LIST_TYPE = "BitstringStatusListCredential";

/** What a set bit means for each purpose that this module reads. */
const MEANING: Readonly<Record<string, string>> = { revocation: "revoked", suspension: "suspended" };

const MILLISECONDS_PER_SECOND = 1000;

const check = (outcome: VerificationCheck["outcome"], detail: string): VerificationCheck => ({
  check: "status",
  outcome,
  detail,
});

/** A list credential that is not valid, with the sentence that says why: a verdict, never a thrown error. */
class ListFailure extends Error {}

/** A list credential that cannot be checked with what the host gave, which is not a fault of the credential. */
class ListUnavailable extends Error {}

/** Parses the text of a list within the levels and the tokens of the options, or throws what is wrong with it. */
function parseList(text: string, what: string, settings: StatusSettings): unknown {
  const limits = { maxDepth: settings.maxDepth, maxTokens: settings.maxTokens };
  try {
    return parseJsonText(text, limits, jsonRefusals(what, limits));
  } catch (error) {
    // `parseJsonText` throws a `DataError` that says which limit the text passes, or why it is not JSON.
    throw new ListFailure((error as DataError).message, { cause: error });
  }
}

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
function entryOf(credential: IssuableCredential | CredentialV1p1): Named {
  const status: unknown = credential.credentialStatus;
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

/**
 * Reads the text of a list credential as a credential, verifying its proof and its issuer's hold on the key.
 *
 * @param signal - Ends the work, for a load that one caller makes alone; a load that callers share has none.
 */
async function verifiedList(
  text: string,
  settings: StatusSettings,
  signal: AbortSignal | undefined,
): Promise<AnyVerifiableCredential> {
  if (!text.trimStart().startsWith("{")) {
    const result = await readCredentialJwtWith(text.trim(), { ...settings, signal });
    if (!result.valid) throw new ListFailure(result.reason);
    return asList(result.credential);
  }
  const value = parseList(text, "The status list credential", settings);
  const checked = credentialOrReason(value, "The status list credential");
  if ("reason" in checked) throw new ListFailure(checked.reason);
  if (settings.contexts === undefined) {
    throw new ListUnavailable(
      "The status list credential has a Data Integrity proof, and no loader of contexts was given to check it.",
    );
  }
  // Loaded when a list credential with a Data Integrity proof is checked, so that a verifier of JWTs never loads JSON-LD.
  const { verifyProofWith } = await import("../data-integrity/internal.js");
  // The proof secures the list credential as it was written, which the reader of the model has found to be a credential.
  const result = await verifyProofWith(value as Readonly<Record<string, unknown>>, {
    ...settings,
    contexts: settings.contexts,
    signal,
  });
  if (!result.valid) throw new ListFailure(result.reason);
  return asList(result.credential);
}

/** Tells whether a credential has the types that Bitstring Status List names for the credential that holds a list. */
function isListCredential(credential: unknown): credential is AnyVerifiableCredential {
  return isRecord(credential) && Array.isArray(credential.type) && credential.type.includes(LIST_TYPE);
}

/** Checks that a credential is a list credential of the types that Bitstring Status List names. */
function asList(credential: unknown): AnyVerifiableCredential {
  if (!isListCredential(credential)) throw new ListFailure(`The credential at the address is not a ${LIST_TYPE}.`);
  return credential;
}

/** Reads when a list credential becomes valid and stops being valid, under either data model, in milliseconds since 1970. */
function periodOf(list: AnyVerifiableCredential): { readonly from: number; readonly until: number } {
  const [from, until] =
    "issuanceDate" in list ? [list.issuanceDate, list.expirationDate] : [list.validFrom, list.validUntil];
  return { from: Date.parse(from), until: until === undefined ? Infinity : Date.parse(until) };
}

/** Fetches the text of a list, within the time and size of the options, and until the signal aborts when a caller gives one. */
async function fetchText(
  url: string,
  what: string,
  accept: string,
  settings: StatusSettings,
  signal: AbortSignal | undefined,
): Promise<string> {
  return await callService(
    { fetch: fetchOf(settings), timeoutMs: settings.timeoutMs, signal },
    `${what} at ${url}`,
    url,
    { method: "GET", headers: { accept } },
    { maxBytes: settings.maxBytes },
  );
}

/** Fetches a list credential and checks it, or throws what is wrong with it. */
async function fetchList(
  url: string,
  settings: StatusSettings,
  signal: AbortSignal | undefined,
): Promise<AnyVerifiableCredential> {
  const accept = "application/vc+jwt, application/ld+json, application/json";
  return await verifiedList(
    await fetchText(url, "The status list credential", accept, settings, signal),
    settings,
    signal,
  );
}

/** Fetches a revocation list of the 1EdTech Revocation List Status Method, a JSON object, or throws what is wrong with it. */
async function fetchRevocationList(
  url: string,
  settings: StatusSettings,
  signal: AbortSignal | undefined,
): Promise<Readonly<Record<string, unknown>>> {
  const text = await fetchText(url, "The revocation list", "application/json", settings, signal);
  const value = parseList(text, "The revocation list", settings);
  if (!isRecord(value)) throw new ListFailure("The revocation list is not a JSON object.");
  return value;
}

/** The number of each object of a host that decides whether a list credential counts, kept while the object lives. */
const identities = { made: 0, of: new WeakMap<object, number>() };

/** Returns the number of an object of the host, which it is given when it is first seen. */
function identityOf(port: object): number {
  const known = identities.of.get(port);
  if (known !== undefined) return known;
  identities.made += 1;
  identities.of.set(port, identities.made);
  return identities.made;
}

/**
 * Returns what a list is kept by in a cache: its address, and the trust under which the call verifies it, which is the resolver
 * of keys, the loader of contexts, the suites, and the options that decide whether a proof counts. A list that one call
 * verified is never served to a call that trusts less, so a cache that verifiers of different policies share lends none of
 * them a list that only another would accept.
 */
function cacheKeyOf(url: string, settings: StatusSettings): string {
  return JSON.stringify([
    url,
    identityOf(settings.keys),
    settings.contexts === undefined ? null : identityOf(settings.contexts),
    settings.suites.map(identityOf),
    settings.allowUnboundKeys,
    settings.legacyProofs,
    settings.algorithms,
    settings.clockSkewSeconds,
  ]);
}

/** Reads the identifier of the issuer of a credential. */
function issuerOf(credential: { readonly issuer: unknown }): string {
  const { issuer } = credential;
  return typeof issuer === "string" ? issuer : isRecord(issuer) && typeof issuer.id === "string" ? issuer.id : "";
}

/** Tells whether a list of the issuers it names may publish the status of a credential: its issuer, or one of `statusIssuers`. */
function mayPublish(issuers: readonly unknown[], issuer: string, settings: StatusSettings): boolean {
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
  credential: IssuableCredential | CredentialV1p1,
  settings: StatusSettings,
): VerificationCheck {
  const issuer = issuerOf(credential);
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
function decodedList(list: AnyVerifiableCredential, encoded: unknown): ReturnType<typeof decodeList> {
  const earlier = decodedLists.get(list);
  if (earlier !== undefined) return earlier;
  const decoding = decodeList(encoded);
  decodedLists.set(list, decoding);
  return decoding;
}

/** Checks a verified list against the entry that names it, and reads the bit. */
async function readEntry(
  list: AnyVerifiableCredential,
  entry: Entry,
  issuer: string,
  settings: StatusSettings,
): Promise<VerificationCheck> {
  const listIssuer = issuerOf(list);
  if (!mayPublish([listIssuer], issuer, settings)) {
    return check(
      "failed",
      `STATUS_VERIFICATION_ERROR: the status list credential is issued by ${listIssuer}, not by ${issuer} or an issuer allowed to publish its status.`,
    );
  }
  const now = readClock(settings.clock);
  const skew = settings.clockSkewSeconds * MILLISECONDS_PER_SECOND;
  const period = periodOf(list);
  if (now + skew < period.from || now - skew >= period.until) {
    return check("failed", "STATUS_VERIFICATION_ERROR: the status list credential is not valid at this time.");
  }
  // The reader refuses a subject that is not one object.
  const subject = list.credentialSubject as Readonly<Record<string, unknown>>;
  if (![subject.statusPurpose].flat().includes(entry.purpose)) {
    return check(
      "failed",
      `STATUS_VERIFICATION_ERROR: purpose mismatch, the entry is for ${entry.purpose} and the list is for ${describe(subject.statusPurpose)}.`,
    );
  }
  const decoded = await decodedList(list, subject.encodedList);
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
 * The list credential is read within the limits of a credential: `maxInputBytes`, `maxDepth`, `maxTokens` and, for a Data
 * Integrity proof, `maxJsonLdTokens`. A list that cannot be fetched, or whose Data Integrity proof cannot be checked for want of
 * contexts, gives `unavailable`. With `statusLists` a list is kept across verifications until its `ttl` or `validUntil`, and
 * 300,000 ms for a revocation list.
 *
 * @param credential - The credential.
 * @param options - The `fetch`, the keys, the clock and the other options.
 * @returns The `status` check.
 * @throws `DataError` when an argument is not valid.
 * @throws The `reason` of the signal when it aborts.
 * @see {@link https://www.w3.org/TR/vc-bitstring-status-list/#validate-algorithm | Bitstring Status List, validate algorithm}
 * @see {@link https://www.imsglobal.org/spec/vcrl/v1p0/ | 1EdTech Revocation List Status Method}
 *
 * @example
 * ```ts
 * import { buildAchievementCredential } from "@interopkit/achievement-credentials";
 * import { createKeyResolver } from "@interopkit/achievement-credentials/keys";
 * import {
 *   allocateStatusIndex,
 *   createStatusList,
 *   issueStatusListCredential,
 *   setCredentialStatus,
 *   verifyCredentialStatus,
 * } from "@interopkit/achievement-credentials/status";
 * import { createCryptoKeySigner, SYSTEM_RANDOM } from "@interopkit/core";
 *
 * const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
 * const publicKeyJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
 * const issuer = "https://example.edu/issuers/565049";
 * const listAddress = "https://example.edu/status/revocations/1";
 * const controller = {
 *   id: issuer,
 *   verificationMethod: [{ id: `${issuer}#key-1`, type: "JsonWebKey", controller: issuer, publicKeyJwk }],
 *   assertionMethod: [`${issuer}#key-1`],
 * };
 * const clock = { now: () => Date.UTC(2024, 5, 14) };
 * const signer = createCryptoKeySigner(pair.privateKey, { algorithm: "ES256", keyId: `${issuer}#key-1` });
 *
 * // The issuer gives the credential an index that says nothing of the order of issue, and revokes it.
 * const index = allocateStatusIndex(new Set(), { length: 131_072, random: SYSTEM_RANDOM });
 * const list = setCredentialStatus(createStatusList(), index, true);
 * const jws = await issueStatusListCredential(
 *   { id: listAddress, issuer, validFrom: "2024-06-01T00:00:00Z", purpose: "revocation", list },
 *   signer,
 *   { clock },
 * );
 * const documents = new Map([
 *   [issuer, JSON.stringify(controller)],
 *   [listAddress, String(jws)],
 * ]);
 * const keys = createKeyResolver({
 *   clock,
 *   fetch: async (url) => new Response(documents.get(url) ?? "", { status: documents.has(url) ? 200 : 404 }),
 * });
 * const entry = {
 *   id: `${listAddress}#${index}`,
 *   type: "BitstringStatusListEntry",
 *   statusPurpose: "revocation",
 *   statusListIndex: String(index),
 *   statusListCredential: listAddress,
 * };
 * const credential = buildAchievementCredential({
 *   id: "https://example.edu/credentials/3732",
 *   issuer: { id: issuer, type: ["Profile"], name: "Example University" },
 *   validFrom: "2024-06-13T18:46:03Z",
 *   name: "Fractions badge",
 *   subject: { id: "did:example:learner" },
 *   achievement: {
 *     id: "https://example.edu/achievements/1",
 *     type: ["Achievement"],
 *     name: "Fractions",
 *     description: "Understands fractions as numbers.",
 *     criteria: { narrative: "Pass the final assessment." },
 *   },
 *   credentialStatus: entry,
 * });
 * const result = await verifyCredentialStatus(credential, {
 *   fetch: async (url) => new Response(documents.get(url) ?? "", { status: documents.has(url) ? 200 : 404 }),
 *   keys,
 *   clock,
 * });
 * result.outcome; // => "failed"
 * result.detail.startsWith("The credential is revoked"); // => true
 * ```
 */
export async function verifyCredentialStatus(
  credential: IssuableCredential | CredentialV1p1,
  options: StatusCheckOptions,
): Promise<VerificationCheck> {
  const settings = statusSettings(options);
  checkRecord(credential, "The credential must be an object");
  return await verifyCredentialStatusWith(credential, settings);
}

/**
 * Checks the status of a credential as `verifyCredentialStatus` does, with the settings that its caller has checked.
 *
 * @throws The `reason` of the signal when it aborts.
 */
export async function verifyCredentialStatusWith(
  credential: IssuableCredential | CredentialV1p1,
  settings: StatusSettings,
): Promise<VerificationCheck> {
  settings.signal?.throwIfAborted();
  const read = entryOf(credential);
  if ("done" in read) return read.done;
  const { statusLists, signal } = settings;
  const cached = <TDocument extends object>(
    url: string,
    load: (signal: AbortSignal | undefined) => Promise<TDocument>,
  ): Promise<object> => {
    if (statusLists === undefined) return load(signal);
    // The callers that ask for a list while it loads share the load, so it runs to its own timeouts with no caller's signal.
    // The cache is the host's port and may ignore the signal it is given: the wait ends at the signal either way.
    const shared = statusLists.get(
      cacheKeyOf(url, settings),
      () => load(undefined),
      signal === undefined ? undefined : { signal },
    );
    return raceAbort(Promise.resolve(shared), { signal });
  };
  try {
    if ("revocationList" in read) {
      const list = await cached(read.revocationList, (loading) =>
        fetchRevocationList(read.revocationList, settings, loading),
      );
      // The cache is the host's port, and what it returns is checked again: a list that is no object names no revoked credential.
      if (!isRecord(list)) throw new ListFailure("The revocation list is not a JSON object.");
      return readRevocation(list, credential, settings);
    }
    const { entry } = read;
    const list = await cached(entry.url, (loading) => fetchList(entry.url, settings, loading));
    return await readEntry(asList(list), entry, issuerOf(credential), settings);
  } catch (error) {
    if (error instanceof ListFailure) return check("failed", `STATUS_VERIFICATION_ERROR: ${error.message}`);
    if (error instanceof ServiceError || error instanceof ListUnavailable) {
      return check("unavailable", `STATUS_RETRIEVAL_ERROR: ${error.message}`);
    }
    throw error;
  }
}
