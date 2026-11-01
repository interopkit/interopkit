import { parseWith, type Schema, strictRecord } from "@interopkit/core/checks";
import { md5 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import * as v from "valibot";
import type { IdentityObject } from "../model/index.js";
import { CLASS_SCHEMAS } from "../read/internal.js";

/** The recipient of an Open Badges 2.0 assertion: `identity` is the plain value, or a `sha256$` or `md5$` hash of it. */
export interface IdentityObjectV2 {
  /** The plain value, or the hash of it. */
  readonly identity: string;
  /** The kind of identity, such as `email`. */
  readonly type: string;
  /** Whether `identity` is a hash. */
  readonly hashed: boolean;
  /** The text appended to the value before it was hashed. */
  readonly salt?: string;
}

/** The identity that a caller knows, to be matched with the recipient of a credential. */
export interface KnownIdentity {
  /** The kind of identity: an `IdentifierType` for 3.0, such as `emailAddress`, or the type of a 2.0 assertion, such as `email`. */
  readonly type: string;
  /** The plain value, such as an email address. */
  readonly value: string;
}

const identityV2Schema: Schema<IdentityObjectV2> = strictRecord({
  identity: v.string(),
  type: v.string(),
  hashed: v.boolean(),
  salt: v.optional(v.string()),
});

const identitySchema: Schema<IdentityObject | IdentityObjectV2> = v.lazy((input) =>
  typeof input === "object" && input !== null && "identityHash" in input
    ? CLASS_SCHEMAS.identityObjectSchema
    : identityV2Schema,
);

const knownSchema: Schema<KnownIdentity> = strictRecord({ type: v.string(), value: v.string() });

/** The hash functions that an `IdentityHash` names (OB B.7). */
const HASHES = { sha256, md5 } as const;

/**
 * Returns the `IdentityHash` of an identifier: `sha256$` and the SHA-256 of the identifier followed by the salt, in lower-case
 * hexadecimal (OB B.7).
 *
 * @remarks
 * Both are encoded in UTF-8 before they are hashed. An empty salt means that the identifier is not salted. The function is
 * synchronous.
 *
 * @param value - The identifier, such as an email address.
 * @param salt - The text appended to the identifier.
 * @returns The hash, such as `sha256$b5809d8a92f8858436d7e6b87c12ebc0ae1eac4baecc2c0b913aee2c922ef399`.
 * @throws `DataError` when an argument is not a string.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#identityhash | Open Badges 3.0, IdentityHash}
 */
export function hashIdentifier(value: string, salt: string): string {
  const [checkedValue, checkedSalt] = [
    parseWith(v.string(), value, "The identifier"),
    parseWith(v.string(), salt, "The salt"),
  ];
  return hashWith("sha256", checkedValue + checkedSalt);
}

/** Hashes an identifier with the function that an `IdentityHash` names, and returns it in the form of that hash. */
function hashWith(algorithm: keyof typeof HASHES, value: string): string {
  return `${algorithm}$${bytesToHex(HASHES[algorithm](utf8ToBytes(value)))}`;
}

/**
 * Tells whether the recipient of a credential is an identity that the caller knows (OB 9.3): the kinds are the same, and the
 * known value, hashed with the salt of the recipient when it is hashed, equals what the credential holds.
 *
 * @remarks
 * A hash is compared as the algorithm it names (`sha256$` or `md5$`) and in either case of hexadecimal digits. A plain value
 * is compared as it is, so that `A@example.com` does not match `a@example.com`. A hash that names another algorithm matches
 * nothing. The function is synchronous.
 *
 * @param identity - The recipient: an `IdentityObject` of Open Badges 3.0 or CLR 2.0, or an `IdentityObjectV2` of an Open
 * Badges 2.0 assertion.
 * @param known - The identity that the caller knows: its `type` (`emailAddress` for 3.0, `email` for 2.0) and its plain `value`.
 * @returns Whether the recipient is the known identity.
 * @throws `DataError` when an argument is not an identity of one of the two forms.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#verify-the-recipient-using-an-identifier | Open Badges 3.0, 9.3}
 */
export function matchesIdentifier(identity: IdentityObject | IdentityObjectV2, known: KnownIdentity): boolean {
  const recipient = parseWith(identitySchema, identity, "The identity");
  const { type, value } = parseWith(knownSchema, known, "The known identity");
  const [kind, held, hashed, salt] =
    "identityHash" in recipient
      ? [recipient.identityType, recipient.identityHash, recipient.hashed, recipient.salt]
      : [recipient.type, recipient.identity, recipient.hashed, recipient.salt];
  if (kind !== type) return false;
  if (!hashed) return held === value;
  const [algorithm] = held.split("$", 1);
  if (algorithm !== "sha256" && algorithm !== "md5") return false;
  return hashWith(algorithm, value + (salt ?? "")).toLowerCase() === held.toLowerCase();
}
