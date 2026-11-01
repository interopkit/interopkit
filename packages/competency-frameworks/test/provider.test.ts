import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { handleCaseRequest } from "../src/provider/index.js";
import { fullEntities, fullPackage, id } from "./full-package.js";
import { type Asked, DISCOVERY, documents, jsonOf, memoryStore, request, serve, V10, V11 } from "./provider-fixture.js";

const entities = fullEntities();
const pkg = fullPackage();
/** The twelve endpoints, each with the identifier the store holds and what it answers, as the REST binding says. */
const ENDPOINTS: readonly [string, string, unknown][] = [
  ["CFPackages", id(1), pkg],
  ["CFDocuments", id(1), documents()[0]],
  ["CFItems", id(2), entities.CFItem],
  ["CFItemAssociations", id(2), entities.CFAssociationSet],
  ["CFAssociations", id(30), entities.CFAssociation],
  ["CFAssociationGroupings", id(14), entities.CFAssociationGrouping],
  ["CFConcepts", id(10), entities.CFConceptSet],
  ["CFSubjects", id(11), entities.CFSubjectSet],
  ["CFLicenses", id(12), entities.CFLicense],
  ["CFItemTypes", id(13), entities.CFItemTypeSet],
  ["CFRubrics", id(20), entities.CFRubric],
];

