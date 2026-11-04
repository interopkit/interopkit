import { type CallOptions, type Clock, SYSTEM_CLOCK } from "@interopkit/core";
import { parseWith, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { DEFAULT_MAX_JSON_LD_TOKENS } from "../json-text.js";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "../model/index.js";
import { readTrustSettings, type TrustSettings } from "../option-checks.js";
import { optionsOf, REQUIRED_OPTIONS } from "../option-schemas.js";

/** A cryptosuite that `addProof` signs with: `eddsa-rdfc-2022` or `ecdsa-sd-2023`. */
export type SigningCryptosuite = "eddsa-rdfc-2022" | "ecdsa-sd-2023";

/** The cryptosuites that `addProof` signs with. */
const SIGNING_CRYPTOSUITES = ["eddsa-rdfc-2022", "ecdsa-sd-2023"] as const satisfies readonly SigningCryptosuite[];

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

/** The options of a signature, checked. */
export interface ProofSettings {
  readonly cryptosuite: SigningCryptosuite;
  readonly mandatoryPointers: readonly string[] | undefined;
  readonly contexts: ContextLoader;
  readonly clock: Clock;
  readonly maxJsonLdTokens: number;
  readonly signal: AbortSignal | undefined;
}

/** A list of JSON Pointers: each is empty or starts with `/` (RFC 6901). */
const pointersSchema = v.array(
  v.pipe(
    v.string(),
    v.check(
      (pointer) => pointer === "" || pointer.startsWith("/"),
      "expected a JSON Pointer, which is empty or starts with /",
    ),
  ),
);

const proofOptionsSchema = strictRecord({
  cryptosuite: v.optional(v.picklist(SIGNING_CRYPTOSUITES)),
  mandatoryPointers: v.optional(pointersSchema),
  contexts: REQUIRED_OPTIONS.contexts,
  ...optionsOf("clock", "maxJsonLdTokens", "signal"),
});

/** Checks the options of `addProof` as a host passes them from JavaScript. */
export function proofSettings(options: unknown): ProofSettings {
  const read = parseWith(proofOptionsSchema, options, "The options of addProof");
  return {
    cryptosuite: read.cryptosuite ?? "eddsa-rdfc-2022",
    mandatoryPointers: read.mandatoryPointers,
    contexts: read.contexts,
    clock: read.clock ?? SYSTEM_CLOCK,
    maxJsonLdTokens: read.maxJsonLdTokens ?? DEFAULT_MAX_JSON_LD_TOKENS,
    signal: read.signal,
  };
}

/** The options of a disclosure, checked. */
export interface DisclosureSettings {
  readonly selectivePointers: readonly string[];
  readonly contexts: ContextLoader;
  readonly maxJsonLdTokens: number;
  readonly signal: AbortSignal | undefined;
}

const disclosureOptionsSchema = strictRecord({
  selectivePointers: pointersSchema,
  contexts: REQUIRED_OPTIONS.contexts,
  ...optionsOf("maxJsonLdTokens", "signal"),
});

/** Checks the options of `deriveDisclosure` as a host passes them from JavaScript. */
export function disclosureSettings(options: unknown): DisclosureSettings {
  const read = parseWith(disclosureOptionsSchema, options, "The options of deriveDisclosure");
  return {
    selectivePointers: read.selectivePointers,
    contexts: read.contexts,
    maxJsonLdTokens: read.maxJsonLdTokens ?? DEFAULT_MAX_JSON_LD_TOKENS,
    signal: read.signal,
  };
}

/** The settings of a verification of a proof: those of every verification, with the loader of contexts that it needs. */
export type ProofCheckSettings = TrustSettings & { readonly contexts: ContextLoader };

const verifyOptionsSchema = strictRecord({
  keys: REQUIRED_OPTIONS.keys,
  contexts: REQUIRED_OPTIONS.contexts,
  ...optionsOf(
    "clock",
    "clockSkewSeconds",
    "allowUnboundKeys",
    "legacyProofs",
    "suites",
    "maxInputBytes",
    "maxDepth",
    "maxTokens",
    "maxJsonLdTokens",
    "signal",
  ),
});

/** Checks the options of `verifyProof` as a host passes them from JavaScript, and fills in the defaults. */
export function verifySettings(options: unknown): ProofCheckSettings {
  const read = parseWith(verifyOptionsSchema, options, "The options of verifyProof");
  return { ...readTrustSettings(read), contexts: read.contexts };
}
