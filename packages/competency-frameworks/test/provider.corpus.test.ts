import { resolve } from "node:path";
import type { Schema } from "@cfworker/json-schema";
import type { HttpResponse } from "@interopkit/core/http";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { schemaArbitrary } from "../../../scripts/schema-arbitrary.js";
import { readSchema, schemaValidator } from "../../../scripts/schema-oracle.js";
import { type CaseVersion, type CFDocument, toCaseVersion } from "../src/index.js";
import {
  type CaseProviderOptions,
  type FrameworkStore,
  handleCaseRequest,
  localizeOpenApi,
  queryEntities,
} from "../src/provider/index.js";
import { SCHEMAS } from "../src/read/internal.js";
import { id } from "./full-package.js";
import {
  ABSOLUTE_URI,
  DATE,
  DATE_TIME,
  EXTENSION_TERM,
  officialArbitrary,
  officialClasses,
  officialValidator,
} from "./official.js";
import { jsonOf, request, V10, V11 } from "./provider-fixture.js";

const ROOT = resolve(import.meta.dirname, "../../..");
/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_104, numRuns: 40 };
const OPENAPI = readSchema(ROOT, "imscasev1p1_openapi3_v1p0.json") as unknown as {
  paths: Record<string, { get: { parameters: { name: string; in: string }[]; responses: Record<string, unknown> } }>;
  components: { schemas: Record<string, unknown> };
};
const KEY = id(7);

/** The endpoints, each with the kind of its answer in the schemas of both versions. */
const ENDPOINTS = [
  { path: "/CFPackages/{sourcedId}", kind: "package", method: "package" },
  { path: "/CFDocuments/{sourcedId}", kind: "CFDocument", method: "document" },
  { path: "/CFItems/{sourcedId}", kind: "CFItem", method: "item" },
  { path: "/CFItemAssociations/{sourcedId}", kind: "CFAssociationSet", method: "itemAssociations" },
  { path: "/CFAssociations/{sourcedId}", kind: "CFAssociation", method: "association" },
  { path: "/CFAssociationGroupings/{sourcedId}", kind: "CFAssociationGrouping", method: "associationGrouping" },
  { path: "/CFConcepts/{sourcedId}", kind: "CFConceptSet", method: "concept" },
  { path: "/CFSubjects/{sourcedId}", kind: "CFSubjectSet", method: "subject" },
  { path: "/CFLicenses/{sourcedId}", kind: "CFLicense", method: "license" },
  { path: "/CFItemTypes/{sourcedId}", kind: "CFItemTypeSet", method: "itemType" },
  { path: "/CFRubrics/{sourcedId}", kind: "CFRubric", method: "rubric" },
] as const;

/** A schema of the OpenAPI document with the schemas it refers to, which a validator and a generator read as `definitions`. */
function withDefinitions(schema: unknown): Schema {
  const text = JSON.stringify({ ...(schema as object), definitions: OPENAPI.components.schemas });
  return JSON.parse(text.replaceAll("#/components/schemas/", "#/definitions/")) as Schema;
}

/** Drops the specification extensions of OpenAPI (`x-` and a name), which describe a schema and constrain no value. */
function withoutExtensions(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutExtensions);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([name]) => !name.startsWith("x-"))
      .map(([name, member]) => [name, withoutExtensions(member)]),
  );
}

/** The validator of a schema of the OpenAPI document. */
function openApiValidator(schema: unknown): (value: unknown) => boolean {
  return schemaValidator(withDefinitions(schema), "7");
}

/**
 * The patterns of the identifier and of an extension term in the OpenAPI document. The identifier is a lower-case UUID of
 * version 1 to 5, as in the schemas of 1.0, and a URI has the format `uri`: the document is stricter than the JSON schemas of 1.1.
 */
const IDENTIFIER_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5]{1}[0-9a-f]{3}-[8-9a-b]{1}[0-9a-f]{3}-[0-9a-f]{12}";
const EXTENSION_PATTERN = "(ext:)[a-zA-Z0-9\\.\\-_]+";

