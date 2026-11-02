import { type CallOptions, DataError } from "@interopkit/core";
import { checkHttpsUrl, describe } from "@interopkit/core/checks";
import {
  type LineItem,
  type LineItemInput,
  type LineItemQuery,
  type Result,
  type ResultQuery,
  SCOPES,
  type Score,
} from "../../protocol/index.js";
import {
  LINE_ITEM_CONTAINER_MEDIA_TYPE,
  LINE_ITEM_MEDIA_TYPE,
  parseZonedDateTime,
  RESULT_CONTAINER_MEDIA_TYPE,
  RESULTS_SUFFIX,
  readLineItem,
  readLineItems,
  readResults,
  SCORE_MEDIA_TYPE,
  SCORES_SUFFIX,
  writeLineItemInput,
  writeLineItemQuery,
  writeResultQuery,
  writeScore,
} from "../../protocol/internal.js";
import { containerRequest, type Page, type ServiceAccess, withQuery } from "./access.js";

/** The scopes that read line items, the narrower first. */
const READ_LINE_ITEMS = [SCOPES.lineitemReadonly, SCOPES.lineitem];
const TRAILING_SLASH = /\/$/u;
/** The status of a line item that the platform does not have. */
const NOT_FOUND = 404;

/** The client of the Assignment and Grade Services (AGS 2.0) of a platform. */
export interface GradesClient {
  /**
   * Returns a page of the line items of a container (AGS 3.2.4): the `lineitems` URL of the launch with the filters of the
   * query, or the `next` of an earlier page.
   *
   * @param url - The container, or the `next` of a page, which is sent as it is but for a `limit` when it has none.
   * @param query - The filters; a `limit` of none is the option `pageLimit`.
   */
  lineItems(url: string, query?: LineItemQuery, options?: CallOptions): Promise<Page<LineItem>>;
  /** Returns a line item (AGS 3.2.3), or `undefined` when the platform has none at the URL (404). */
  lineItem(url: string, options?: CallOptions): Promise<LineItem | undefined>;
  /**
   * Creates a line item in a container (AGS 3.2.5). It is not idempotent: a retry makes a second line item, so a tool queries by
   * `resourceId` and `tag` first.
   */
  createLineItem(containerUrl: string, input: LineItemInput, options?: CallOptions): Promise<LineItem>;
  /** Replaces a line item (AGS 3.2.6) and returns it as the platform keeps it. */
  updateLineItem(url: string, input: LineItemInput, options?: CallOptions): Promise<LineItem>;
  /** Deletes a line item (AGS 3.2.7); `false` when the platform has none at the URL (404). */
  deleteLineItem(url: string, options?: CallOptions): Promise<boolean>;
  /**
   * Returns a page of the results of a line item (AGS 3.3), or the `next` of an earlier page.
   *
   * @param lineItemUrl - The line item, whose results are below its path at `/results` with its query kept; or the `next` of a
   * page, whose path ends with `/results`, which is sent as it is but for a `limit` when it has none.
   * @param query - The filters; a `limit` of none is the option `pageLimit`.
   */
  results(lineItemUrl: string, query?: ResultQuery, options?: CallOptions): Promise<Page<Result>>;
  /**
   * Publishes a score to a line item (AGS 3.4). It is not idempotent: each update of a line item and user needs a strictly later
   * `timestamp` (AGS 3.4.9), which `advanceScoreTimestamp` gives, so a resend after a call in doubt takes a later one too.
   */
  publishScore(lineItemUrl: string, score: Score, options?: CallOptions): Promise<void>;
}

/**
 * Returns the URL of a service below a line item: its path, without a trailing slash, with the suffix appended, and its query
 * kept (AGS 3.3 and 3.4). A URL whose path already ends with the suffix, such as the `next` of a page of results, is the URL of
 * the service.
 */
function belowLineItem(lineItemUrl: string, suffix: string): URL {
  checkHttpsUrl(lineItemUrl, "The URL of the line item");
  const url = new URL(lineItemUrl);
  if (!url.pathname.endsWith(suffix)) url.pathname = `${url.pathname.replace(TRAILING_SLASH, "")}${suffix}`;
  return url;
}

