import type { CallOptions, Clock, Fetch } from "@interopkit/core";
import {
  nonEmptyStringSchema,
  parseWith,
  positiveIntegerSchema,
  type Schema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type { KnownIdentity } from "../issue/index.js";
import type { ContextLoader, DataIntegritySuite, KeyResolver } from "../model/index.js";
import type { StatusListCache } from "../status/index.js";
import { readStatusSettings, type StatusSettings, statusOptionEntries } from "../status/internal.js";

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
  /**
   * Gives the time that validity is judged at.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * Returns the JSON-LD contexts. A Data Integrity proof is checked through it and only it.
   *
   * @defaultValue none: a Data Integrity proof is `unavailable`
   */
  readonly contexts?: ContextLoader;
  /**
   * The `fetch` for status lists, refresh services and schemas that the credential names, and the documents of an Open Badges
   * 2.0 badge. One for addresses that counterparties choose refuses loopback, private and link-local addresses.
   *
   * @defaultValue none: those checks are `unavailable`, and a 2.0 badge cannot be verified
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
   * Whether a status list, a refresh or a schema that cannot be read fails the verification. A proof that cannot be checked,
   * and an issuer whose keys cannot be read, always fail it: a key that is not tied to the issuer proves nothing.
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
   * The algorithms that may sign a credential as a JWT, or an Open Badges 2.0 assertion as a JWS.
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
   * The most characters of the input, of each credential that it holds in a compact JWS, and of each status list credential.
   *
   * @defaultValue `1048576`
   */
  readonly maxInputBytes?: number;
  /**
   * The most levels that the JSON of the input nests, and of each status list credential, revocation list, schema and
   * document of an Open Badges 2.0 badge.
   *
   * @defaultValue `64`
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of JSON in the input, and in each status list credential, revocation list, schema and document of an Open
   * Badges 2.0 badge: the memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue `1000000`
   */
  readonly maxTokens?: number;
  /**
   * The most tokens of JSON in a credential or a status list credential with a Data Integrity proof, which a JSON-LD processor
   * reads to check it. The work of a processor grows with the square of the values of one property, which `maxTokens` does not bound. A credential over it
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

/** The most endorsements of one credential unless the host says otherwise. */
const DEFAULT_MAX_ENDORSEMENTS = 32;
/** The most credentials of one CLR unless the host says otherwise. */
const DEFAULT_MAX_NESTED_CREDENTIALS = 1000;

/** The options of a verification, checked and with their defaults: those of a status check, and those of `verifyCredential`. */
export interface VerifySettings extends StatusSettings {
  readonly recipient: KnownRecipient | undefined;
  readonly refresh: boolean;
  readonly unavailable: "fail" | "warn";
  readonly maxEndorsements: number;
  readonly maxNestedCredentials: number;
}

const recipientSchema: Schema<KnownRecipient> = v.pipe(
  strictRecord({
    id: v.optional(nonEmptyStringSchema),
    identifier: v.optional(strictRecord({ type: nonEmptyStringSchema, value: nonEmptyStringSchema })),
  }),
  v.check(({ id, identifier }) => id !== undefined || identifier !== undefined, "expected an id or an identifier"),
);

const optionsSchema = strictRecord({
  ...statusOptionEntries,
  recipient: v.optional(recipientSchema),
  refresh: v.optional(v.boolean()),
  unavailable: v.optional(v.picklist(["fail", "warn"])),
  maxEndorsements: v.optional(positiveIntegerSchema),
  maxNestedCredentials: v.optional(positiveIntegerSchema),
});

/** Checks the options of `verifyCredential` as a host passes them from JavaScript, and fills in the defaults. */
export function verifySettings(options: unknown): VerifySettings {
  const read = parseWith(optionsSchema, options, "The options of verifyCredential");
  return {
    ...readStatusSettings(read),
    recipient: read.recipient,
    refresh: read.refresh ?? true,
    unavailable: read.unavailable ?? "fail",
    maxEndorsements: read.maxEndorsements ?? DEFAULT_MAX_ENDORSEMENTS,
    maxNestedCredentials: read.maxNestedCredentials ?? DEFAULT_MAX_NESTED_CREDENTIALS,
  };
}
