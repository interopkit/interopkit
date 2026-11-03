import { type CallOptions, type Clock, checkClock, DataError, SYSTEM_CLOCK } from "@interopkit/core";
import {
  checkAbortSignal,
  checkArray,
  checkFunction,
  checkNonNegativeInteger,
  checkPositiveInteger,
  checkRecord,
  describe,
  MAX_JSON_DEPTH,
  MAX_JSON_TOKENS,
  parseWith,
} from "@interopkit/core/checks";
import { DEFAULT_MAX_JSON_LD_TOKENS } from "../json-text.js";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "../model/index.js";
import { checkFlag, keyResolverSchema, readSuites } from "../option-checks.js";

/** A cryptosuite that `addProof` signs with: `eddsa-rdfc-2022` or `ecdsa-sd-2023`. */
export type SigningCryptosuite = "eddsa-rdfc-2022" | "ecdsa-sd-2023";

/** The cryptosuites that `addProof` signs with. */
const SIGNING_CRYPTOSUITES: readonly SigningCryptosuite[] = ["eddsa-rdfc-2022", "ecdsa-sd-2023"];

/** The options of `addProof`. */
export interface ProofOptions extends CallOptions {
  /**
   * The cryptosuite: `eddsa-rdfc-2022` signs with Ed25519, and `ecdsa-sd-2023` writes a base proof with P-256 that a holder
   * derives disclosures from.
   *
   * @defaultValue `"eddsa-rdfc-2022"`
   */
  readonly cryptosuite?: SigningCryptosuite;
  /**
   * For `ecdsa-sd-2023`: the JSON Pointers to what a holder can never hide.
   *
   * @defaultValue the pointers of every property that the model of the credential requires and the credential holds, so that
   * a disclosure stays a valid credential (Open Badges conformance 3.1.1)
   */
  readonly mandatoryPointers?: readonly string[];
  /** Returns the contexts of the credential and of the proof. */
  readonly contexts: ContextLoader;
  /**
   * Gives the time that the proof's `created` is written from.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * The most tokens of JSON in the credential that a JSON-LD processor reads. The work of a processor grows with the square of
   * the values of one property, which `maxTokens` does not bound: 20,000 values of one property take about four seconds. A
   * CLR that holds many credentials as objects can need more.
   *
   * @defaultValue `20000`
   */
  readonly maxJsonLdTokens?: number;
}

/** The options of `deriveDisclosure`. */
export interface DisclosureOptions extends CallOptions {
  /** The JSON Pointers to what the holder reveals, beyond what the issuer made mandatory. */
  readonly selectivePointers: readonly string[];
  /** Returns the contexts of the credential and of the proof. */
  readonly contexts: ContextLoader;
  /**
   * The most tokens of JSON in the credential that a JSON-LD processor reads. The work of a processor grows with the square of
   * the values of one property, which `maxTokens` does not bound: 20,000 values of one property take about four seconds. A
   * CLR that holds many credentials as objects can need more.
   *
   * @defaultValue `20000`
   */
  readonly maxJsonLdTokens?: number;
}

/** The options of `verifyProof`. */
export interface DataIntegrityVerifyOptions extends CallOptions {
  /** Resolves the key that the proof names and reads what the issuer publishes. */
  readonly keys: KeyResolver;
  /**
   * Gives the time that the `expires` of a proof is compared with.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /** Returns the contexts of the credential and of the proof. */
  readonly contexts: ContextLoader;
  /**
   * The seconds by which `expires` may differ from the clock.
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
   * Accept `Ed25519Signature2020` proofs, which Open Badges 3.0.0 to 3.0.2 used.
   *
   * @defaultValue `false`
   */
  readonly legacyProofs?: boolean;
  /**
   * More cryptosuites, beside the built-in `eddsa-rdfc-2022`, `ecdsa-rdfc-2019` and `ecdsa-sd-2023`.
   *
   * @defaultValue none
   */
  readonly suites?: readonly DataIntegritySuite[];
  /**
   * The most characters of the credential as JSON. A suite that counts bytes is given the same number.
   *
   * @defaultValue `1048576`
   */
  readonly maxInputBytes?: number;
  /**
   * The most levels that the credential nests.
   *
   * @defaultValue `64`
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of JSON in the credential: the memory of a read grows with the tokens and not with the bytes.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
  /**
   * The most tokens of JSON in the credential that a JSON-LD processor reads. The work of a processor grows with the square of
   * the values of one property, which `maxTokens` does not bound: 20,000 values of one property take about four seconds. A
   * CLR that holds many credentials as objects can need more.
   *
   * @defaultValue `20000`
   */
  readonly maxJsonLdTokens?: number;
}

/** The seconds by which the time of a proof may differ from the clock of the verifier. */
const DEFAULT_CLOCK_SKEW_SECONDS = 60;

/** The most bytes of a credential as JSON unless the host says otherwise. */
const DEFAULT_MAX_INPUT_BYTES = 1_048_576;

/** The options of a signature, checked. */
export interface ProofSettings {
  readonly cryptosuite: SigningCryptosuite;
  readonly mandatoryPointers: readonly string[] | undefined;
  readonly contexts: ContextLoader;
  readonly clock: Clock;
  readonly maxJsonLdTokens: number;
  readonly signal: AbortSignal | undefined;
}

