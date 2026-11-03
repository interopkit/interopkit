import {
  type CallOptions,
  DataError,
  hasNextPage,
  raceAbort,
  readAnswer,
  readAnswerJson,
  requestService,
  type ServiceResponse,
} from "@interopkit/core";
import { checkAbortSignal, checkRecord, describe, isRecord, MAX_JSON_DEPTH, parseWith } from "@interopkit/core/checks";
import type {
  CasePackage,
  CaseQuery,
  CFAssociation,
  CFAssociationGrouping,
  CFAssociationSet,
  CFConceptSet,
  CFDocument,
  CFItem,
  CFItemTypeSet,
  CFLicense,
  CFRubric,
  CFSubjectSet,
  OpenApiDocument,
} from "../model/index.js";
import { checkEndpointIdentifier, DISCOVERY_FILE, endpointUrl } from "../model/internal.js";
import { readEntity, readPackage, validateEntity } from "../read/index.js";
import { openApiSchema } from "../read/internal.js";
import { type CaseClientOptions, type Settings, settingsOf } from "./config.js";
import { queryString } from "./query.js";

/**
 * A document with the fields that a query asked for and its identifier, which the client asks for as well, and none of the
 * others unless they were asked for.
 */
export type SelectedDocument = Readonly<Partial<CFDocument>> & Pick<CFDocument, "identifier">;

/** The calls to a CASE provider: one for each of the twelve endpoints of the REST binding, and the discovery file. */
export interface CaseClient {
  /**
   * Lists the documents of the provider, page by page, as the iteration asks for them.
   *
   * @remarks
   * Each request asks for `pageSize` documents from the next offset. The iteration stops when the provider says that no
   * page follows (`X-Total-Count`, else the `Link` header, else a page shorter than the one asked for), or answers a page
   * that holds only documents already seen. A collection that changes between pages may repeat or skip a document; a
   * document seen twice is given once. With `fields`, the documents hold the fields asked for and `identifier`, which the
   * client adds to the fields because it tells the documents apart by it, and not every field that the class requires.
   *
   * @param query - How to sort, filter and select.
   * @param options - A `signal` that ends the whole iteration.
   * @throws `DataError` when the query is not valid, before any request.
   */
  documents(
    query: CaseQuery & { readonly fields: readonly string[] },
    options?: CallOptions,
  ): AsyncIterable<SelectedDocument>;
  /**
   * Lists the documents of the provider, whole.
   *
   * @param query - How to sort and filter.
   * @param options - A `signal` that ends the whole iteration.
   * @throws `DataError` when the query is not valid, before any request.
   */
  documents(
    query?: Omit<CaseQuery, "fields"> & { readonly fields?: undefined },
    options?: CallOptions,
  ): AsyncIterable<CFDocument>;
  /**
   * Lists the documents of the provider when the query may or may not select fields.
   *
   * @param query - How to sort, filter and select.
   * @param options - A `signal` that ends the whole iteration.
   * @throws `DataError` when the query is not valid, before any request.
   */
  documents(query?: CaseQuery, options?: CallOptions): AsyncIterable<CFDocument | SelectedDocument>;
  /** Fetches a document, or `undefined` when the provider does not know it. */
  document(id: string, options?: CallOptions): Promise<CFDocument | undefined>;
  /** Fetches the package of a framework, or `undefined` when the provider does not know it. */
  package(id: string, options?: CallOptions): Promise<CasePackage | undefined>;
  /** Fetches an item, or `undefined` when the provider does not know it. */
  item(id: string, options?: CallOptions): Promise<CFItem | undefined>;
  /** Fetches an item and its associations, or `undefined` when the provider does not know the item. */
  itemAssociations(id: string, options?: CallOptions): Promise<CFAssociationSet | undefined>;
  /** Fetches an association, or `undefined` when the provider does not know it. */
  association(id: string, options?: CallOptions): Promise<CFAssociation | undefined>;
  /** Fetches an association grouping, or `undefined` when the provider does not know it. */
  associationGrouping(id: string, options?: CallOptions): Promise<CFAssociationGrouping | undefined>;
  /** Fetches a concept and its child concepts, or `undefined` when the provider does not know it. */
  concept(id: string, options?: CallOptions): Promise<CFConceptSet | undefined>;
  /** Fetches a subject and its child subjects, or `undefined` when the provider does not know it. */
  subject(id: string, options?: CallOptions): Promise<CFSubjectSet | undefined>;
  /** Fetches a license, or `undefined` when the provider does not know it. */
  license(id: string, options?: CallOptions): Promise<CFLicense | undefined>;
  /** Fetches an item type and its child item types, or `undefined` when the provider does not know it. */
  itemType(id: string, options?: CallOptions): Promise<CFItemTypeSet | undefined>;
  /** Fetches a rubric, or `undefined` when the provider does not know it. */
  rubric(id: string, options?: CallOptions): Promise<CFRubric | undefined>;
  /**
   * Fetches the OpenAPI 3 file that the provider publishes for service discovery.
   *
   * @throws `DataError` when the client is configured for CASE 1.0, which defines no discovery file.
   */
  discovery(options?: CallOptions): Promise<OpenApiDocument>;
}