/** A generator of the values that the schema of a response in the OpenAPI document accepts. */
function responseValues(path: string): fc.Arbitrary<Record<string, unknown>> {
  const responses = OPENAPI.paths[path]?.get.responses as Record<
    string,
    { content: { "application/json": { schema: unknown } } }
  >;
  const schema = withoutExtensions(withDefinitions(responses["200"]?.content["application/json"].schema)) as Schema;
  return schemaArbitrary(schema, {
    formats: { uri: ABSOLUTE_URI, "date-time": DATE_TIME, date: DATE },
    patterns: { [IDENTIFIER_PATTERN]: fc.uuid({ version: [1, 2, 3, 4, 5] }), [EXTENSION_PATTERN]: EXTENSION_TERM },
  }).filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null);
}

/** The validator of the schema that the document gives to a status of an operation. */
function responseValidator(path: string, status: string): (value: unknown) => boolean {
  const responses = OPENAPI.paths[path]?.get.responses as Record<
    string,
    { content: { "application/json": { schema: unknown } } }
  >;
  const response = responses[status] ?? responses.default;
  if (response === undefined) throw new Error(`No response ${status} for ${path}.`);
  return openApiValidator(response.content["application/json"].schema);
}

/** A store that holds one object, which the test generated from a schema, at the identifier `KEY`. */
function holding(values: Partial<Record<string, unknown>>): FrameworkStore {
  const lookup = (name: string) => (key: string) => Promise.resolve(key === KEY ? values[name] : undefined);
  const list = values.documents as CFDocument[] | undefined;
  return {
    documents: (query, page) => {
      const found = queryEntities(list ?? [], query);
      return Promise.resolve({ documents: found.slice(page.offset, page.offset + page.limit), total: found.length });
    },
    document: lookup("document") as FrameworkStore["document"],
    package: lookup("package") as FrameworkStore["package"],
    item: lookup("item") as FrameworkStore["item"],
    itemAssociations: lookup("itemAssociations") as FrameworkStore["itemAssociations"],
    association: lookup("association") as FrameworkStore["association"],
    associationGrouping: lookup("associationGrouping") as FrameworkStore["associationGrouping"],
    concept: lookup("concept") as FrameworkStore["concept"],
    subject: lookup("subject") as FrameworkStore["subject"],
    license: lookup("license") as FrameworkStore["license"],
    itemType: lookup("itemType") as FrameworkStore["itemType"],
    rubric: lookup("rubric") as FrameworkStore["rubric"],
  };
}

const DISCOVERY = localizeOpenApi(OPENAPI as never, { serverUrl: `https://case.example.org${V11}` });
const both = { versions: ["1.0", "1.1"] } as const;
const serving = (store: FrameworkStore, extra: Partial<CaseProviderOptions> = {}) => ({
  store,
  discovery: DISCOVERY,
  ...both,
  ...extra,
});
const get = (store: FrameworkStore, path: string, extra?: Partial<CaseProviderOptions>) =>
  handleCaseRequest(request(path), serving(store, extra));

