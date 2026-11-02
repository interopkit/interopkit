import { InteropkitError } from "@interopkit/core";

/**
 * The HTTP status of the reasons whose status is not 400. An `id_token` that fails validation is 401 (Security Framework
 * 1.1 section 5.1.3); a request that is not bound to a login or a launch of this system is 403, which includes a hint that this platform did not issue or has already seen.
 */
const STATUS_OF_REASON: ReadonlyMap<string, number> = new Map([
  ["token-malformed", 401],
  ["algorithm-unsupported", 401],
  ["key-unknown", 401],
  ["signature-invalid", 401],
  ["issuer-mismatch", 401],
  ["audience-mismatch", 401],
  ["audience-untrusted", 401],
  ["authorized-party-missing", 401],
  ["authorized-party-mismatch", 401],
  ["subject-mismatch", 401],
  ["token-expired", 401],
  ["issued-in-future", 401],
  ["nonce-mismatch", 401],
  ["hint-missing", 403],
  ["hint-invalid", 403],
  ["hint-expired", 403],
  ["hint-used", 403],
  ["launch-refused", 403],
  ["client-mismatch", 403],
  ["login-hint-mismatch", 403],
  ["state-unknown", 403],
  ["state-expired", 403],
  ["state-reused", 403],
  ["state-cookie", 403],
  ["deployment-mismatch", 403],
  ["origin-mismatch", 403],
  ["storage-mismatch", 403],
]);

/**
 * The error for an LTI message that fails a check of the specifications: a launch that breaks a rule of the Security
 * Framework, a claim that is missing, a registration that is unknown, or a scope that the platform did not grant.
 */
export class LtiError extends InteropkitError {
  /** Error class name. */
  override name = "LtiError";
  /** A kebab-case code that names the failed check, such as `nonce-reused`. */
  readonly reason: string;
  /**
   * The HTTP status that a host answers with: 401 when a token fails validation, 403 when the request is not bound to a
   * login or a launch of this system, and 400 when the sender broke the protocol in another way.
   */
  readonly status: number;

  /**
   * @param message - Says what failed and what is expected.
   * @param reason - A kebab-case code that names the failed check.
   */
  constructor(message: string, reason: string) {
    super(message);
    this.reason = reason;
    this.status = STATUS_OF_REASON.get(reason) ?? 400;
  }
}
