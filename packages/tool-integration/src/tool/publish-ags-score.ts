import { callService, DataError, DEFAULT_TIMEOUT_MS, type ServiceCall } from "@interopkit/core";
import {
  checkArray,
  checkHttpsUrl,
  checkNonEmptyString,
  checkProperties,
  checkRecord,
  describe,
  isRecord,
  looseRecord,
  parseWith,
  positiveSchema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { LtiError } from "../errors.js";
import { AGS_SCOPE } from "../protocol/internal.js";
import { type AccessToken, ltiAccessToken } from "./access-token.js";
import type { LtiLaunch } from "./launch-model.js";
import { type AccessTokenOptions, checkToolOptions } from "./options.js";

const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
const LINE_ITEM_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
const SCORES_SUFFIX = "/scores";
const TRAILING_SLASH = /\/$/u;
/** An ISO 8601 date and time with a time zone, as AGS 3.4.9 requires of the timestamp of a score: `2026-11-01T09:30:00.250Z`. */
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

/** The score that a tool publishes to the line item of a launch (AGS 2.0 section 3.4). */
export interface AgsScoreInput {
  /** How far the user is in the activity. A tool that publishes a finished attempt sends `Completed`. */
  readonly activityProgress: "Completed";
  /** How far grading is: `FullyGraded`, `Pending` while a service must still score, or `PendingManual` while a person must. */
  readonly gradingProgress: "FullyGraded" | "Pending" | "PendingManual";
  /**
   * The time of the score, in ISO 8601 with a time zone. Each update of a line item and user needs a strictly later one
   * (AGS 3.4.9), so a resend takes a later time even when the first attempt is in doubt.
   */
  readonly timestamp: string;
  /**
   * The score, a number from 0.
   *
   * @defaultValue none, and then the score has no points
   */
  readonly scoreGiven?: number;
  /**
   * The highest score, a number above 0, which needs a `scoreGiven`.
   *
   * @defaultValue the `scoreMaximum` of the line item, which the call reads when `scoreGiven` is set without it
   */
  readonly scoreMaximum?: number;
  /**
   * A comment for the user.
   *
   * @defaultValue none
   */
  readonly comment?: string;
}

const scoreSchema = looseRecord({
  activityProgress: v.literal("Completed"),
  gradingProgress: v.picklist(["FullyGraded", "Pending", "PendingManual"]),
  timestamp: v.pipe(
    v.string(),
    v.check(
      (text) => TIMESTAMP.test(text) && !Number.isNaN(Date.parse(text)),
      (issue) => `expected an ISO 8601 date and time with a time zone, found ${issue.received}`,
    ),
  ),
  scoreGiven: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
  scoreMaximum: v.optional(positiveSchema),
  comment: v.optional(v.string()),
});

/** Checks the score that the host passes. */
function checkScore(score: unknown): asserts score is AgsScoreInput {
  checkRecord(score, "The score must be an object");
  checkProperties(score, "A score", [
    "activityProgress",
    "gradingProgress",
    "timestamp",
    "scoreGiven",
    "scoreMaximum",
    "comment",
  ]);
  const fields = parseWith(scoreSchema, score, "The score");
  if (fields.scoreMaximum !== undefined && fields.scoreGiven === undefined) {
    throw new DataError("A scoreMaximum needs a scoreGiven: a score without points has no maximum.");
  }
}

/** Returns the line item scope to ask for when the line item must be read: the read-only one if the launch offers it. */
function lineItemScope(offered: readonly string[]): string {
  const scope = [AGS_SCOPE.lineitemReadonly, AGS_SCOPE.lineitem].find((each) => offered.includes(each));
  if (scope === undefined) {
    throw new LtiError(
      "The score has no scoreMaximum, so the call needs the scoreMaximum of the line item, and the launch offers no scope to read it.",
      "scope-unavailable",
    );
  }
  return scope;
}

/** Checks the launch that the score is published for, and returns the parts of it that the service calls use. */
function serviceOf(launch: unknown): {
  readonly lineItem: string;
  readonly offered: readonly string[];
  readonly userId: string;
} {
  checkRecord(launch, "The launch must be an object");
  if (launch.messageType !== "LtiResourceLinkRequest") {
    throw new DataError(
      `A score is published for a resource link launch, found the message type ${describe(launch.messageType)}.`,
    );
  }
  const { ags, subject } = launch;
  if (ags === undefined || (isRecord(ags) && ags.lineitem === undefined)) {
    throw new LtiError("The launch offers no line item to publish a score to.", "line-item-unavailable");
  }
  checkRecord(ags, "The grade services of the launch must be an object");
  checkArray(ags.scopes, "The scopes of the grade services of the launch must be an array");
  const scopes = ags.scopes.map((scope) => {
    checkNonEmptyString(scope, "A scope of the grade services of the launch");
    return scope;
  });
  checkHttpsUrl(ags.lineitem, "The line item of the launch");
  if (!scopes.includes(AGS_SCOPE.score)) {
    throw new LtiError("The launch does not offer the scope to publish a score.", "scope-unavailable");
  }
  if (subject === undefined) {
    throw new LtiError("The launch is anonymous, so the score has no user to be for.", "subject-unavailable");
  }
  checkNonEmptyString(subject, "The subject of the launch");
  return { lineItem: ags.lineitem, offered: scopes, userId: subject };
}

/** Checks that the token holds the scopes the calls need: the platform may grant fewer than were asked. */
function checkGranted(token: AccessToken, needed: readonly string[]): void {
  const missing = needed.find((scope) => !token.scopes.includes(scope));
  if (missing !== undefined) {
    throw new LtiError(`The platform did not grant the scope ${missing}.`, "scope-denied");
  }
}

/**
 * Reads the `scoreMaximum` of the body of a line item, which a score needs when it has none.
 *
 * @throws `DataError` when the body is not a line item with a `scoreMaximum` above 0.
 */
export function readScoreMaximum(body: string): number {
  let line: unknown;
  try {
    line = JSON.parse(body);
  } catch {
    throw new DataError("The line item must be JSON.");
  }
  checkRecord(line, "The line item must be an object");
  const { scoreMaximum } = line;
  if (typeof scoreMaximum !== "number" || !Number.isFinite(scoreMaximum) || scoreMaximum <= 0) {
    throw new DataError(
      `The scoreMaximum of the line item must be a number above 0 when the score has none, found ${describe(scoreMaximum)}.`,
    );
  }
  return scoreMaximum;
}

/** Asks the line item for its `scoreMaximum`. */
async function readLineItemMaximum(service: ServiceCall, lineItem: string, token: AccessToken): Promise<number> {
  const body = await callService(service, `The line item ${lineItem}`, lineItem, {
    method: "GET",
    headers: { accept: LINE_ITEM_TYPE, authorization: `Bearer ${token.value}` },
  });
  return readScoreMaximum(body);
}

/** Returns the URL of the scores of a line item: its path, without a trailing slash, with `/scores` appended, and its query kept. */
function scoresUrl(lineItem: string): string {
  const url = new URL(lineItem);
  url.pathname = `${url.pathname.replace(TRAILING_SLASH, "")}${SCORES_SUFFIX}`;
  return url.href;
}

/** Builds the body of the score request. */
function scoreBody(score: AgsScoreInput, userId: string, scoreMaximum: number | undefined): Record<string, unknown> {
  const { activityProgress, gradingProgress, timestamp, scoreGiven, comment } = score;
  return {
    userId,
    timestamp,
    activityProgress,
    gradingProgress,
    ...(scoreGiven === undefined ? {} : { scoreGiven, scoreMaximum }),
    ...(comment === undefined ? {} : { comment }),
  };
}

/**
 * Publishes a score to the line item of the launch that started the activity, to the learning platform that launched the
 * tool (AGS 2.0 score publish service).
 *
 * @remarks
 * - **The time.** AGS 3.4.9 says that a tool must not send two updates of one line item and user with the same timestamp,
 *   and that timestamps increase strictly. The call is not idempotent: a resend, even when the first attempt is in doubt
 *   after a timeout, needs a later `timestamp`.
 * - **The maximum.** `scoreMaximum` is the one of the score, else the one of the line item, which the call reads.
 * - **The token.** The call requests an access token for the scopes it needs and does not keep it.
 * - **The signal.** An abort while the request is in flight leaves it in doubt: the platform may have received the score.
 *
 * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0#score-publish-service | LTI AGS 2.0, score publish service}
 * @param score - The score.
 * @param launch - The resource link launch that started the activity, from `ltiLaunch`; a Deep Linking request is refused.
 * @param options - The registration lookup, the clock, the `fetch` of `ltiAccessToken` and the `signal`.
 * @throws `DataError` when an argument has the wrong type, the score is not valid, or the line item has no `scoreMaximum`
 * above 0 where one is needed.
 * @throws `LtiError` (`line-item-unavailable`, `scope-unavailable`, `subject-unavailable`, `scope-denied`) when the launch
 * offers no line item, no scope for the calls, or no user, and when the platform grants fewer scopes than were asked.
 * @throws `ServiceError` when the token endpoint, the line item or the score service does not answer with a success.
 * @throws The `reason` of `options.signal` when it aborts.
 */
export async function publishAgsScore(
  score: AgsScoreInput,
  launch: LtiLaunch,
  options: AccessTokenOptions,
): Promise<void> {
  checkToolOptions(options);
  checkScore(score);
  const { lineItem, offered, userId } = serviceOf(launch);
  const needsMaximum = score.scoreGiven !== undefined && score.scoreMaximum === undefined;
  const scopes = needsMaximum ? [AGS_SCOPE.score, lineItemScope(offered)] : [AGS_SCOPE.score];
  const token = await ltiAccessToken(launch, scopes, options);
  checkGranted(token, scopes);
  const service = { fetch: options.fetch, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal: options.signal };
  const scoreMaximum = needsMaximum ? await readLineItemMaximum(service, lineItem, token) : score.scoreMaximum;
  await callService(service, `The score service of ${lineItem}`, scoresUrl(lineItem), {
    method: "POST",
    headers: { "content-type": SCORE_TYPE, authorization: `Bearer ${token.value}` },
    body: JSON.stringify(scoreBody(score, userId, scoreMaximum)),
  });
}
