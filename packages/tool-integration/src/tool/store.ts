import type { CallOptions } from "@interopkit/core";
import {
  httpsUrlSchema,
  looseRecord,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  parseWith,
} from "@interopkit/core/checks";
import * as v from "valibot";

/** What the tool remembers of a login between the authentication request and the launch. */
export interface LoginRecord {
  /** The `nonce` of the authentication request, which the `id_token` must carry. */
  readonly nonce: string;
  /** The issuer of the platform that started the login. */
  readonly issuer: string;
  /** The client identifier of the tool at that platform. */
  readonly clientId: string;
  /**
   * The `lti_deployment_id` of the initiation, which the launch must carry (LTI 1.3 Core section 4.1.2).
   *
   * @defaultValue none, when the platform did not name the deployment
   */
  readonly deploymentId?: string;
  /** The `target_link_uri` of the initiation, which the launch must carry (LTI 1.3 Core section 5.3.4). */
  readonly targetLinkUri: string;
  /** The `lti_storage_target` of the initiation, absent when the state lives in a cookie. */
  readonly storageTarget?: string;
  /** The time in milliseconds since 1970-01-01T00:00:00Z at which the login stops being valid. */
  readonly expiresAt: number;
}

/**
 * The host's record of the logins in progress, by `state`. It keeps the `nonce` single-use: a login completes once.
 * Records past `expiresAt` may be deleted.
 */
export interface LtiStore {
  /** Saves the record of a new login under its `state`. It rejects only when it saved nothing. */
  put(state: string, record: LoginRecord, options?: CallOptions): Promise<void>;
  /** Returns the record saved under a `state`, or `undefined` when there is none. */
  get(state: string, options?: CallOptions): Promise<LoginRecord | undefined>;
  /** Deletes the record under a `state` and returns whether there was one. A concurrent second call returns `false`. */
  delete(state: string, options?: CallOptions): Promise<boolean>;
}

const loginRecordSchema = looseRecord({
  nonce: nonEmptyStringSchema,
  issuer: nonEmptyStringSchema,
  clientId: nonEmptyStringSchema,
  deploymentId: v.optional(nonEmptyStringSchema),
  targetLinkUri: httpsUrlSchema,
  storageTarget: v.optional(nonEmptyStringSchema),
  expiresAt: nonNegativeIntegerSchema,
});

/**
 * Checks a record that the store returned, because the store is the host's code.
 *
 * @throws `DataError` when it is not a login record.
 */
export function checkLoginRecord(value: unknown): asserts value is LoginRecord {
  parseWith(loginRecordSchema, value, "The login record");
}