describe("the answers of the provider against the OpenAPI document of CASE 1.1", () => {
  it.each(ENDPOINTS)("validates the answer of $path for objects the schema generates", ({ path, method }) =>
    fc.assert(
      fc.asyncProperty(responseValues(path), async (value) => {
        const response = await get(holding({ [method]: value }), `${V11}${path.replace("{sourcedId}", KEY)}`);
        expect(response.status).toBe(200);
        expect(jsonOf(response)).toStrictEqual(JSON.parse(JSON.stringify(value)));
        expect(responseValidator(path, "200")(jsonOf(response))).toBe(true);
      }),
      RUNS,
    ),
  );

  it("validates the answer for the list of documents, for a page and an empty page", () =>
    fc.assert(
      fc.asyncProperty(
        fc.array(responseValues("/CFDocuments/{sourcedId}"), { minLength: 1, maxLength: 4 }),
        async (documents) => {
          const store = holding({ documents });
          const page = await get(store, `${V11}/CFDocuments?limit=3`);
          expect(page.headers["x-total-count"]).toBe(String(documents.length));
          expect(responseValidator("/CFDocuments", "200")(jsonOf(page))).toBe(true);
        },
      ),
      RUNS,
    ));

  it("serves an empty page that the schema does not allow, because it requires one document", async () => {
    const response = await get(holding({ documents: [] }), `${V11}/CFDocuments`);
    expect(jsonOf(response)).toStrictEqual({ CFDocuments: [] });
    expect(responseValidator("/CFDocuments", "200")(jsonOf(response))).toBe(false);
  });

  it("validates the refusals that the document describes, and the status for a method it does not describe", async () => {
    const store = holding({});
    const refused = {
      "400": await get(store, `${V11}/CFDocuments?fields=`),
      "401": await get(store, `${V11}/CFItems/${KEY}`, {
        authorize: () => Promise.resolve({ allowed: false, status: 401 }),
      }),
      "403": await get(store, `${V11}/CFItems/${KEY}`, {
        authorize: () => Promise.resolve({ allowed: false, status: 403 }),
      }),
      "404": await get(store, `${V11}/CFItems/${KEY}`),
      "500": await get({ ...store, item: () => Promise.reject(new Error("x")) }, `${V11}/CFItems/${KEY}`),
    };
    for (const [status, response] of Object.entries(refused)) {
      expect(response.status).toBe(Number(status));
      const path = status === "400" ? "/CFDocuments" : "/CFItems/{sourcedId}";
      expect(responseValidator(path, status)(jsonOf(response)), `the answer ${status}`).toBe(true);
    }
    expect(responseValidator("/CFItems/{sourcedId}", "404")(jsonOf(await get(store, `${V11}/CFItems/x`)))).toBe(true);
    const post = await handleCaseRequest(request(`${V11}/CFItems/${KEY}`, { method: "POST" }), serving(store));
    expect(post.status).toBe(405);
    expect(responseValidator("/CFItems/{sourcedId}", "405")(jsonOf(post))).toBe(true);
  });

  it("answers an unreadable filter with a code that the schema does not list, and nothing else that it refuses", async () => {
    const response = await get(holding({}), `${V11}/CFDocuments?filter=nonsense%3D%27x%27`);
    const body = jsonOf(response) as {
      imsx_codeMinor: { imsx_codeMinorField: { imsx_codeMinorFieldValue: string }[] };
    };
    const codes = body.imsx_codeMinor.imsx_codeMinorField.map(
      ({ imsx_codeMinorFieldValue }) => imsx_codeMinorFieldValue,
    );
    expect(codes).toStrictEqual(["invalid_filter_field"]);
    const valid = responseValidator("/CFDocuments", "400");
    expect(valid(body)).toBe(false);
    const listed = {
      ...body,
      imsx_codeMinor: {
        imsx_codeMinorField: body.imsx_codeMinor.imsx_codeMinorField.map((field) => ({
          ...field,
          imsx_codeMinorFieldValue: "invalid_selection_field",
        })),
      },
    };
    expect(valid(listed)).toBe(true);
  });

  it("serves every path of the document, and no other, and takes the query parameters that it lists", async () => {
    const paths = Object.keys(OPENAPI.paths).sort();
    expect(paths).toStrictEqual([...ENDPOINTS.map(({ path }) => path), "/CFDocuments"].sort());
    for (const path of paths) {
      const { get: operation } = OPENAPI.paths[path] ?? { get: undefined };
      expect(Object.keys(OPENAPI.paths[path] ?? {})).toStrictEqual(["get"]);
      const names = operation?.parameters.filter(({ in: place }) => place === "query").map(({ name }) => name) ?? [];
      expect(names, path).toStrictEqual(
        path === "/CFDocuments" ? ["limit", "offset", "sort", "orderBy", "filter", "fields"] : [],
      );
    }
  });

  it("answers only with statuses that the document lists for the operation", () => {
    const listed = Object.keys(OPENAPI.paths["/CFItems/{sourcedId}"]?.get.responses ?? {});
    for (const status of [200, 400, 401, 403, 404, 500]) expect(listed).toContain(String(status));
    expect(listed).toContain("default");
  });

  it("serves the document that it was given at the path of the binding, with the server of the provider", async () => {
    const response = await get(holding({}), `${V11}/discovery/imscasev1p1_openapi3_v1p0.json`);
    const body = jsonOf(response) as { servers: unknown; paths: object };
    expect(body.servers).toStrictEqual([{ url: `https://case.example.org${V11}` }]);
    expect(Object.keys(body.paths)).toStrictEqual(Object.keys(OPENAPI.paths));
  });
});