/**
 * Returns a timestamp for the next score of a line item and user: the time, with millisecond precision, or one millisecond after
 * the last that was sent when the time is not later than it, so that the timestamps increase strictly (AGS 3.4.9).
 *
 * @param lastSent - The timestamp of the last score sent for the line item and the user, or `undefined` for the first.
 * @param nowMilliseconds - The time, in milliseconds since 1970-01-01T00:00:00Z.
 * @returns The timestamp, in UTC with the `Z` designator and three digits of the second.
 * @throws `DataError` when `lastSent` is not a date and time with a time zone designator, or `nowMilliseconds` is not a time.
 * @see {@link https://www.imsglobal.org/spec/lti-ags/v2p0#timestamp | LTI AGS 2.0, timestamp}
 */
export function advanceScoreTimestamp(lastSent: string | undefined, nowMilliseconds: number): string {
  if (typeof nowMilliseconds !== "number" || !Number.isSafeInteger(nowMilliseconds)) {
    throw new DataError(`The time must be a whole number of milliseconds, found ${describe(nowMilliseconds)}.`);
  }
  if (lastSent === undefined) return new Date(nowMilliseconds).toISOString();
  const last = typeof lastSent === "string" ? parseZonedDateTime(lastSent) : undefined;
  if (last === undefined) {
    throw new DataError(
      `The last timestamp must be a date and time with a time zone designator, found ${describe(lastSent)}.`,
    );
  }
  return new Date(Math.max(nowMilliseconds, last + 1)).toISOString();
}

/** Makes the client of the grade services over the access to the services of a platform. */
export function gradesClient(access: ServiceAccess): GradesClient {
  const { pageLimit } = access.settings;
  const lineItemAnswer = async (url: string, init: Parameters<ServiceAccess["request"]>[1], options?: CallOptions) =>
    access.read(await access.request(url, init, options), `The line item service at ${url}`, readLineItem);
  return {
    async lineItems(url, query, options) {
      const address = containerRequest(url, writeLineItemQuery(query ?? {}), pageLimit);
      const init = { method: "GET", scopes: READ_LINE_ITEMS, accept: LINE_ITEM_CONTAINER_MEDIA_TYPE } as const;
      const response = await access.request(address, init, options);
      const items = access.read(response, `The line item container at ${address}`, readLineItems);
      const next = access.next(response, address);
      return next === undefined ? { items } : { items, next };
    },
    async lineItem(url, options) {
      const init = {
        method: "GET",
        scopes: READ_LINE_ITEMS,
        accept: LINE_ITEM_MEDIA_TYPE,
        expect: [NOT_FOUND],
      } as const;
      const response = await access.request(url, init, options);
      return response.status === NOT_FOUND ? undefined : access.read(response, `The line item at ${url}`, readLineItem);
    },
    createLineItem(containerUrl, input, options) {
      const body = { type: LINE_ITEM_MEDIA_TYPE, json: writeLineItemInput(input) };
      return lineItemAnswer(
        containerUrl,
        { method: "POST", scopes: [SCOPES.lineitem], accept: LINE_ITEM_MEDIA_TYPE, body },
        options,
      );
    },
    updateLineItem(url, input, options) {
      const body = { type: LINE_ITEM_MEDIA_TYPE, json: writeLineItemInput(input) };
      return lineItemAnswer(
        url,
        { method: "PUT", scopes: [SCOPES.lineitem], accept: LINE_ITEM_MEDIA_TYPE, body },
        options,
      );
    },
    async deleteLineItem(url, options) {
      const response = await access.request(
        url,
        { method: "DELETE", scopes: [SCOPES.lineitem], expect: [NOT_FOUND] },
        options,
      );
      return response.status !== NOT_FOUND;
    },
    async results(lineItemUrl, query, options) {
      const address = withQuery(belowLineItem(lineItemUrl, RESULTS_SUFFIX), writeResultQuery(query ?? {}), pageLimit);
      const init = { method: "GET", scopes: [SCOPES.resultReadonly], accept: RESULT_CONTAINER_MEDIA_TYPE } as const;
      const response = await access.request(address, init, options);
      const items = access.read(response, `The result container at ${address}`, readResults);
      const next = access.next(response, address);
      return next === undefined ? { items } : { items, next };
    },
    async publishScore(lineItemUrl, score, options) {
      const body = { type: SCORE_MEDIA_TYPE, json: writeScore(score) };
      await access.request(
        belowLineItem(lineItemUrl, SCORES_SUFFIX).href,
        { method: "POST", scopes: [SCOPES.score], body },
        options,
      );
    },
  };
}
