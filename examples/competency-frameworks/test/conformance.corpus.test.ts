import { resolve } from "node:path";
import type { Schema } from "@cfworker/json-schema";
import type { CaseEntityKind, CasePackage, CaseVersion } from "@interopkit/competency-frameworks";
import { describe, expect, it } from "vitest";
import { officialClasses, officialValidator } from "../../../packages/competency-frameworks/test/official.ts";
import { readSchema, schemaValidator } from "../../../scripts/schema-oracle.ts";
import { createCatalog } from "../src/catalog.ts";
import { identifierOf } from "../src/identifiers.ts";
import { MATHEMATICS, MINISTRY_ORIGIN, mathematics2024, reading2024 } from "../src/ministry.ts";
import { createProvider } from "../src/provider.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const OPENAPI = readSchema(ROOT, "imscasev1p1_openapi3_v1p0.json") as unknown as {
  paths: Record<
    string,
    { get: { responses: Record<string, { content: { "application/json": { schema: unknown } } }> } }
  >;
  components: { schemas: Record<string, unknown> };
};
const ROOT_PATH = "/ims/case/v1p1";

const catalog = createCatalog(MINISTRY_ORIGIN);
catalog.publish(mathematics2024());
catalog.publish(reading2024());
const provider = createProvider({ catalog, origin: MINISTRY_ORIGIN, discovery: OPENAPI as never });

/** The identifier of an entity that the example holds, for each collection of the REST binding. */
const HELD: Readonly<Record<string, number>> = {
  CFAssociationGroupings: MATHEMATICS.structure,
  CFAssociations: 23,
  CFConcepts: MATHEMATICS.concept,
  CFDocuments: MATHEMATICS.document,
  CFItemAssociations: MATHEMATICS.numberLine,
  CFItemTypes: MATHEMATICS.domainType,
  CFItems: MATHEMATICS.numberLine,
  CFLicenses: MATHEMATICS.license,
  CFPackages: MATHEMATICS.document,
  CFRubrics: MATHEMATICS.rubric,
  CFSubjects: MATHEMATICS.subject,
};

/** The kind of the answer of each collection, which names its schema in the JSON schemas of both versions. */
const KINDS: Readonly<Record<string, CaseEntityKind | "package">> = {
  CFAssociationGroupings: "CFAssociationGrouping",
  CFAssociations: "CFAssociation",
  CFConcepts: "CFConceptSet",
  CFDocuments: "CFDocument",
  CFItemAssociations: "CFAssociationSet",
  CFItemTypes: "CFItemTypeSet",
  CFItems: "CFItem",
  CFLicenses: "CFLicense",
  CFPackages: "package",
  CFRubrics: "CFRubric",
  CFSubjects: "CFSubjectSet",
};

/** Asks the provider for a path and returns the status and the JSON of the answer. */
async function get(path: string): Promise<{ readonly status: number; readonly json: unknown }> {
  const response = await provider.handle({
    method: "GET",
    url: `${MINISTRY_ORIGIN}${path}`,
    headers: {},
    body: new Uint8Array(),
  });
  return { status: response.status, json: JSON.parse(String(response.body)) };
}

/** The validator of a schema of the OpenAPI document, which refers to the others as definitions. */
function openApiValidator(schema: unknown): (value: unknown) => boolean {
  const text = JSON.stringify({ ...(schema as object), definitions: OPENAPI.components.schemas });
  return schemaValidator(JSON.parse(text.replaceAll("#/components/schemas/", "#/definitions/")) as Schema, "7");
}

/** The collection and the parameter of a path of the OpenAPI document: `/CFItems/{sourcedId}` is `CFItems`. */
const collectionOf = (path: string): string => path.split("/")[1] ?? "";

describe("the answers of the example against the OpenAPI document of CASE 1.1", () => {
  const paths = Object.keys(OPENAPI.paths);

  it("holds an entity for every endpoint that the document describes", () => {
    expect(paths.filter((path) => path !== "/CFDocuments" && HELD[collectionOf(path)] === undefined)).toStrictEqual([]);
    expect(paths).toHaveLength(12);
  });

  it.each(paths)("answers %s with a body that the schema of its 200 response accepts", async (path) => {
    const identifier = identifierOf(HELD[collectionOf(path)] ?? 0);
    const { status, json } = await get(`${ROOT_PATH}${path.replace("{sourcedId}", identifier)}`);
    expect(status).toBe(200);
    const schema = OPENAPI.paths[path]?.get.responses["200"]?.content["application/json"].schema;
    expect(openApiValidator(schema)(json)).toBe(true);
  });

  it("serves the document itself as its discovery file, with the address of the provider as its server", async () => {
    const { status, json } = await get(`${ROOT_PATH}/discovery/imscasev1p1_openapi3_v1p0.json`);
    expect(status).toBe(200);
    expect((json as { servers: { url: string }[] }).servers).toStrictEqual([{ url: `${MINISTRY_ORIGIN}${ROOT_PATH}` }]);
    expect(Object.keys((json as { paths: object }).paths)).toStrictEqual(paths);
  });
});

