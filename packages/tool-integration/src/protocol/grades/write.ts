// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { DataError } from "@interopkit/core";
import { checkHttpsUrl, checkNonEmptyString, describe, type JsonValue } from "@interopkit/core/checks";
import {
  checkLimit,
  compact,
  MAX_IDENTIFIER_LENGTH,
  searchOf,
  writeExtensions,
  writeSubmissionReview,
} from "../claims/index.js";
import type { LineItem, LineItemInput, LineItemQuery, Result, ResultQuery, Score } from "./model.js";

const LINE_ITEM_MEMBERS = [
  "id",
  "scoreMaximum",
  "label",
  "resourceId",
  "resourceLinkId",
  "tag",
  "startDateTime",
  "endDateTime",
  "activityId",
  "gradesReleased",
  "submissionReview",
];
const SCORE_MEMBERS = [
  "userId",
  "scoringUserId",
  "scoreGiven",
  "scoreMaximum",
  "comment",
  "timestamp",
  "activityProgress",
  "gradingProgress",
  "submission",
];
const RESULT_MEMBERS = ["id", "scoreOf", "userId", "resultScore", "resultMaximum", "scoringUserId", "comment"];

/**
 * Writes a line item that a tool gives a platform, as `readLineItemInput` reads it.
 *
 * @throws `DataError` when `scoreMaximum` is not above 0, the label is blank, or an extension is not named by a URL.
 */
export function writeLineItemInput(item: LineItemInput): Record<string, JsonValue> {
  if (!(Number.isFinite(item.scoreMaximum) && item.scoreMaximum > 0)) {
    throw new DataError(
      `The scoreMaximum of a line item must be a number above 0, found ${describe(item.scoreMaximum)}.`,
    );
  }
  checkNonEmptyString(item.label.trim(), "The label of a line item");
  return compact({
    scoreMaximum: item.scoreMaximum,
    label: item.label,
    resourceId: item.resourceId,
    resourceLinkId: item.resourceLinkId,
    tag: item.tag,
    startDateTime: item.startDateTime,
    endDateTime: item.endDateTime,
    activityId: item.activityId,
    gradesReleased: item.gradesReleased,
    submissionReview: item.submissionReview && writeSubmissionReview(item.submissionReview),
    ...writeExtensions(item.extensions, LINE_ITEM_MEMBERS),
  });
}

/** Writes a line item that a platform sends, as `readLineItem` reads it. @throws `DataError` as `writeLineItemInput` does, or when `id` is not an https address. */
export function writeLineItem(item: LineItem): Record<string, JsonValue> {
  checkHttpsUrl(item.id, "The id of a line item");
  return { id: item.id, ...writeLineItemInput(item) };
}

/** Writes a container of line items, a JSON array. @throws `DataError` as `writeLineItem` does. */
export function writeLineItems(items: readonly LineItem[]): Record<string, JsonValue>[] {
  return items.map(writeLineItem);
}

/**
 * Writes a score that a tool sends, as `readScore` reads it.
 *
 * @throws `DataError` when the user is not an identifier of at most 255 characters, a score has no `scoreMaximum` above 0
 * beside it, or an extension is not named by a URL.
 */
export function writeScore(score: Score): Record<string, JsonValue> {
  for (const [id, label] of [
    [score.userId, "userId"],
    [score.scoringUserId, "scoringUserId"],
  ] as const) {
    if (id !== undefined && (id === "" || id.length > MAX_IDENTIFIER_LENGTH)) {
      throw new DataError(
        `The ${label} of a score must be 1 to ${MAX_IDENTIFIER_LENGTH} characters, found ${describe(id)}.`,
      );
    }
  }
  if (score.scoreGiven !== undefined && !(score.scoreMaximum !== undefined && score.scoreMaximum > 0)) {
    throw new DataError("A score with a scoreGiven must have a scoreMaximum above 0.");
  }
  return compact({
    userId: score.userId,
    scoringUserId: score.scoringUserId,
    scoreGiven: score.scoreGiven,
    scoreMaximum: score.scoreMaximum,
    comment: score.comment,
    timestamp: score.timestamp,
    activityProgress: score.activityProgress,
    gradingProgress: score.gradingProgress,
    submission: score.submission && compact({ ...score.submission }),
    ...writeExtensions(score.extensions, SCORE_MEMBERS),
  });
}

/** Writes a result that a platform sends, as `readResult` reads it. @throws `DataError` when an address is not https or an extension is not named by a URL. */
export function writeResult(result: Result): Record<string, JsonValue> {
  checkHttpsUrl(result.id, "The id of a result");
  checkHttpsUrl(result.scoreOf, "The scoreOf of a result");
  return compact({
    id: result.id,
    scoreOf: result.scoreOf,
    userId: result.userId,
    resultScore: result.resultScore,
    resultMaximum: result.resultMaximum,
    scoringUserId: result.scoringUserId,
    comment: result.comment,
    ...writeExtensions(result.extensions, RESULT_MEMBERS),
  });
}

/** Writes a container of results, a JSON array. @throws `DataError` as `writeResult` does. */
export function writeResults(results: readonly Result[]): Record<string, JsonValue>[] {
  return results.map(writeResult);
}

/** Writes the filters of a request for line items as query parameters. @throws `DataError` when `limit` is not a positive integer. */
export function writeLineItemQuery(query: LineItemQuery): URLSearchParams {
  checkLimit(query.limit, "line item query");
  return searchOf([
    ["resource_id", query.resourceId],
    ["resource_link_id", query.resourceLinkId],
    ["tag", query.tag],
    ["activity_id", query.activityId],
    ["limit", query.limit],
  ]);
}

/** Writes the filters of a request for results as query parameters. @throws `DataError` when `limit` is not a positive integer. */
export function writeResultQuery(query: ResultQuery): URLSearchParams {
  checkLimit(query.limit, "result query");
  return searchOf([
    ["user_id", query.userId],
    ["limit", query.limit],
  ]);
}
