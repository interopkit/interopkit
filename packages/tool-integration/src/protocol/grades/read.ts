// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { finiteSchema, looseRecord, parseWith, positiveSchema } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  BOOLEAN,
  DATE_TIME,
  extensionsOf,
  HTTPS_URL,
  IDENTIFIER,
  NULLABLE_STRING,
  OPTIONAL_DATE_TIME,
  OPTIONAL_TEXT,
  searchLimit,
  searchValue,
  submissionReviewSchema,
} from "../claims/index.js";
import {
  ACTIVITY_PROGRESS,
  GRADING_PROGRESS,
  type LineItem,
  type LineItemInput,
  type LineItemQuery,
  type Result,
  type ResultQuery,
  type Score,
} from "./model.js";

/** The properties of a line item that a tool gives, before its extensions. */
const lineItemEntries = {
  scoreMaximum: positiveSchema,
  label: v.pipe(
    v.string(),
    v.check((label) => label.trim() !== "", "expected a label that is not blank"),
  ),
  resourceId: OPTIONAL_TEXT,
  resourceLinkId: OPTIONAL_TEXT,
  tag: OPTIONAL_TEXT,
  startDateTime: OPTIONAL_DATE_TIME,
  endDateTime: OPTIONAL_DATE_TIME,
  activityId: OPTIONAL_TEXT,
  gradesReleased: v.optional(BOOLEAN),
  submissionReview: v.optional(submissionReviewSchema),
};

/** Reads the properties of a line item that a tool gives. */
function lineItemInputOf(claim: v.InferOutput<ReturnType<typeof looseRecord<typeof lineItemEntries>>>): LineItemInput {
  return {
    scoreMaximum: claim.scoreMaximum,
    label: claim.label,
    resourceId: claim.resourceId,
    resourceLinkId: claim.resourceLinkId,
    tag: claim.tag,
    startDateTime: claim.startDateTime,
    endDateTime: claim.endDateTime,
    activityId: claim.activityId,
    gradesReleased: claim.gradesReleased,
    submissionReview: claim.submissionReview,
    extensions: extensionsOf(claim),
  };
}

/** A line item as a platform sends it (AGS 3.2.1). */
const lineItemSchema = v.pipe(
  looseRecord({ id: HTTPS_URL, ...lineItemEntries }),
  v.transform((claim): LineItem => ({ id: claim.id, ...lineItemInputOf(claim) })),
);

/** A line item as a tool gives it to create or replace one: a member `id` that a tool echoes is ignored. */
const lineItemInputSchema = v.pipe(
  looseRecord({ id: v.optional(v.unknown()), ...lineItemEntries }),
  v.transform((claim): LineItemInput => lineItemInputOf(claim)),
);

/** A score as a tool sends it (AGS 3.4). */
const scoreSchema = v.pipe(
  looseRecord({
    userId: IDENTIFIER,
    scoringUserId: v.optional(IDENTIFIER),
    scoreGiven: v.nullish(v.pipe(finiteSchema, v.minValue(0))),
    scoreMaximum: v.nullish(positiveSchema),
    comment: v.nullish(v.string()),
    timestamp: DATE_TIME,
    activityProgress: v.picklist(ACTIVITY_PROGRESS),
    gradingProgress: v.picklist(GRADING_PROGRESS),
    submission: v.optional(
      v.pipe(
        looseRecord({ startedAt: v.optional(DATE_TIME), submittedAt: v.optional(DATE_TIME) }),
        v.check(
          ({ startedAt, submittedAt }) =>
            startedAt === undefined || submittedAt === undefined || Date.parse(submittedAt) >= Date.parse(startedAt),
          "expected submittedAt not before startedAt",
        ),
        v.transform(({ startedAt, submittedAt }) => ({ startedAt, submittedAt })),
      ),
    ),
  }),
  v.check(
    ({ scoreGiven, scoreMaximum }) =>
      scoreGiven === null || scoreGiven === undefined || (scoreMaximum ?? null) !== null,
    "expected scoreMaximum beside scoreGiven",
  ),
  v.transform(
    (claim): Score => ({
      userId: claim.userId,
      scoringUserId: claim.scoringUserId,
      scoreGiven: claim.scoreGiven ?? undefined,
      scoreMaximum: claim.scoreMaximum ?? undefined,
      comment: claim.comment ?? undefined,
      timestamp: claim.timestamp,
      activityProgress: claim.activityProgress,
      gradingProgress: claim.gradingProgress,
      submission: claim.submission,
      extensions: extensionsOf(claim),
    }),
  ),
);