/** Checks the options of `addProof` as a host passes them from JavaScript. */
export function proofSettings(options: unknown): ProofSettings {
  checkRecord(options, "The options of addProof must be an object");
  const { cryptosuite = "eddsa-rdfc-2022", mandatoryPointers, contexts, clock, signal } = options;
  const { maxJsonLdTokens = DEFAULT_MAX_JSON_LD_TOKENS } = options;
  if (!SIGNING_CRYPTOSUITES.find((name) => name === cryptosuite)) {
    throw new DataError(
      `The option cryptosuite must be ${SIGNING_CRYPTOSUITES.join(" or ")}, found ${describe(cryptosuite)}.`,
    );
  }
  if (mandatoryPointers !== undefined) checkPointers(mandatoryPointers, "The option mandatoryPointers");
  checkFunction(contexts, "The option contexts must be a function");
  checkClock(clock);
  checkPositiveInteger(maxJsonLdTokens, "The option maxJsonLdTokens");
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  return {
    cryptosuite: cryptosuite as SigningCryptosuite,
    mandatoryPointers: mandatoryPointers as readonly string[] | undefined,
    contexts: contexts as ContextLoader,
    clock: clock ?? SYSTEM_CLOCK,
    maxJsonLdTokens,
    signal,
  };
}

/** Checks a list of JSON Pointers. */
function checkPointers(value: unknown, label: string): asserts value is readonly string[] {
  checkArray(value, `${label} must be an array`);
  for (const pointer of value) {
    if (typeof pointer !== "string" || !(pointer === "" || pointer.startsWith("/"))) {
      throw new DataError(
        `${label} must list JSON Pointers, which are empty or start with /, found ${describe(pointer)}.`,
      );
    }
  }
}

/** The options of a disclosure, checked. */
export interface DisclosureSettings {
  readonly selectivePointers: readonly string[];
  readonly contexts: ContextLoader;
  readonly maxJsonLdTokens: number;
  readonly signal: AbortSignal | undefined;
}

/** Checks the options of `deriveDisclosure` as a host passes them from JavaScript. */
export function disclosureSettings(options: unknown): DisclosureSettings {
  checkRecord(options, "The options of deriveDisclosure must be an object");
  const { selectivePointers, contexts, signal, maxJsonLdTokens = DEFAULT_MAX_JSON_LD_TOKENS } = options;
  checkPointers(selectivePointers, "The option selectivePointers");
  checkFunction(contexts, "The option contexts must be a function");
  checkPositiveInteger(maxJsonLdTokens, "The option maxJsonLdTokens");
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  return { selectivePointers, contexts: contexts as ContextLoader, maxJsonLdTokens, signal };
}

/** The options of a verification, checked and with their defaults. */
export interface VerifySettings {
  readonly keys: KeyResolver;
  readonly clock: Clock;
  readonly contexts: ContextLoader;
  readonly clockSkewSeconds: number;
  readonly allowUnboundKeys: boolean;
  readonly legacyProofs: boolean;
  readonly suites: readonly DataIntegritySuite[];
  readonly maxInputBytes: number;
  readonly maxDepth: number;
  readonly maxTokens: number;
  readonly maxJsonLdTokens: number;
  readonly signal: AbortSignal | undefined;
}

/** Checks the options of `verifyProof` as a host passes them from JavaScript, and fills in the defaults. */
export function verifySettings(options: unknown): VerifySettings {
  checkRecord(options, "The options of verifyProof must be an object");
  const keys = parseWith(keyResolverSchema, options.keys, "The option keys");
  const { clock, contexts, signal, suites = [] } = options;
  checkClock(clock);
  checkFunction(contexts, "The option contexts must be a function");
  const { clockSkewSeconds = DEFAULT_CLOCK_SKEW_SECONDS, allowUnboundKeys = false, legacyProofs = false } = options;
  const { maxInputBytes = DEFAULT_MAX_INPUT_BYTES, maxDepth = MAX_JSON_DEPTH, maxTokens = MAX_JSON_TOKENS } = options;
  const { maxJsonLdTokens = DEFAULT_MAX_JSON_LD_TOKENS } = options;
  checkNonNegativeInteger(clockSkewSeconds, "The option clockSkewSeconds");
  checkPositiveInteger(maxInputBytes, "The option maxInputBytes");
  checkPositiveInteger(maxDepth, "The option maxDepth");
  checkPositiveInteger(maxTokens, "The option maxTokens");
  checkPositiveInteger(maxJsonLdTokens, "The option maxJsonLdTokens");
  checkFlag(allowUnboundKeys, "The option allowUnboundKeys");
  checkFlag(legacyProofs, "The option legacyProofs");
  const checked = readSuites(suites);
  if (signal !== undefined) checkAbortSignal(signal, "The option signal");
  return {
    keys,
    clock: clock ?? SYSTEM_CLOCK,
    contexts: contexts as ContextLoader,
    clockSkewSeconds,
    allowUnboundKeys,
    legacyProofs,
    suites: checked,
    maxInputBytes,
    maxDepth,
    maxTokens,
    maxJsonLdTokens,
    signal,
  };
}
