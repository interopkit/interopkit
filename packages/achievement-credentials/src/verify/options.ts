import { type CallOptions, type Clock, DataError, type Fetch, ServiceError } from "@interopkit/core";
import {
  checkArray,
  checkFunction,
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  describe,
  isRecord,
  methodsSchema,
  parseWith,
} from "@interopkit/core/checks";
import type { KnownIdentity } from "../issue/index.js";
import { DEFAULT_MAX_JSON_LD_TOKENS } from "../json-text.js";
import { type ReadSettings, readSettings } from "../jwt/internal.js";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "../model/index.js";
import { checkFlag } from "../option-checks.js";
import type { StatusListCache } from "../status/index.js";

/** The recipient that a verifier knows, to be matched with the subject of a credential. */
export interface KnownRecipient {
  /** The `id` of the subject: a DID or an address. */
  readonly id?: string;
  /** An identifier of the subject: its type, such as `emailAddress`, and the plain value. */
  readonly identifier?: KnownIdentity;
}

/** The options of `verifyCredential`. */
export interface VerifyOptions extends CallOptions {
  /** Resolves the keys that verify proofs and reads what issuers publish. */
  readonly keys: KeyResolver;
  /** Gives the time that validity is judged at. */
  readonly clock: Clock;
  /**
   * Returns the JSON-LD contexts. A Data Integrity proof is checked through it and only it.
   *
   * @defaultValue none: a Data Integrity proof is `unavailable`
   */
  readonly contexts?: ContextLoader;
  /**
   * The `fetch` for status lists, refresh services and schemas that the credential names.
   *
   * @defaultValue none: those checks are `unavailable`
   */
  readonly fetch?: Fetch;
  /**
   * Keeps status list credentials across verifications, until their `ttl` or `validUntil`.
   *
   * @defaultValue none: a list is fetched once for each call
   */
  readonly statusLists?: StatusListCache;
  /**
   * Issuers other than a credential's that may publish its status list.
   *
   * @defaultValue none
   */
  readonly statusIssuers?: readonly string[];
  /**
   * The recipient that the verifier knows: the subject of the credential must be it. The check is of the credential that is
   * verified, not of the credentials that a CLR holds.
   *
   * @defaultValue none: the check is `skipped`
   */
  readonly recipient?: KnownRecipient;
  /**
   * Whether to follow the refresh service of a credential, once, after its proof.
   *
   * @defaultValue `true`
   */
  readonly refresh?: boolean;
  /**
   * Whether a status list, a refresh or a schema that cannot be read, or an issuer whose keys cannot be read, fails the
   * verification. A proof that cannot be checked always fails it.
   *
   * @defaultValue `"fail"`
   */
  readonly unavailable?: "fail" | "warn";
  /**
   * Accepts keys that the issuer does not publish. The result says that the issuer check was skipped.
   *
   * @defaultValue `false`
   */
  readonly allowUnboundKeys?: boolean;
  /**
   * Accepts `Ed25519Signature2020` proofs.
   *
   * @defaultValue `false`
   */
  readonly legacyProofs?: boolean;
  /**
   * The algorithms that may sign a credential as a JWT.
   *
   * @defaultValue `["RS256", "RS384", "RS512", "ES256", "ES384", "EdDSA"]`
   */
  readonly algorithms?: readonly string[];
  /**
   * The seconds that a time claim, a validity period and a proof's expiry may be off.
   *
   * @defaultValue `60`
   */
  readonly clockSkewSeconds?: number;
  /**
   * The most endorsements that one credential may have: a credential with more is `format` `failed`.
   *
   * @defaultValue `32`
   */
  readonly maxEndorsements?: number;
  /**
   * The most credentials that one CLR may hold: a CLR with more is `format` `failed`.
   *
   * @defaultValue `1000`
   */
  readonly maxNestedCredentials?: number;
  /**
   * The most characters of the input and of each credential that it holds in a compact JWS.
   *
   * @defaultValue `1048576`
   */
  readonly maxInputBytes?: number;
  /**
   * The most levels that the JSON of the input nests.
   *
   * @defaultValue `64`
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of JSON in the input: the memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
  /**
   * The most tokens of JSON in a credential with a Data Integrity proof, which a JSON-LD processor reads to check it. The work
   * of a processor grows with the square of the values of one property, which `maxTokens` does not bound. A credential over it
   * has a `proof` that failed, and says so. A CLR that holds many credentials as objects can need more.
   *
   * @defaultValue `20000`
   */
  readonly maxJsonLdTokens?: number;
  /**
   * The time that each fetch may take, in milliseconds.
   *
   * @defaultValue `10000`
   */
  readonly timeoutMs?: number;
  /**
   * The most bytes of each fetch.
   *
   * @defaultValue `1048576`
   */
  readonly maxBytes?: number;
  /**
   * More Data Integrity suites, beside the built-in `eddsa-rdfc-2022`, `ecdsa-rdfc-2019` and `ecdsa-sd-2023`.
   *
   * @defaultValue none
   */
  readonly suites?: readonly DataIntegritySuite[];
}

const DEFAULT_MAX_ENDORSEMENTS = 32;
const DEFAULT_MAX_NESTED_CREDENTIALS = 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_048_576;

const suiteSchema = methodsSchema<DataIntegritySuite>("verify");