/** The members of a result but its addresses, which a platform knows before it asks its store for the rest. */
const storedResultEntries = {
  userId: IDENTIFIER,
  resultScore: v.nullish(finiteSchema),
  resultMaximum: v.nullish(positiveSchema),
  scoringUserId: v.optional(IDENTIFIER),
  comment: NULLABLE_STRING,
};

/** A result without its addresses, as the schema of its members read it. */
function storedResultOf(
  claim: v.InferOutput<ReturnType<typeof looseRecord<typeof storedResultEntries>>>,
): Omit<Result, "id" | "scoreOf"> {
  return {
    userId: claim.userId,
    resultScore: claim.resultScore ?? undefined,
    resultMaximum: claim.resultMaximum ?? undefined,
    scoringUserId: claim.scoringUserId,
    comment: claim.comment,
    extensions: extensionsOf(claim),
  };
}

/** A result as a platform sends it (AGS 3.3). */
const resultSchema = v.pipe(
  looseRecord({ id: HTTPS_URL, scoreOf: HTTPS_URL, ...storedResultEntries }),
  v.transform((claim): Result => ({ id: claim.id, scoreOf: claim.scoreOf, ...storedResultOf(claim) })),
);

/** A result without its addresses, as the store of a platform gives it. */
const storedResultSchema = v.pipe(looseRecord(storedResultEntries), v.transform(storedResultOf));

/**
 * Reads a line item that a platform sent into the model.
 *
 * @remarks
 * A `null` or blank `resourceId`, `resourceLinkId`, `tag`, `activityId`, `startDateTime` or `endDateTime` is absent, as AGS
 * 3.2 lets a platform send them. Properties that the model does not name are ignored, except those named by a URL, which are
 * the extensions.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` that names the path of the first invalid member.
 */
export function readLineItem(value: unknown): LineItem {
  return parseWith(lineItemSchema, value, "The line item");
}

/** Reads the line items of a container (`application/vnd.ims.lis.v2.lineitemcontainer+json`), a JSON array. @throws `DataError` that names the first invalid line item. */
export function readLineItems(value: unknown): LineItem[] {
  return parseWith(v.array(lineItemSchema), value, "The line items");
}

/** Reads the line item that a tool gives a platform to create or replace one; an `id` it holds is ignored. @throws `DataError`. */
export function readLineItemInput(value: unknown): LineItemInput {
  return parseWith(lineItemInputSchema, value, "The line item");
}

/**
 * Reads a score that a tool sent into the model: `scoreMaximum` beside `scoreGiven`, a `null` score or comment as absent, and
 * the timestamps with a time zone designator.
 *
 * @throws `DataError` that names the path of the first invalid member.
 */
export function readScore(value: unknown): Score {
  return parseWith(scoreSchema, value, "The score");
}

/** Reads a result that a platform sent into the model; a `null` score or comment is absent. @throws `DataError`. */
export function readResult(value: unknown): Result {
  return parseWith(resultSchema, value, "The result");
}

/**
 * Reads a result without its `id` and `scoreOf`, which the platform that writes it knows: a `null` score or comment is absent.
 *
 * @throws `DataError` that names the path of the first invalid member, as `readResult` does.
 */
export function readStoredResult(value: unknown): Omit<Result, "id" | "scoreOf"> {
  return parseWith(storedResultSchema, value, "The result");
}

/** Reads the results of a container (`application/vnd.ims.lis.v2.resultcontainer+json`), a JSON array. @throws `DataError`. */
export function readResults(value: unknown): Result[] {
  return parseWith(v.array(resultSchema), value, "The results");
}

const LINE_ITEM_QUERY = "line item query";
const RESULT_QUERY = "result query";

/**
 * Reads the filters of a request for line items: `resource_id`, `resource_link_id`, `tag`, `activity_id` and `limit`. An
 * unknown parameter is ignored.
 *
 * @throws `DataError` when a parameter is given twice or `limit` is not a positive integer.
 */
export function readLineItemQuery(search: URLSearchParams): LineItemQuery {
  return {
    resourceId: searchValue(search, "resource_id", LINE_ITEM_QUERY),
    resourceLinkId: searchValue(search, "resource_link_id", LINE_ITEM_QUERY),
    tag: searchValue(search, "tag", LINE_ITEM_QUERY),
    activityId: searchValue(search, "activity_id", LINE_ITEM_QUERY),
    limit: searchLimit(search, LINE_ITEM_QUERY),
  };
}

/**
 * Reads the filters of a request for results: `user_id` and `limit`. An unknown parameter is ignored.
 *
 * @throws `DataError` when a parameter is given twice or `limit` is not a positive integer.
 */
export function readResultQuery(search: URLSearchParams): ResultQuery {
  return { userId: searchValue(search, "user_id", RESULT_QUERY), limit: searchLimit(search, RESULT_QUERY) };
}
