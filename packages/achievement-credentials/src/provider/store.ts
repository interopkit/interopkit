import type { CallOptions } from "@interopkit/core";
import { guardSchema, isRecord, methodsSchema, nonNegativeIntegerSchema, strictRecord } from "@interopkit/core/checks";
import type { OffsetPage } from "@interopkit/core/http";
import * as v from "valibot";
import type { AnyVerifiableCredential, Profile } from "../model/index.js";
import { jws } from "../read/internal.js";

/** The page of a user's credentials that a request for the list asks for. */
export interface CredentialsPage extends OffsetPage {
  /**
   * Only the credentials issued after this time: a date and time of RFC 3339 with an offset, as the request wrote it.
   *
   * @defaultValue none: every credential
   */
  readonly since?: string;
}

/** A page of a user's credentials, as the store keeps them, and how many there are when the store can count them. */
export interface CredentialList {
  /** The credentials of the page, at most the limit: a credential as a JSON object, and one signed as a VC-JWT as its compact JWS. */
  readonly credentials: readonly (string | Readonly<Record<string, unknown>>)[];
  /**
   * The number of the user's credentials that match, whatever the page.
   *
   * @defaultValue none: the store cannot count them, and the answer has no `X-Total-Count` (OB 6.4)
   */
  readonly total?: number;
}

/** A credential that a request carried, as it came and as the model reads it. */
export interface ReceivedCredential {
  /**
   * The credential as the request carried it: its compact JWS, or its JSON object as parsed. The store keeps it and lists it as
   * it is, so that a proof still verifies.
   */
  readonly received: string | Readonly<Record<string, unknown>>;
  /**
   * The credential in the model: the JSON object or the payload of the JWS, read with `readCredential`. It is what
   * `sameCredential` and `newerCredential` compare.
   */
  readonly credential: AnyVerifiableCredential;
}

/** What `CredentialStore.upsert` did: stored a new credential, replaced an equal one, or kept the one it held. */
export type UpsertOutcome = "created" | "replaced" | "unchanged";

/**
 * Where a provider keeps the credentials of each user.
 *
 * @remarks
 * A method may be called again and from several requests at once. It rejects when it fails, and the provider answers 500 and
 * passes nothing of the failure on. Every method receives the `signal` of the provider, and ends its work when it aborts. The
 * owner is what `authorize` names for the access token of the request.
 */
export interface CredentialStore {
  /** Returns a page of the owner's credentials, in an order that holds from one page to the next. */
  list(owner: string, page: CredentialsPage, options?: CallOptions): Promise<CredentialList>;
  /**
   * Stores a credential of the owner, or replaces the one it holds that is the same credential (OB 10: the same `id` and
   * issuer), atomically, and says which happened.
   *
   * @remarks
   * `sameCredential` finds the credential the store holds. `"replaced"` is for a credential that `newerCredential` finds newer
   * than the one held, and `"unchanged"` keeps the one held. The provider has checked the credential before the call.
   */
  upsert(owner: string, credential: ReceivedCredential, options?: CallOptions): Promise<UpsertOutcome>;
}

/**
 * Where a provider keeps the profile of each user.
 *
 * @remarks
 * The methods fail, abort and may be called again as those of `CredentialStore`.
 */
export interface ProfileStore {
  /** Returns the owner's profile, or `undefined` when there is none. */
  get(owner: string, options?: CallOptions): Promise<Profile | undefined>;
  /**
   * Replaces the owner's profile with the whole profile of the request, and returns the profile that it publishes, which may not
   * hold the new values yet (OB 6.2.5). A repeat is safe.
   */
  put(owner: string, profile: Profile, options?: CallOptions): Promise<Profile>;
}

/** The outcomes of an upsert, in the order of their statuses: 201, 200, 304. */
export const UPSERT_OUTCOMES = ["created", "replaced", "unchanged"] as const satisfies readonly UpsertOutcome[];

/** The schema of a store of credentials: an object with both methods, which passes on whole so that a class keeps them. */
export const credentialStoreSchema = methodsSchema<CredentialStore>("list", "upsert");

/** The schema of a store of profiles. */
export const profileStoreSchema = methodsSchema<ProfileStore>("get", "put");

// What a port promises is checked for its shape, and the store is trusted with the rest: what it lists it was given checked.
const objectOf = <TObject extends object>() => guardSchema((value): value is TObject => isRecord(value), "an object");

/** What `list` answers: the credentials of the page, each a compact JWS or an object, and the count when there is one. */
export const listSchema = strictRecord({
  credentials: v.array(v.union([jws, objectOf<Readonly<Record<string, unknown>>>()])),
  total: v.optional(nonNegativeIntegerSchema),
});

/** What `get` answers: a profile, or `undefined`. */
export const foundProfileSchema = v.optional(objectOf<Profile>());

/** What `put` answers: the profile. */
export const profileSchema = objectOf<Profile>();