/** The name of the file that a provider publishes for discovery, below the path of the version (REST binding 2.5). */
const DISCOVERY_PATH = `discovery/${DISCOVERY_FILE}`;

/** Characters that a header value must not hold: they would end the header and start another. */
const HEADER_BREAK = /[\r\n\0]/u;

/** Checks the options of one call and returns the signal that ends it. */
function signalOf(options: unknown): AbortSignal | undefined {
  if (options === undefined) return undefined;
  checkRecord(options, "The options of a call must be an object");
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
  return options.signal;
}

/**
 * The most levels of an answer. The readers bound each extension to 64 levels below the object that holds it, so an answer that
 * they accept may nest deeper than 64, and none nests deeper than twice that.
 */
const MAX_ANSWER_DEPTH = 2 * MAX_JSON_DEPTH;

/** The name of the standard in a sentence about an answer that does not follow it. */
const STANDARD = "CASE";

/** Makes one GET request with the credential of the host, and returns the answers that `expect` lists. */
async function get(
  settings: Settings,
  url: string,
  expect: readonly number[],
  signal: AbortSignal | undefined,
): Promise<ServiceResponse> {
  const waiting = [settings.signal, signal].filter((each) => each !== undefined);
  const either = waiting.length === 0 ? undefined : AbortSignal.any(waiting);
  // The host's function gets the signal and should stop, but the wait of the caller ends when it aborts whether the function does or not.
  const authorization =
    settings.authorization === undefined
      ? undefined
      : await raceAbort(
          Promise.resolve(settings.authorization(either === undefined ? undefined : { signal: either })),
          { signal: either },
        );
  if (
    authorization !== undefined &&
    (typeof authorization !== "string" || authorization === "" || HEADER_BREAK.test(authorization))
  ) {
    throw new DataError(
      "The option authorization must return a non-empty header value without line breaks, or undefined.",
    );
  }
  const { fetch, timeoutMs, maxBytes } = settings;
  return requestService(
    { fetch, timeoutMs, signal: settings.signal },
    `The CASE provider at ${url}`,
    url,
    {
      method: "GET",
      headers:
        authorization === undefined ? { accept: "application/json" } : { accept: "application/json", authorization },
    },
    { maxBytes, expect, ...(signal === undefined ? {} : { signal }) },
  );
}

/** Creates the call that fetches one entity from the endpoint of a collection, and reads it with `read`. */
function endpoint<TValue>(settings: Settings, collection: string, read: (json: unknown) => TValue) {
  return async (id: string, options?: CallOptions): Promise<TValue | undefined> => {
    const signal = signalOf(options);
    checkEndpointIdentifier(id, "The identifier");
    const url = endpointUrl(settings.root, collection, id);
    const response = await get(settings, url, [200, 404], signal);
    if (response.status === 404) return undefined;
    const what = `The CASE provider at ${url}`;
    const json = readAnswerJson(response, what, { maxDepth: MAX_ANSWER_DEPTH, maxTokens: settings.maxTokens });
    return readAnswer(what, STANDARD, () => read(json));
  };
}

/**
 * Reads the documents of a page that asked for some fields: each must be a document, less what it was not asked to hold. The
 * client asks for the identifier with the fields, so a document without one is a fault of the answer.
 */
function readSelected(json: unknown, settings: Settings): SelectedDocument[] {
  const set = checkedSet(json);
  return set.map((document, at) => {
    const faults = validateEntity("CFDocument", document, { version: settings.version }).filter(
      ({ severity, rule, path }) => severity === "error" && (rule !== "missing-property" || path === "identifier"),
    );
    const [first] = faults;
    if (first !== undefined) {
      throw new DataError(
        `CFDocuments[${at}] is invalid${first.path === "" ? "" : ` at ${first.path}`}: ${first.message}`,
      );
    }
    // The validator has just found the identifier a string and every other property of the right form.
    return document as SelectedDocument;
  });
}

/** Checks that a page is an object with a list of documents, and returns the list. */
function checkedSet(json: unknown): readonly unknown[] {
  if (!isRecord(json) || !Array.isArray(json.CFDocuments)) {
    throw new DataError(`The answer must be an object with the list CFDocuments, found ${describe(json)}.`);
  }
  return json.CFDocuments;
}

/**
 * Adds `identifier` to the fields that a query selects: the iteration tells a document that it has given from a new one by
 * its identifier, so that it ends when a provider repeats a page.
 */
function withIdentifier(query: CaseQuery | undefined): CaseQuery | undefined {
  const fields = query?.fields;
  return fields === undefined || fields.includes("identifier")
    ? query
    : { ...query, fields: [...fields, "identifier"] };
}