/** A `fetch` that fetches nothing, for a verification that was given none: each use is a service that did not answer. */
const NO_FETCH: Fetch = () => Promise.reject(new ServiceError("No fetch was given to verify with.", 0, ""));

/** The options of a verification, checked and with their defaults. */
export interface VerifySettings {
  /** The options of reading a JWS, which also hold the keys, the clock, the algorithms, the skew and the limits of the input. */
  readonly jwt: ReadSettings;
  readonly contexts: ContextLoader | undefined;
  /** The `fetch` of the host, or undefined. */
  readonly fetch: Fetch | undefined;
  readonly statusLists: StatusListCache | undefined;
  readonly statusIssuers: readonly string[];
  readonly recipient: KnownRecipient | undefined;
  readonly refresh: boolean;
  readonly unavailable: "fail" | "warn";
  readonly legacyProofs: boolean;
  readonly suites: readonly DataIntegritySuite[];
  readonly maxJsonLdTokens: number;
  readonly maxEndorsements: number;
  readonly maxNestedCredentials: number;
  readonly timeoutMs: number;
  readonly maxBytes: number;
}

/** Returns what to pass as `fetch` to a function that needs one: the host's, or one that says that none was given. */
export function fetchOf(settings: VerifySettings): Fetch {
  return settings.fetch ?? NO_FETCH;
}

/** Checks the known recipient as a host passes it from JavaScript. */
function checkRecipient(recipient: unknown): KnownRecipient {
  checkRecord(recipient, "The option recipient must be an object");
  const { id, identifier } = recipient;
  if (id === undefined && identifier === undefined) {
    throw new DataError("The option recipient must have an id or an identifier.");
  }
  if (id !== undefined) checkNonEmptyString(id, "The id of the option recipient");
  if (identifier !== undefined) {
    checkRecord(identifier, "The identifier of the option recipient must be an object");
    checkNonEmptyString(identifier.type, "The type of the identifier of the option recipient");
    checkNonEmptyString(identifier.value, "The value of the identifier of the option recipient");
  }
  return {
    ...(typeof id === "string" ? { id } : {}),
    ...(isRecord(identifier) ? { identifier: { type: String(identifier.type), value: String(identifier.value) } } : {}),
  };
}

/** Checks the options of `verifyCredential` as a host passes them from JavaScript, and fills in the defaults. */
export function verifySettings(options: unknown): VerifySettings {
  checkRecord(options, "The options of verifyCredential must be an object");
  // The keys, the clock, the algorithms, the skew, the limits of the input and the signal are those of reading a JWS.
  const jwt = readSettings(options);
  const { contexts, fetch, statusLists, statusIssuers = [], recipient, suites = [] } = options;
  const { refresh = true, unavailable = "fail", legacyProofs = false } = options;
  const { maxEndorsements = DEFAULT_MAX_ENDORSEMENTS, maxNestedCredentials = DEFAULT_MAX_NESTED_CREDENTIALS } = options;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = DEFAULT_MAX_BYTES } = options;
  const { maxJsonLdTokens = DEFAULT_MAX_JSON_LD_TOKENS } = options;
  if (contexts !== undefined) checkFunction(contexts, "The option contexts must be a function");
  if (fetch !== undefined) checkFunction(fetch, "The option fetch must be a function");
  if (statusLists !== undefined) {
    checkRecord(statusLists, "The option statusLists must be an object");
    checkFunction(statusLists.get, "The function get of the option statusLists must be a function");
  }
  checkArray(statusIssuers, "The option statusIssuers must be an array");
  for (const issuer of statusIssuers) checkNonEmptyString(issuer, "An issuer of the option statusIssuers");
  checkFlag(refresh, "The option refresh");
  checkFlag(legacyProofs, "The option legacyProofs");
  if (unavailable !== "fail" && unavailable !== "warn") {
    throw new DataError(`The option unavailable must be "fail" or "warn", found ${describe(unavailable)}.`);
  }
  checkPositiveInteger(maxJsonLdTokens, "The option maxJsonLdTokens");
  checkPositiveInteger(maxEndorsements, "The option maxEndorsements");
  checkPositiveInteger(maxNestedCredentials, "The option maxNestedCredentials");
  checkPositiveInteger(timeoutMs, "The option timeoutMs");
  checkPositiveInteger(maxBytes, "The option maxBytes");
  checkArray(suites, "The option suites must be an array");
  const checkedSuites = suites.map((suite, index) => {
    const read = parseWith(suiteSchema, suite, `The option suites[${index}]`);
    if (typeof read.cryptosuite !== "string" || read.cryptosuite === "") {
      throw new DataError(`The option suites[${index}] must name its cryptosuite.`);
    }
    return read;
  });
  return {
    jwt,
    contexts: contexts as ContextLoader | undefined,
    fetch: fetch as Fetch | undefined,
    statusLists: statusLists as StatusListCache | undefined,
    statusIssuers: statusIssuers as readonly string[],
    recipient: recipient === undefined ? undefined : checkRecipient(recipient),
    refresh,
    unavailable,
    legacyProofs,
    suites: checkedSuites,
    maxJsonLdTokens,
    maxEndorsements,
    maxNestedCredentials,
    timeoutMs,
    maxBytes,
  };
}
