import { DataError } from "@interopkit/core";
import { checkNonEmptyString, isRecord } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpResponse } from "@interopkit/core/http";
import { type LineItem, type MessageServices, type Result, SCOPES } from "../../protocol/index.js";
import {
  LINE_ITEM_CONTAINER_MEDIA_TYPE,
  LINE_ITEM_MEDIA_TYPE,
  parseZonedDateTime,
  RESULT_CONTAINER_MEDIA_TYPE,
  RESULTS_SUFFIX,
  readLineItemInput,
  readLineItemQuery,
  readResultQuery,
  readScore,
  readStoredResult,
  SCORE_MEDIA_TYPE,
  SCORES_SUFFIX,
  writeLineItem,
  writeLineItems,
  writeResults,
} from "../../protocol/internal.js";
import { notFound } from "../answers.js";
import type { GradebookStore, ReceivedScore, StorePage } from "../ports.js";
import { readBody } from "./body.js";
import { pageHeaders, readPagedQuery } from "./paging.js";
import {
  askStore,
  type ClaimRequest,
  fromStore,
  paramOf,
  readStorePage,
  type Service,
  type ServiceRequest,
} from "./service.js";

/** The scopes that read the line items: the narrower first. */
const READ_LINE_ITEMS = [SCOPES.lineitemReadonly, SCOPES.lineitem];
const CONTAINER_PATH = "/contexts/{context}/line-items";
const LINE_ITEM_PATH = `${CONTAINER_PATH}/{lineItem}`;

// A store gives the methods of the capabilities it has, and a route method is served only when its store has the method that it
// calls, so the optional call of a handler always reaches the store.
type Call = ServiceRequest<GradebookStore>;

/** Returns the URL of the line items of a context. */
function containerUrl(origin: string, contextId: string): string {
  return `${origin}/contexts/${encodeURIComponent(contextId)}/line-items`;
}

/** Returns the URL of a line item, which is its `id` (AGS 3.2). */
function lineItemUrl(origin: string, contextId: string, lineItemId: string): string {
  return `${containerUrl(origin, contextId)}/${encodeURIComponent(lineItemId)}`;
}

/** The context and the line item that the path of a request names. */
function pathOf(call: Call): { readonly context: string; readonly lineItem: string } {
  return { context: paramOf(call, "context"), lineItem: paramOf(call, "lineItem") };
}

/** Reads a page that a store answered, its items with a reader. */
function storePage<T>(label: string, value: unknown, read: (item: unknown) => T): StorePage<T> {
  const page = readStorePage(label, value);
  const items = page.items.map((item) => fromStore(label, () => read(item)));
  return page.cursor === undefined ? { items } : { items, cursor: page.cursor };
}

/** Returns a property of a value that a store answered, when it is an object. */
function memberOf(value: unknown, name: string): unknown {
  return isRecord(value) ? value[name] : undefined;
}

/** Reads a line item that the store answered into the model, with its URL as its `id`. */
function storedLineItem(label: string, value: unknown, origin: string, contextId: string): LineItem {
  return fromStore(label, () => {
    const input = readLineItemInput(value);
    const id = memberOf(value, "id");
    checkNonEmptyString(id, "The id of a line item");
    return { ...input, id: lineItemUrl(origin, contextId, id) };
  });
}

/** Answers with a line item. */
function lineItemAnswer(status: number, item: LineItem): HttpResponse {
  return buildJsonResponse(status, writeLineItem(item), {
    headers: status === 201 ? { location: item.id } : {},
    type: LINE_ITEM_MEDIA_TYPE,
  });
}

