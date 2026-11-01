import type { CallOptions } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { CFDocument, OpenApiDocument } from "../src/index.js";
import {
  type CaseProviderOptions,
  type FrameworkStore,
  handleCaseRequest,
  queryEntities,
} from "../src/provider/index.js";
import { fullEntities, fullPackage, id } from "./full-package.js";

export const ORIGIN = "https://case.example.org";
export const V11 = "/ims/case/v1p1";
export const V10 = "/ims/case/v1p0";

/** The OpenAPI document of a provider in a test: the three parts that are checked, and a template for the servers. */
export const DISCOVERY: OpenApiDocument = {
  openapi: "3.0.0",
  info: { title: "CASE", version: "1.1" },
  servers: [{ url: "https://{hostName}{basePath}" }],
  paths: { "/CFDocuments": {} },
};

/** What a request in a test may set. */
export interface RequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** A request to the provider. */
export function request(path: string, init: RequestInit = {}): HttpRequest {
  return { method: init.method ?? "GET", url: `${ORIGIN}${path}`, headers: init.headers ?? {}, body: new Uint8Array() };
}

/** Returns the JSON that an answer carries. */
export function jsonOf(response: HttpResponse): unknown {
  return JSON.parse(String(response.body));
}

/** The documents of a store in a test: the full document, and four that differ in the fields that queries use. */
export function documents(): readonly CFDocument[] {
  const base = fullEntities().CFDocument;
  const variant = (number: number, changes: Partial<CFDocument>): CFDocument => ({
    ...base,
    identifier: id(100 + number),
    uri: `https://case.example.edu/ims/case/v1p1/CFDocuments/${id(100 + number)}`,
    ...changes,
  });
  return [
    base,
    variant(1, {
      title: "Zebra studies",
      creator: "Ministry",
      lastChangeDateTime: "2024-07-01T00:00:00+00:00",
      subject: ["Biology"],
      adoptionStatus: "Draft",
    }),
    variant(2, {
      title: "apple basics",
      creator: "Ministry",
      lastChangeDateTime: "2023-01-01T00:00:00+00:00",
      subject: ["Biology", "Chemistry"],
      adoptionStatus: "Retired",
    }),
    variant(3, {
      title: "Älg i skogen",
      creator: "Agency",
      lastChangeDateTime: "2024-06-13T23:00:00+05:00",
      subject: ["Biology", "Mathematics"],
    }),
    variant(4, {
      title: "Mathematics 2",
      creator: "Agency",
      lastChangeDateTime: "2022-12-31T23:59:59-08:00",
      statusStartDate: "2022-01-01",
    }),
  ];
}

/** What a store in a test was asked. */
export interface Asked {
  readonly method: string;
  readonly argument: unknown;
  readonly signal: AbortSignal | undefined;
}

/** A store over the full package, the entities of the full package and a list of documents, that records what it is asked. */
export function memoryStore(list: readonly CFDocument[] = documents(), asked: Asked[] = []): FrameworkStore {
  const e = fullEntities();
  const pkg = fullPackage();
  const answer = <T>(method: string, argument: unknown, options: CallOptions | undefined, value: T): Promise<T> => {
    asked.push({ method, argument, signal: options?.signal });
    return Promise.resolve(value);
  };
  const when = <T>(matches: boolean, value: T): T | undefined => (matches ? value : undefined);
  return {
    documents: (query, page, options) => {
      const found = queryEntities(list, query);
      const slice = found.slice(page.offset, page.offset + page.limit);
      return answer("documents", { query, page }, options, { documents: slice, total: found.length });
    },
    document: (key, options) =>
      answer(
        "document",
        key,
        options,
        list.find((each) => each.identifier === key),
      ),
    package: (key, options) => answer("package", key, options, when(key === pkg.CFDocument.identifier, pkg)),
    item: (key, options) => answer("item", key, options, when(key === e.CFItem.identifier, e.CFItem)),
    itemAssociations: (key, options) =>
      answer("itemAssociations", key, options, when(key === e.CFAssociationSet.CFItem.identifier, e.CFAssociationSet)),
    association: (key, options) =>
      answer("association", key, options, when(key === e.CFAssociation.identifier, e.CFAssociation)),
    associationGrouping: (key, options) =>
      answer(
        "associationGrouping",
        key,
        options,
        when(key === e.CFAssociationGrouping.identifier, e.CFAssociationGrouping),
      ),
    concept: (key, options) => answer("concept", key, options, when(key === e.CFConcept.identifier, e.CFConceptSet)),
    subject: (key, options) => answer("subject", key, options, when(key === e.CFSubject.identifier, e.CFSubjectSet)),
    license: (key, options) => answer("license", key, options, when(key === e.CFLicense.identifier, e.CFLicense)),
    itemType: (key, options) =>
      answer("itemType", key, options, when(key === e.CFItemType.identifier, e.CFItemTypeSet)),
    rubric: (key, options) => answer("rubric", key, options, when(key === e.CFRubric.identifier, e.CFRubric)),
  };
}

/** Sends a request to a provider over the store of the test, with the options that the test changes. */
export function serve(
  path: string,
  options: Partial<CaseProviderOptions> = {},
  init?: RequestInit,
): Promise<HttpResponse> {
  return handleCaseRequest(request(path, init), { store: memoryStore(), discovery: DISCOVERY, ...options });
}
