import { callPort, DataError } from "@interopkit/core";
import { isUuid, parseWith } from "@interopkit/core/checks";
import {
  buildJsonResponse,
  buildPageLinks,
  checkHttpRequest,
  type HttpRequest,
  type HttpResponse,
  type OffsetPage,
  readAccessDecision,
  readOffsetPage,
  readQuery,
} from "@interopkit/core/http";
import type { CaseEntity, CasePackage, CaseVersion, CFDocumentSet } from "../model/index.js";
import { convertCaseVersion } from "../version/index.js";
import { selectFields } from "./fields.js";
import { type CaseProviderOptions, type ProviderSettings, readProviderOptions } from "./options.js";
import { parseQuery } from "./parse-query.js";
import { type Route, routeOf } from "./routes.js";
import { failure, internalError, invalidUuid, methodNotAllowed, refused, unknownObject } from "./status.js";
import { lookupSchema, pageSchema } from "./store.js";

/** Returns an object of the model in the form of a version of CASE. It is `undefined` when 1.0 has no form for it. */
function inVersion(value: CaseEntity | CasePackage, version: CaseVersion): CaseEntity | CasePackage | undefined {
  if (version === "1.1") return value;
  return convertCaseVersion(value, "1.0").value;
}

/**
 * The sentence of the `DataError` that `readQuery` throws for a parameter that occurs twice, or `readOffsetPage` for a `limit`
 * or an `offset` that is not a whole number in range: each names the parameter, and nothing else of the request.
 */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : "The query of the request cannot be read.";

/** Asks `authorize` about a request, and returns the answer to send when the request may not go on. */
async function refusalOf(request: HttpRequest, settings: ProviderSettings): Promise<HttpResponse | undefined> {
  const { authorize, signal } = settings;
  if (authorize === undefined) return undefined;
  const asked = await callPort(() => authorize(request, { signal }), signal);
  if (asked === undefined) return internalError();
  const decision = readAccessDecision(asked.value, "The decision of authorize");
  if (decision.allowed) return undefined;
  return refused(decision);
}

/** Answers a request for the list of documents (REST binding 2.1, 3.1 to 3.4). */
async function answerDocuments(
  request: HttpRequest,
  version: CaseVersion,
  settings: ProviderSettings,
): Promise<HttpResponse> {
  let parameters: ReadonlyMap<string, string>;
  try {
    parameters = readQuery(request);
  } catch (error) {
    return failure(400, messageOf(error));
  }
  const query = parseQuery(parameters, version);
  if ("refused" in query) return failure(400, query.detail, query.refused);
  let page: OffsetPage;
  try {
    page = readOffsetPage(parameters, settings);
  } catch (error) {
    return failure(400, messageOf(error));
  }
  const { signal } = settings;
  const asked = await callPort(
    () => settings.store.documents({ ...query, collation: settings.collation }, page, { signal }),
    signal,
  );
  if (asked === undefined) return internalError();
  const answer = parseWith(pageSchema, asked.value, "The answer of FrameworkStore.documents");
  if (answer.documents.length > page.limit) {
    throw new DataError(
      `The answer of FrameworkStore.documents has ${answer.documents.length} documents for a limit of ${page.limit}: it must return at most the limit.`,
    );
  }
  const listed: CFDocumentSet = { CFDocuments: answer.documents };
  const { CFDocuments } = version === "1.1" ? listed : convertCaseVersion(listed, "1.0").value;
  const { fields } = query;
  const documents = fields === undefined ? CFDocuments : CFDocuments.map((each) => selectFields(each, fields));
  return buildJsonResponse(
    200,
    { CFDocuments: documents },
    { "x-total-count": String(answer.total), link: buildPageLinks(request.url, page, { total: answer.total }) },
  );
}

/** Answers a request for one object by identifier (REST binding 2.1 and 2.4). */
async function answerEntity(
  route: Extract<Route, { kind: "entity" }>,
  settings: ProviderSettings,
): Promise<HttpResponse> {
  if (!isUuid(route.id)) return invalidUuid();
  const { signal } = settings;
  const asked = await callPort(() => route.lookup(settings.store, route.id, { signal }), signal);
  if (asked === undefined) return internalError();
  const found = parseWith(lookupSchema, asked.value, "The answer of FrameworkStore");
  const converted = found === undefined ? undefined : inVersion(found, route.version);
  return converted === undefined ? unknownObject() : buildJsonResponse(200, converted);
}

/**
 * Answers a request of the CASE REST binding: the twelve endpoints under `/ims/case/v1p1`, and `/ims/case/v1p0` when the
 * provider serves it, over a `FrameworkStore`.
 *
 * @remarks
 * Only GET is served (405 for another method). `/CFDocuments` takes `limit`, `offset`, `sort`, `orderBy`, `filter` and
 * `fields`; the other endpoints take no parameters. The answers are the entities of the model, in the form of the version of
 * the path, with `imsx_StatusInfo` for every failure: 400 for a filter or a list of fields that cannot be used, or a `limit`
 * or `offset` that is not a whole number, 401, 403 and 429 from `authorize`, 404 for an unknown path, an unknown identifier and
 * an identifier that is not a UUID, 405, and 500 when the store or `authorize` rejects. The list of documents sends the
 * number that match in `X-Total-Count` and the first, previous, next and last pages in `Link`. A page past the end, and a
 * list with no match, are an empty `CFDocuments`, which the schema does not allow but a consumer that pages needs. On the 1.0
 * path an association that 1.0 cannot say, and the associations of an item when none of them can be said, are 404.
 *
 * The URL of the request is the one the consumer used, so a host behind a proxy builds the request from the public address.
 * The handler keeps no state and reads no clock.
 *
 * @param request - The request.
 * @param options - The store, the discovery document and the settings.
 * @returns The answer.
 * @throws `DataError` when the request or the options have the wrong type, or when the store answers with something other
 * than its contract: an object or `undefined` for an identifier, and for the list at most `limit` objects and a whole
 * `total`.
 * @throws The reason of the `signal` of the options, when it aborts before the answer is ready.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1}
 */
export async function handleCaseRequest(request: HttpRequest, options: CaseProviderOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  const settings = readProviderOptions(options);
  const route = routeOf(new URL(request.url).pathname, settings);
  if (route === undefined) return unknownObject();
  if (request.method !== "GET") return methodNotAllowed(request.method);
  if (route.kind === "discovery") return buildJsonResponse(200, settings.discovery);
  const refusal = await refusalOf(request, settings);
  if (refusal !== undefined) return refusal;
  return route.kind === "documents" ? answerDocuments(request, route.version, settings) : answerEntity(route, settings);
}