/** GET of the line items of a context (AGS 3.2.4), filtered and in pages. */
async function getLineItems(call: Call): Promise<HttpResponse> {
  const { url, store, caller, settings } = call;
  const { context } = pathOf(call);
  const request = readPagedQuery(call, readLineItemQuery);
  if ("status" in request) return request;
  const { query, page } = request;
  const { limit: _, ...filters } = query;
  const asked = { ...filters, ...page };
  const found = await askStore(call, (options) => store.lineItems?.(caller, context, asked, options));
  if (found === undefined) return notFound();
  const label = "GradebookStore.lineItems";
  const items = storePage(label, found, (item) => storedLineItem(label, item, settings.config.origin, context));
  const headers = pageHeaders(url, items, page, label);
  return buildJsonResponse(200, writeLineItems(items.items), { headers, type: LINE_ITEM_CONTAINER_MEDIA_TYPE });
}

/** POST of a line item to the container of a context (AGS 3.2.5), answered with 201 and the line item. */
async function createLineItem(call: Call): Promise<HttpResponse> {
  const { request, store, caller, settings } = call;
  const { context } = pathOf(call);
  const input = readBody(request, LINE_ITEM_MEDIA_TYPE, settings.maxBodyBytes, readLineItemInput);
  if ("status" in input) return input;
  const created = await askStore(call, (options) => store.createLineItem?.(caller, context, input.value, options));
  if (created === undefined) return notFound();
  return lineItemAnswer(201, storedLineItem("GradebookStore.createLineItem", created, settings.config.origin, context));
}

/** GET of a line item (AGS 3.2.3). */
async function getLineItem(call: Call): Promise<HttpResponse> {
  const { store, caller, settings } = call;
  const { context, lineItem } = pathOf(call);
  const found = await askStore(call, (options) => store.lineItem?.(caller, context, lineItem, options));
  if (found === undefined) return notFound();
  return lineItemAnswer(200, storedLineItem("GradebookStore.lineItem", found, settings.config.origin, context));
}

/** PUT of a line item (AGS 3.2.6), answered with the line item as the store keeps it. */
async function updateLineItem(call: Call): Promise<HttpResponse> {
  const { request, store, caller, settings } = call;
  const { context, lineItem } = pathOf(call);
  const input = readBody(request, LINE_ITEM_MEDIA_TYPE, settings.maxBodyBytes, readLineItemInput);
  if ("status" in input) return input;
  const updated = await askStore(call, (options) =>
    store.updateLineItem?.(caller, context, lineItem, input.value, options),
  );
  if (updated === undefined) return notFound();
  return lineItemAnswer(200, storedLineItem("GradebookStore.updateLineItem", updated, settings.config.origin, context));
}

/** DELETE of a line item (AGS 3.2.7). */
async function deleteLineItem(call: Call): Promise<HttpResponse> {
  const { store, caller } = call;
  const { context, lineItem } = pathOf(call);
  const deleted = await askStore(call, (options) => store.deleteLineItem?.(caller, context, lineItem, options));
  if (typeof deleted !== "boolean")
    throw new DataError("The answer of GradebookStore.deleteLineItem must be a boolean.");
  return deleted ? { status: 204, headers: {}, body: "" } : notFound();
}

/** GET of the results of a line item (AGS 3.3), filtered by user and in pages. */
async function getResults(call: Call): Promise<HttpResponse> {
  const { url, store, caller, settings } = call;
  const { context, lineItem } = pathOf(call);
  const request = readPagedQuery(call, readResultQuery);
  if ("status" in request) return request;
  const { query, page } = request;
  const asked = { ...(query.userId === undefined ? {} : { userId: query.userId }), ...page };
  const found = await askStore(call, (options) => store.results?.(caller, context, lineItem, asked, options));
  if (found === undefined) return notFound();
  const scoreOf = lineItemUrl(settings.config.origin, context, lineItem);
  // The address of the results has no query and no fragment, since the platform's origin has none and the path is encoded, so
  // the address of each result is it with its user as the query (AGS 3.3), as URLSearchParams writes one.
  const resultsUrl = new URL(`${scoreOf}${RESULTS_SUFFIX}`).href;
  const label = "GradebookStore.results";
  const results = storePage(label, found, (item): Result => {
    const userId = memberOf(item, "userId");
    checkNonEmptyString(userId, "The userId of a result");
    const id = `${resultsUrl}?${new URLSearchParams([["user_id", userId]])}`;
    return { id, scoreOf, ...readStoredResult(item) };
  });
  const headers = pageHeaders(url, results, page, label);
  return buildJsonResponse(200, writeResults(results.items), { headers, type: RESULT_CONTAINER_MEDIA_TYPE });
}