describe.each(["1.1", "1.0"] as const)(
  "the answers of the example against the JSON schemas of CASE %s",
  (version: CaseVersion) => {
    const prefix = version === "1.1" ? ROOT_PATH : "/ims/case/v1p0";

    it.each(Object.keys(HELD))("answers %s with a body that the schema of the version accepts", async (collection) => {
      const identifier = identifierOf(HELD[collection] ?? 0);
      const { status, json } = await get(`${prefix}/${collection}/${identifier}`);
      expect(status).toBe(200);
      expect(officialValidator(version, KINDS[collection] ?? "package")(json)).toBe(true);
    });

    it("answers the list of documents with a body that the schema of the version accepts", async () => {
      const { status, json } = await get(`${prefix}/CFDocuments`);
      expect(status).toBe(200);
      expect(officialValidator(version, "CFDocumentSet")(json)).toBe(true);
    });
  },
);

/** The objects of a class in the package, or served outside it: the data that the properties of the class are found in. */
function objectsOf(
  pkg: CasePackage,
  served: Readonly<Record<string, readonly object[]>>,
): Readonly<Record<string, readonly object[]>> {
  const definitions = pkg.CFDefinitions;
  const rubrics = pkg.CFRubrics ?? [];
  const criteria = rubrics.flatMap((rubric) => rubric.CFRubricCriteria ?? []);
  const nodes = (pkg.CFAssociations ?? []).flatMap((association) => [
    association.originNodeURI,
    association.destinationNodeURI,
  ]);
  return {
    CFPackage: [pkg],
    CFPckgDocument: [pkg.CFDocument],
    CFPckgItem: pkg.CFItems ?? [],
    CFPckgAssociation: pkg.CFAssociations ?? [],
    CFDefinition: definitions === undefined ? [] : [definitions],
    CFConcept: definitions?.CFConcepts ?? [],
    CFSubject: definitions?.CFSubjects ?? [],
    CFLicense: definitions?.CFLicenses ?? [],
    CFItemType: definitions?.CFItemTypes ?? [],
    CFAssociationGrouping: definitions?.CFAssociationGroupings ?? [],
    CFRubric: rubrics,
    CFRubricCriterion: criteria,
    CFRubricCriterionLevel: criteria.flatMap((criterion) => criterion.CFRubricCriterionLevels ?? []),
    LinkGenURI: nodes,
    CFDocument: served.CFDocument ?? [],
    CFItem: served.CFItem ?? [],
    CFAssociation: served.CFAssociation ?? [],
  };
}

/** The classes of the schemas that are answers and not data, or are links that every class repeats. */
const NOT_DATA = new Set([
  "CFDocumentSet",
  "CFAssociationSet",
  "CFConceptSet",
  "CFSubjectSet",
  "CFItemTypeSet",
  "imsx_StatusInfo",
  "imsx_CodeMinor",
  "imsx_CodeMinorField",
  "LinkURI",
]);

describe("the properties of the classes of CASE 1.1 in the data of the example", () => {
  /** The data of the example as the provider serves it: the package, and each item and association by itself. */
  async function held() {
    const pkg = mathematics2024();
    const served = async (collection: string, identifiers: readonly string[]) =>
      Promise.all(
        identifiers.map(async (identifier) => (await get(`${ROOT_PATH}/${collection}/${identifier}`)).json as object),
      );
    return objectsOf(pkg, {
      CFDocument: await served("CFDocuments", [pkg.CFDocument.identifier]),
      CFItem: await served(
        "CFItems",
        (pkg.CFItems ?? []).map(({ identifier }) => identifier),
      ),
      CFAssociation: await served(
        "CFAssociations",
        (pkg.CFAssociations ?? []).map(({ identifier }) => identifier),
      ),
    });
  }

  it("maps every class of the schemas that holds data", async () => {
    const mapped = new Set(Object.keys(await held()));
    const classes = [...officialClasses("1.1")].filter(
      ([name, shape]) => shape.properties.length > 0 && !NOT_DATA.has(name),
    );
    expect(classes.map(([name]) => name).filter((name) => !mapped.has(name))).toStrictEqual([]);
  });

  it("has every property of every class in at least one object, so that a consumer sees each field", async () => {
    const data = await held();
    const missing: string[] = [];
    for (const [name, shape] of officialClasses("1.1")) {
      const objects = data[name];
      if (objects === undefined) continue;
      for (const property of shape.properties) {
        if (!objects.some((object) => Object.hasOwn(object, property))) missing.push(`${name}.${property}`);
      }
    }
    expect(missing).toStrictEqual([]);
  });
});