describe.each(["1.0", "1.1"] as const)(
  "the documents of the provider against the CASE %s names",
  (version: CaseVersion) => {
    it("has the filter names that the official schema gives a CFDocument", async () => {
      const official = officialClasses(version).get("CFDocument")?.properties ?? [];
      const ours = Object.keys(SCHEMAS[version].classes.get("CFDocument") ?? {});
      expect(ours.sort()).toStrictEqual([...official].sort());
      const root = version === "1.0" ? V10 : V11;
      for (const name of official) {
        const response = await get(holding({}), `${root}/CFDocuments?fields=${name}`);
        expect(response.status).toBe(200);
      }
      const unknown = await get(holding({}), `${root}/CFDocuments?filter=${encodeURIComponent("CFItems='x'")}`);
      expect(unknown.status).toBe(400);
    });
  },
);

describe("the answers on the path of 1.0 against the schemas of 1.0", () => {
  it.each(ENDPOINTS)("validates the answer of $path for objects that 1.0 allows", ({ path, kind, method }) =>
    fc.assert(
      fc.asyncProperty(officialArbitrary("1.0", kind), async (value) => {
        const response = await get(holding({ [method]: value }), `${V10}${path.replace("{sourcedId}", KEY)}`);
        expect(response.status).toBe(200);
        expect(officialValidator("1.0", kind)(jsonOf(response))).toBe(true);
      }),
      RUNS,
    ),
  );

  it.each(ENDPOINTS)(
    "validates the answer of $path for objects of 1.1, which lose what 1.0 does not have",
    ({ path, kind, method }) =>
      fc.assert(
        fc.asyncProperty(responseValues(path), async (value) => {
          const response = await get(holding({ [method]: value }), `${V10}${path.replace("{sourcedId}", KEY)}`);
          const converted = toCaseVersion(value as never, "1.0");
          expect(converted.dropped.filter(({ rule }) => rule === "form-not-in-1.0")).toStrictEqual([]);
          if (converted.value === undefined) {
            expect(response.status).toBe(404);
          } else {
            expect(response.status).toBe(200);
            expect(officialValidator("1.0", kind)(jsonOf(response))).toBe(true);
          }
        }),
        RUNS,
      ),
  );

  it("validates the list of documents of 1.0", () =>
    fc.assert(
      fc.asyncProperty(
        fc.array(officialArbitrary("1.0", "CFDocument"), { minLength: 1, maxLength: 3 }),
        async (documents) => {
          const response = await get(holding({ documents }), `${V10}/CFDocuments`);
          expect(officialValidator("1.0", "CFDocumentSet")(jsonOf(response))).toBe(true);
        },
      ),
      RUNS,
    ));

  it("answers a status of 1.0 as the schema of 1.0 reads it", async () => {
    const valid = officialValidator("1.0", "imsx_StatusInfo");
    const answers: HttpResponse[] = [
      await get(holding({}), `${V10}/CFItems/${KEY}`),
      await get(holding({}), `${V10}/CFDocuments?fields=`),
      await get(holding({}), `${V10}/CFItems/${KEY}`, {
        authorize: () => Promise.resolve({ allowed: false, status: 403 }),
      }),
    ];
    for (const answer of answers) expect(valid(jsonOf(answer))).toBe(true);
  });

  it("spells two codes as the Information Model does, where the schema of 1.0 spells them in its own way", async () => {
    const valid = officialValidator("1.0", "imsx_StatusInfo");
    const unauthorized = jsonOf(
      await get(holding({}), `${V10}/CFItems/${KEY}`, {
        authorize: () => Promise.resolve({ allowed: false, status: 401 }),
      }),
    );
    const invalidUuid = jsonOf(await get(holding({}), `${V10}/CFItems/x`));
    const spelled = (body: unknown, from: string, to: string) => JSON.parse(JSON.stringify(body).replace(from, to));
    expect(valid(unauthorized)).toBe(false);
    expect(valid(spelled(unauthorized, "unauthorised_request", "unauthorisedrequest"))).toBe(true);
    expect(valid(invalidUuid)).toBe(false);
    expect(valid(spelled(invalidUuid, "invalid_uuid", "invaliduuid"))).toBe(true);
  });
});