/** Reads the body of a score, with the instant of its timestamp for the store to order it by. */
function readReceivedScore(value: unknown): ReceivedScore {
  const score = readScore(value);
  // `readScore` takes only a timestamp that has a time zone, which `parseZonedDateTime` reads.
  return { ...score, timestampMs: parseZonedDateTime(score.timestamp) as number };
}

/**
 * POST of a score (AGS 3.4): the store keeps it unless a strictly later one is kept, and the answer is 204 either way, since AGS
 * 3.4.9 lets the platform just ignore an older score and a tool cannot act on one.
 */
async function postScore(call: Call): Promise<HttpResponse> {
  const { request, store, caller, settings } = call;
  const { context, lineItem } = pathOf(call);
  const score = readBody(request, SCORE_MEDIA_TYPE, settings.maxBodyBytes, readReceivedScore);
  if ("status" in score) return score;
  const kept = await askStore(call, (options) => store.keepScore?.(caller, context, lineItem, score.value, options));
  if (kept === undefined) return notFound();
  if (kept !== "kept" && kept !== "older") {
    throw new DataError('The answer of GradebookStore.keepScore must be "kept", "older" or undefined.');
  }
  return { status: 204, headers: {}, body: "" };
}

/**
 * Writes the claim of the Assignment and Grade Services (AGS 3.1) into the services of a message that asks for it: the
 * scopes that the registration grants, the container of the line items of the context when the store lists line items, and
 * the line item of the message.
 */
function gradesClaim({ message, granted, origin }: ClaimRequest, store?: GradebookStore): MessageServices {
  const asked = message.services?.grades;
  const contextId = message.context?.id;
  if (asked === undefined || contextId === undefined) return {};
  const { lineItemId, container } = asked;
  const listed = container && (store === undefined || store.lineItems !== undefined);
  return {
    grades: {
      scopes: granted,
      ...(listed ? { lineitems: containerUrl(origin, contextId) } : {}),
      ...(lineItemId === undefined ? {} : { lineitem: lineItemUrl(origin, contextId, lineItemId) }),
    },
  };
}

/** The Assignment and Grade Services over the host's `GradebookStore`. */
export const GRADES: Service<"gradebook"> = {
  store: "gradebook",
  scopes: [SCOPES.lineitem, SCOPES.lineitemReadonly, SCOPES.resultReadonly, SCOPES.score],
  claim: gradesClaim,
  routes: [
    {
      path: CONTAINER_PATH,
      methods: {
        GET: { scopes: READ_LINE_ITEMS, uses: "lineItems", handle: getLineItems },
        POST: { scopes: [SCOPES.lineitem], uses: "createLineItem", handle: createLineItem },
      },
    },
    {
      path: LINE_ITEM_PATH,
      methods: {
        GET: { scopes: READ_LINE_ITEMS, uses: "lineItem", handle: getLineItem },
        PUT: { scopes: [SCOPES.lineitem], uses: "updateLineItem", handle: updateLineItem },
        DELETE: { scopes: [SCOPES.lineitem], uses: "deleteLineItem", handle: deleteLineItem },
      },
    },
    {
      path: `${LINE_ITEM_PATH}${RESULTS_SUFFIX}`,
      methods: { GET: { scopes: [SCOPES.resultReadonly], uses: "results", handle: getResults } },
    },
    {
      path: `${LINE_ITEM_PATH}${SCORES_SUFFIX}`,
      methods: { POST: { scopes: [SCOPES.score], uses: "keepScore", handle: postScore } },
    },
  ],
};
