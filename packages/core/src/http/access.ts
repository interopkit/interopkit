import * as v from "valibot";
import { nonNegativeIntegerSchema, parseWith, type Schema } from "../checks.js";

/**
 * The reasons for which a host refuses a request, each with the HTTP status that a handler answers it with: the request is not
 * authenticated (401), it is not allowed (403), or the client asks too often (429).
 */
export const ACCESS_REFUSAL_STATUSES = {
  /** The request is not authenticated: 401. */
  unauthenticated: 401,
  /** The request is not allowed: 403. */
  forbidden: 403,
  /** The client asks too often: 429. */
  "too-many-requests": 429,
} as const;

/** Why a host refuses a request: `unauthenticated`, `forbidden` or `too-many-requests`, a key of `ACCESS_REFUSAL_STATUSES`. */
export type AccessRefusalReason = keyof typeof ACCESS_REFUSAL_STATUSES;

/** The reasons, for the schema of a decision. */
const ACCESS_REFUSAL_REASONS = [
  "unauthenticated",
  "forbidden",
  "too-many-requests",
] as const satisfies readonly AccessRefusalReason[];

/** A host's refusal of a request: not authenticated, not allowed, or one request too many. */
export interface AccessRefusal {
  /** The request is refused. */
  readonly allowed: false;
  /** Why, which sets the status of the answer: 401 for `unauthenticated`, 403 for `forbidden`, 429 for `too-many-requests`. */
  readonly reason: AccessRefusalReason;
  /**
   * Says why, as a sentence, which the handler sends as the message of its answer.
   *
   * @defaultValue none: the handler's sentence for the reason
   */
  readonly message?: string;
  /**
   * The `WWW-Authenticate` header of an `unauthenticated` refusal, such as `Basic realm="xAPI"` or `Bearer error="invalid_token"`.
   *
   * @defaultValue none: the handler's challenge, or no header where its protocol names none
   */
  readonly challenge?: string;
  /**
   * The seconds that a client refused for `too-many-requests` should wait, sent as `Retry-After`.
   *
   * @defaultValue none: no `Retry-After`
   */
  readonly retryAfterSeconds?: number;
}

/**
 * The decision of a host about a request that a handler serves: it may go on, with what the host grants it, or it is refused.
 *
 * @typeParam TGrant - What an allowed request carries besides `allowed`, such as the owner of the resources that it may reach.
 */
export type AccessDecision<TGrant extends object = Record<never, never>> =
  | ({
      /** The request may be served. */
      readonly allowed: true;
    } & TGrant)
  | AccessRefusal;

/** The options of `readAccessDecision` for a decision that grants more than `allowed`. */
export interface ReadAccessDecisionOptions<TGrant extends object> {
  /**
   * The schema of what an allowed decision carries besides `allowed`, such as `v.object({ owner: nonEmptyStringSchema })`. It
   * reads the same object as the decision.
   */
  readonly grant: Schema<TGrant>;
}

/** The schema of a refusal: its reason, and the message, challenge and delay that go with it. */
export const refusalSchema = v.object({
  allowed: v.literal(false),
  reason: v.picklist(ACCESS_REFUSAL_REASONS),
  message: v.optional(v.string()),
  challenge: v.optional(v.string()),
  retryAfterSeconds: v.optional(nonNegativeIntegerSchema),
});

/** The schema of a decision: allowed, with anything more that a grant reads, or refused with a status and a delay. */
const decisionSchema = v.variant("allowed", [v.looseObject({ allowed: v.literal(true) }), refusalSchema]);

/**
 * Reads the decision that a host's port, such as `authorize`, gave about a request: `{ allowed: true }`, or an `AccessRefusal`
 * with its `reason`, `unauthenticated`, `forbidden` or `too-many-requests`, and, optionally, its message, the challenge of an
 * `unauthenticated` refusal and the whole seconds of `Retry-After`.
 *
 * @remarks
 * A handler reads what its port answered with it, so that a port that answers another shape is a `DataError` that names the
 * path, and answers the refusal itself. Properties that the decision does not name are dropped.
 *
 * @param value - What the port answered.
 * @param label - Names the value in the message, such as `The decision of authorize`.
 * @returns The decision.
 * @throws `DataError` that names the path of the first issue, when the value is not a decision.
 */
export function readAccessDecision(value: unknown, label: string): AccessDecision;
/**
 * Reads the decision that a host's port gave about a request, when an allowed decision carries more than `allowed`, such as the
 * owner of the resources that the request reaches.
 *
 * @param value - What the port answered.
 * @param label - Names the value in the message, such as `The decision of authorize`.
 * @param options - The schema of what an allowed decision carries; it reads the same object, and drops what it does not name.
 * @returns The decision, with what it grants when it is allowed.
 * @throws `DataError` that names the path of the first issue, when the value is not a decision or lacks what it grants.
 */
export function readAccessDecision<TGrant extends object>(
  value: unknown,
  label: string,
  options: ReadAccessDecisionOptions<TGrant>,
): AccessDecision<TGrant>;
export function readAccessDecision(
  value: unknown,
  label: string,
  options?: ReadAccessDecisionOptions<object>,
): AccessDecision<object> {
  const decision = parseWith(decisionSchema, value, label);
  if (!decision.allowed) return decision;
  return { ...(options === undefined ? {} : parseWith(options.grant, value, label)), allowed: true };
}