/** The iteration of `documents`: one request per page, until the provider has no more. */
async function* pagesOfDocuments(
  settings: Settings,
  query: unknown,
  signal: AbortSignal | undefined,
): AsyncGenerator<CFDocument | SelectedDocument> {
  const selecting = isRecord(query) && query.fields !== undefined;
  const seen = new Set<string>();
  for (let offset = 0; ; ) {
    const url = `${endpointUrl(settings.root, "CFDocuments")}?${queryString(query, { limit: settings.pageSize, offset })}`;
    const response = await get(settings, url, offset === 0 ? [200] : [200, 404], signal);
    // A provider that has nothing more may answer 404 or an empty list for an offset past the end.
    if (response.status === 404) return;
    const what = `The CASE provider at ${url}`;
    const json = readAnswerJson(response, what, { maxDepth: MAX_ANSWER_DEPTH, maxTokens: settings.maxTokens });
    if (isRecord(json) && Array.isArray(json.CFDocuments) && json.CFDocuments.length === 0) return;
    const documents = readAnswer(what, STANDARD, () =>
      selecting
        ? readSelected(json, settings)
        : readEntity("CFDocumentSet", json, { version: settings.version }).CFDocuments,
    );
    const fresh = documents.filter(({ identifier }) => {
      const key = identifier.toLowerCase();
      return !seen.has(key) && seen.add(key);
    });
    yield* fresh;
    offset += documents.length;
    if (fresh.length === 0 || !hasNextPage(response.headers, offset, documents.length, settings.pageSize)) return;
  }
}

/**
 * Creates the client of a CASE provider, with a call for each of the twelve endpoints of the REST binding.
 *
 * @remarks
 * Every request is a GET over HTTPS through `requestService` of `@interopkit/core`: it follows no redirect, ends at
 * `timeoutMs`, reads at most `maxBytes`, and carries the `Authorization` that the host's function returns. The answers are
 * read with the readers of this package, so a value is in the model of CASE 1.1 whichever version the provider speaks. A
 * provider that answers 404 gives `undefined`; any other status that is not 200 is a `ServiceError` with its status, headers
 * and body, which `readStatusInfo` reads. Nothing is retried and nothing is kept between calls, so a client is safe to share.
 *
 * @param options - The provider's address, the `fetch` and the optional version, credential, limits and signal.
 * @returns The client.
 * @throws `DataError` when the options are not valid.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1, REST binding}
 */
export function createCaseClient(options: CaseClientOptions): CaseClient {
  const settings = settingsOf(options);
  const as = { version: settings.version };

  function documents(
    query: CaseQuery & { readonly fields: readonly string[] },
    options?: CallOptions,
  ): AsyncIterable<SelectedDocument>;
  function documents(
    query?: Omit<CaseQuery, "fields"> & { readonly fields?: undefined },
    options?: CallOptions,
  ): AsyncIterable<CFDocument>;
  function documents(query?: CaseQuery, options?: CallOptions): AsyncIterable<CFDocument | SelectedDocument>;
  function documents(query?: CaseQuery, options?: CallOptions): AsyncIterable<CFDocument | SelectedDocument> {
    const signal = signalOf(options);
    // The first page's parameters are written now, so that a query that is not valid fails before the iteration starts.
    queryString(query, { limit: settings.pageSize, offset: 0 });
    return pagesOfDocuments(settings, withIdentifier(query), signal);
  }

  return {
    documents,
    document: endpoint(settings, "CFDocuments", (json) => readEntity("CFDocument", json, as)),
    package: endpoint(settings, "CFPackages", (json) => readPackage(json, as)),
    item: endpoint(settings, "CFItems", (json) => readEntity("CFItem", json, as)),
    itemAssociations: endpoint(settings, "CFItemAssociations", (json) => readEntity("CFAssociationSet", json, as)),
    association: endpoint(settings, "CFAssociations", (json) => readEntity("CFAssociation", json, as)),
    associationGrouping: endpoint(settings, "CFAssociationGroupings", (json) =>
      readEntity("CFAssociationGrouping", json, as),
    ),
    concept: endpoint(settings, "CFConcepts", (json) => readEntity("CFConceptSet", json, as)),
    subject: endpoint(settings, "CFSubjects", (json) => readEntity("CFSubjectSet", json, as)),
    license: endpoint(settings, "CFLicenses", (json) => readEntity("CFLicense", json, as)),
    itemType: endpoint(settings, "CFItemTypes", (json) => readEntity("CFItemTypeSet", json, as)),
    rubric: endpoint(settings, "CFRubrics", (json) => readEntity("CFRubric", json, as)),
    async discovery(options) {
      const signal = signalOf(options);
      if (settings.version !== "1.1") {
        throw new DataError('CASE 1.0 defines no discovery file: create the client with the option version "1.1".');
      }
      const url = `${settings.root}/${DISCOVERY_PATH}`;
      const response = await get(settings, url, [200], signal);
      const what = `The CASE provider at ${url}`;
      const json = readAnswerJson(response, what, { maxDepth: MAX_ANSWER_DEPTH, maxTokens: settings.maxTokens });
      return readAnswer(what, STANDARD, () => parseWith(openApiSchema, json, "The OpenAPI document"));
    },
  };
}