describe("the endpoints at /ims/case/v1p1", () => {
  it.each(ENDPOINTS)("%s serves the object of the store with the identifier", async (endpoint, key, expected) => {
    const response = await serve(`${V11}/${endpoint}/${key}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(jsonOf(response)).toStrictEqual(JSON.parse(JSON.stringify(expected)));
  });

  it("serves a concept, a subject and an item type with their sets", async () => {
    expect(jsonOf(await serve(`${V11}/CFConcepts/${id(10)}`))).toHaveProperty("CFConcepts");
    expect(jsonOf(await serve(`${V11}/CFSubjects/${id(11)}`))).toHaveProperty("CFSubjects");
    expect(jsonOf(await serve(`${V11}/CFItemTypes/${id(13)}`))).toHaveProperty("CFItemTypes");
  });

  it("serves the list of documents as a set", async () => {
    const response = await serve(`${V11}/CFDocuments`);
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual({ CFDocuments: JSON.parse(JSON.stringify(documents())) });
  });

  it("asks the store for the identifier of the path, with the signal of the options", async () => {
    const asked: Asked[] = [];
    const controller = new AbortController();
    await handleCaseRequest(request(`${V11}/CFItems/${id(2)}`), {
      store: memoryStore(documents(), asked),
      discovery: DISCOVERY,
      signal: controller.signal,
    });
    expect(asked).toStrictEqual([{ method: "item", argument: id(2), signal: controller.signal }]);
  });

  it("answers 404 Unknown Object for an identifier that the store does not hold", async () => {
    const response = await serve(`${V11}/CFItems/${id(99)}`);
    expect(response.status).toBe(404);
    expect(jsonOf(response)).toStrictEqual({
      imsx_codeMajor: "failure",
      imsx_severity: "error",
      imsx_description: "Unknown Object",
      imsx_codeMinor: {
        imsx_codeMinorField: [
          { imsx_codeMinorFieldName: "TargetEndSystem", imsx_codeMinorFieldValue: "unknownobject" },
        ],
      },
    });
  });

  it("answers 404 Invalid UUID, without asking the store, for an identifier that is not a UUID", async () => {
    const asked: Asked[] = [];
    const response = await handleCaseRequest(request(`${V11}/CFItems/not-a-uuid`), {
      store: memoryStore(documents(), asked),
      discovery: DISCOVERY,
    });
    expect(response.status).toBe(404);
    expect(jsonOf(response)).toMatchObject({
      imsx_description: "Invalid UUID",
      imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldValue: "invalid_uuid" }] },
    });
    expect(asked).toStrictEqual([]);
  });

  it("passes an identifier in upper case to the store as it is", async () => {
    const asked: Asked[] = [];
    await handleCaseRequest(request(`${V11}/CFItems/${id(2).toUpperCase()}`), {
      store: memoryStore(documents(), asked),
      discovery: DISCOVERY,
    });
    expect(asked.map(({ argument }) => argument)).toStrictEqual([id(2).toUpperCase()]);
  });

  it("ignores query parameters on the endpoints that have none", async () => {
    const response = await serve(`${V11}/CFItems/${id(2)}?filter=bad&limit=0&fields=`);
    expect(response.status).toBe(200);
  });
});

describe("the paths", () => {
  it.each([
    ["a path outside the API", "/other"],
    ["the API root", V11],
    ["the API root with a slash", `${V11}/`],
    ["an endpoint that does not exist", `${V11}/CFThings/${id(1)}`],
    ["a path with more segments", `${V11}/CFItems/${id(2)}/extra`],
    ["the list of documents with a slash", `${V11}/CFDocuments/`],
    ["an endpoint with the name of one object", `${V11}/CFItem/${id(2)}`],
    ["a path that begins like the API", `/x${V11}/CFItems/${id(2)}`],
    ["the discovery path of another file", `${V11}/discovery/other.json`],
    ["the 1.0 root when only 1.1 is served", `${V10}/CFItems/${id(2)}`],
  ])("answers 404 for %s", async (_, path) => {
    const response = await serve(path);
    expect(response.status).toBe(404);
    expect(jsonOf(response)).toMatchObject({ imsx_codeMajor: "failure", imsx_description: expect.any(String) });
  });

  it("answers 404 for the 1.1 root when only 1.0 is served", async () => {
    expect((await serve(`${V11}/CFItems/${id(2)}`, { versions: ["1.0"] })).status).toBe(404);
  });

  it("serves both roots when both versions are asked for", async () => {
    const options = { versions: ["1.0", "1.1"] } as const;
    expect((await serve(`${V10}/CFItems/${id(2)}`, options)).status).toBe(200);
    expect((await serve(`${V11}/CFItems/${id(2)}`, options)).status).toBe(200);
  });

  it("serves below the base path and nowhere else", async () => {
    expect((await serve(`/case${V11}/CFItems/${id(2)}`, { basePath: "/case" })).status).toBe(200);
    expect((await serve(`/a/b${V11}/CFItems/${id(2)}`, { basePath: "/a/b" })).status).toBe(200);
    expect((await serve(`${V11}/CFItems/${id(2)}`, { basePath: "/case" })).status).toBe(404);
    expect((await serve(`/casework${V11}/CFItems/${id(2)}`, { basePath: "/case" })).status).toBe(404);
  });

  it.each(["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])(
    "answers 405 with Allow: GET for %s",
    async (method) => {
      const response = await serve(`${V11}/CFItems/${id(2)}`, {}, { method });
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET");
      expect(jsonOf(response)).toMatchObject({ imsx_codeMajor: "failure", imsx_severity: "error" });
    },
  );

  it("answers 404 and not 405 for a method on a path that is no endpoint", async () => {
    expect((await serve("/other", {}, { method: "POST" })).status).toBe(404);
  });
});

describe("the endpoints at /ims/case/v1p0", () => {
  const both = { versions: ["1.0", "1.1"] } as const;

  it("serves the form of 1.0: what 1.1 added is left out", async () => {
    const document = jsonOf(await serve(`${V10}/CFDocuments/${id(1)}`, both));
    expect(document).not.toHaveProperty("frameworkType");
    expect(document).not.toHaveProperty("caseVersion");
    expect(document).not.toHaveProperty("extensions");
    expect(document).toMatchObject({ identifier: id(1), title: "Mathematics", creator: "Ministry of Education" });
    const item = jsonOf(await serve(`${V10}/CFItems/${id(2)}`, both));
    expect(item).not.toHaveProperty("subject");
    expect(item).not.toHaveProperty("subjectURI");
    expect(item).toMatchObject({ identifier: id(2), humanCodingScheme: "NF" });
  });

  it("serves a package without the properties of 1.1 and the associations that 1.0 cannot say", async () => {
    const body = jsonOf(await serve(`${V10}/CFPackages/${id(1)}`, both)) as {
      CFDocument: object;
      CFAssociations: { associationType: string }[];
    };
    expect(body.CFDocument).not.toHaveProperty("caseVersion");
    expect(body.CFAssociations.every(({ associationType }) => associationType !== "isTranslationOf")).toBe(true);
  });

  it("serves the list of documents in the form of 1.0", async () => {
    const body = jsonOf(await serve(`${V10}/CFDocuments`, both)) as { CFDocuments: object[] };
    expect(body.CFDocuments).toHaveLength(5);
    for (const document of body.CFDocuments) expect(document).not.toHaveProperty("frameworkType");
  });

  it("answers 404 for an association that 1.0 cannot say", async () => {
    const translation = { ...entities.CFAssociation, associationType: "isTranslationOf" as const };
    const store = { ...memoryStore(), association: () => Promise.resolve(translation) };
    const options = { store, discovery: DISCOVERY, versions: ["1.0", "1.1"] } as const;
    const at10 = await handleCaseRequest(request(`${V10}/CFAssociations/${id(30)}`), options);
    expect(at10.status).toBe(404);
    expect(jsonOf(at10)).toMatchObject({ imsx_description: "Unknown Object" });
    expect((await handleCaseRequest(request(`${V11}/CFAssociations/${id(30)}`), options)).status).toBe(200);
  });

  it("answers 404 for the associations of an item when 1.0 can say none of them", async () => {
    const translation = { ...entities.CFAssociation, associationType: "isTranslationOf" as const };
    const only = { CFItem: entities.CFItem, CFAssociations: [translation] };
    const store = { ...memoryStore(), itemAssociations: () => Promise.resolve(only) };
    const response = await handleCaseRequest(request(`${V10}/CFItemAssociations/${id(2)}`), {
      store,
      discovery: DISCOVERY,
      versions: ["1.0"],
    });
    expect(response.status).toBe(404);
  });

  it("keeps the associations of an item that 1.0 can say", async () => {
    const translation = { ...entities.CFAssociation, associationType: "isTranslationOf" as const };
    const mixed = { CFItem: entities.CFItem, CFAssociations: [translation, entities.CFAssociation] };
    const store = { ...memoryStore(), itemAssociations: () => Promise.resolve(mixed) };
    const response = await handleCaseRequest(request(`${V10}/CFItemAssociations/${id(2)}`), {
      store,
      discovery: DISCOVERY,
      versions: ["1.0"],
    });
    expect((jsonOf(response) as { CFAssociations: unknown[] }).CFAssociations).toHaveLength(1);
  });

  it("answers 404 Invalid UUID and 404 Unknown Object on the path of 1.0 as on the path of 1.1", async () => {
    expect(jsonOf(await serve(`${V10}/CFItems/x`, both))).toMatchObject({ imsx_description: "Invalid UUID" });
    expect(jsonOf(await serve(`${V10}/CFItems/${id(99)}`, both))).toMatchObject({ imsx_description: "Unknown Object" });
  });
});

describe("service discovery", () => {
  const FILE = `${V11}/discovery/imscasev1p1_openapi3_v1p0.json`;

  it("serves the document of the options at the path of the binding", async () => {
    const response = await serve(FILE);
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual(DISCOVERY);
  });

  it("serves it below the base path", async () => {
    expect((await serve(`/case${FILE}`, { basePath: "/case" })).status).toBe(200);
    expect((await serve(FILE, { basePath: "/case" })).status).toBe(404);
  });

  it("serves it when both versions are served, and only at the path of 1.1", async () => {
    const both = { versions: ["1.0", "1.1"] } as const;
    expect((await serve(FILE, both)).status).toBe(200);
    expect((await serve(`${V10}/discovery/imscasev1p1_openapi3_v1p0.json`, both)).status).toBe(404);
    expect((await serve(`${V10}/discovery/imscasev1p0_openapi3_v1p0.json`, both)).status).toBe(404);
  });

  it("answers 404 when 1.1 is not served", async () => {
    expect((await serve(FILE, { versions: ["1.0"] })).status).toBe(404);
  });

  it("answers 405 for a method other than GET", async () => {
    expect((await serve(FILE, {}, { method: "POST" })).status).toBe(405);
  });
});

describe("the arguments", () => {
  const good = { store: memoryStore(), discovery: DISCOVERY };
  const path = `${V11}/CFItems/${id(2)}`;
  /** Calls the handler with the good options changed by the properties of a JSON object. */
  const withOptions = (json: string) => handleCaseRequest(request(path), { ...good, ...JSON.parse(json) });

  it.each([
    ["null options", "null"],
    ["a string for the options", '"options"'],
    ["an array for the options", "[]"],
    ["a number for the options", "5"],
  ])("refuses %s", async (_, json) => {
    await expect(handleCaseRequest(request(path), JSON.parse(json))).rejects.toThrow(DataError);
  });

  it("refuses options with no store and options with no discovery document", async () => {
    await expect(
      handleCaseRequest(request(path), JSON.parse('{"discovery":{"openapi":"3.0.0","info":{},"paths":{}}}')),
    ).rejects.toThrow('The provider options is invalid: missing the property "store".');
    await expect(
      handleCaseRequest(request(path), { store: memoryStore(), discovery: JSON.parse("null") }),
    ).rejects.toThrow("The provider options is invalid at discovery: expected an object");
  });

  it.each([
    ["an openapi that is not a version of 3", '{"discovery":{"openapi":"2.0","info":{},"paths":{}}}'],
    ["a discovery document with no paths", '{"discovery":{"openapi":"3.0.0","info":{}}}'],
    ["a discovery document with no info", '{"discovery":{"openapi":"3.0.0","paths":{}}}'],
  ])("refuses %s", async (_, json) => {
    await expect(withOptions(json)).rejects.toThrow(DataError);
  });

  it("refuses a store that lacks a method, and names the methods", async () => {
    const store = memoryStore();
    Reflect.deleteProperty(store, "rubric");
    await expect(handleCaseRequest(request(path), { store, discovery: DISCOVERY })).rejects.toThrow(
      /The provider options is invalid at store: expected an object with the functions documents, document, package.* and rubric, found an object\./u,
    );
  });

  it.each([
    ["an unknown option", '{"extra":1}'],
    ["a basePath that is a number", '{"basePath":1}'],
    ["a basePath with no slash at the start", '{"basePath":"case"}'],
    ["a basePath with a slash at the end", '{"basePath":"/case/"}'],
    ["a basePath with a query", '{"basePath":"/case?x"}'],
    ["versions that are not a list", '{"versions":"1.1"}'],
    ["no versions", '{"versions":[]}'],
    ["a version that CASE does not have", '{"versions":["2.0"]}'],
    ["a pageSize of 0", '{"pageSize":0}'],
    ["a pageSize that is a string", '{"pageSize":"10"}'],
    ["a pageSize that is not whole", '{"pageSize":1.5}'],
    ["a maxPageSize of 0", '{"maxPageSize":0}'],
    ["a collation that is a number", '{"collation":5}'],
    ["a collation that is not a language tag", '{"collation":"not a tag"}'],
    ["an empty collation", '{"collation":""}'],
    ["an authorize that is not a function", '{"authorize":"yes"}'],
    ["a signal that is not a signal", '{"signal":{}}'],
  ])("refuses %s in the options", async (_, json) => {
    await expect(withOptions(json)).rejects.toThrow(DataError);
  });

  it("names the option and what it must be", async () => {
    await expect(withOptions('{"pageSize":0}')).rejects.toThrow(
      "The provider options is invalid at pageSize: expected a value of at least 1, found 0.",
    );
    await expect(withOptions('{"collation":"not a tag"}')).rejects.toThrow(
      'The provider options is invalid at collation: expected a BCP 47 language tag such as "und" or "sv-SE", found "not a tag".',
    );
    await expect(withOptions('{"basePath":"case"}')).rejects.toThrow(
      'The provider options is invalid at basePath: expected "" or a path that starts with / and does not end with /, found "case".',
    );
  });

  it.each([
    ["null", "null"],
    ["a string", '"GET"'],
    ["an object with no url", '{"method":"GET","headers":{}}'],
  ])("refuses %s for the request", async (_, json) => {
    await expect(handleCaseRequest(JSON.parse(json), good)).rejects.toThrow(DataError);
  });

  it.each([
    ["a relative url", '{"url":"/x"}'],
    ["a body that is a string", '{"body":""}'],
    ["a method that is a number", '{"method":5}'],
    ["a header name in upper case", '{"headers":{"Accept":"x"}}'],
  ])("refuses a request with %s", async (_, json) => {
    await expect(handleCaseRequest({ ...request(path), ...JSON.parse(json) }, good)).rejects.toThrow(DataError);
  });
});
