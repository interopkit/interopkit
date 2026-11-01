import { ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { identifierOf } from "../src/identifiers.ts";
import { MATHEMATICS, MINISTRY_ORIGIN, mathematics2024, READING } from "../src/ministry.ts";
import { ministry } from "./ministry-fixture.ts";

const id = identifierOf;

describe("the provider of the example", () => {
  it("answers each of the twelve calls of the client with what the catalog holds", async () => {
    const { client } = ministry();
    const held = mathematics2024();
    expect((await client.package(id(MATHEMATICS.document)))?.CFItems).toHaveLength(held.CFItems?.length ?? -1);
    expect((await client.document(id(MATHEMATICS.document)))?.CFPackageURI?.uri).toBe(
      `${MINISTRY_ORIGIN}/ims/case/v1p1/CFPackages/${id(MATHEMATICS.document)}`,
    );
    expect((await client.item(id(MATHEMATICS.numberLine)))?.CFDocumentURI.identifier).toBe(id(MATHEMATICS.document));
    expect((await client.association(id(23)))?.associationType).toBe("isChildOf");
    expect((await client.associationGrouping(id(MATHEMATICS.structure)))?.title).toBe("Structure");
    expect((await client.license(id(MATHEMATICS.license)))?.title).toBe("CC BY 4.0");
    expect((await client.rubric(id(MATHEMATICS.rubric)))?.CFRubricCriteria).toHaveLength(1);
    expect((await client.discovery()).paths).toHaveProperty("/CFDocuments");
    expect(await client.concept(id(MATHEMATICS.concept))).toBeDefined();
    expect(await client.subject(id(MATHEMATICS.subject))).toBeDefined();
    expect(await client.itemType(id(MATHEMATICS.domainType))).toBeDefined();
    const titles: string[] = [];
    for await (const document of client.documents()) titles.push(document.title);
    expect(titles).toHaveLength(2);
  });

  it("answers a concept, a subject and an item type with the entity and its children", async () => {
    const { client } = ministry();
    expect((await client.concept(id(MATHEMATICS.concept)))?.CFConcepts.map(({ title }) => title)).toStrictEqual([
      "Fractions",
      "Unit fractions",
    ]);
    expect((await client.subject(id(MATHEMATICS.subject)))?.CFSubjects.map(({ title }) => title)).toStrictEqual([
      "Mathematics",
      "Arithmetic",
    ]);
    expect((await client.itemType(id(MATHEMATICS.standardType)))?.CFItemTypes.map(({ title }) => title)).toStrictEqual([
      "Standard",
    ]);
  });

  it("answers an item with every association that has it at either end", async () => {
    const { client } = ministry();
    const set = await client.itemAssociations(id(MATHEMATICS.numberLine));
    expect(set?.CFItem.identifier).toBe(id(MATHEMATICS.numberLine));
    expect(set?.CFAssociations.map(({ identifier }) => identifier)).toStrictEqual([23, 26, 27, 28].map(id));
  });

  it("answers an identifier in either case", async () => {
    const { client } = ministry();
    expect((await client.item(id(MATHEMATICS.numberLine).toUpperCase()))?.humanCodingScheme).toBe("NF.2");
  });

  it("answers an unknown identifier with undefined, and a path that is not an identifier with 404 Invalid UUID", async () => {
    const { client, provider } = ministry();
    expect(await client.item(id(9999))).toBeUndefined();
    const response = await provider.handle({
      method: "GET",
      url: `${MINISTRY_ORIGIN}/ims/case/v1p1/CFItems/not-an-identifier`,
      headers: {},
      body: new Uint8Array(),
    });
    expect(response.status).toBe(404);
    expect(JSON.parse(String(response.body))).toMatchObject({ imsx_description: expect.stringContaining("UUID") });
  });

  it("serves a framework published again under the new edition, and no longer the old", async () => {
    const { client, catalog } = ministry();
    const before = await client.document(id(MATHEMATICS.document));
    catalog.publish({ ...mathematics2024(), CFDocument: { ...mathematics2024().CFDocument, version: "next" } });
    expect((await client.document(id(MATHEMATICS.document)))?.version).toBe("next");
    expect(before?.version).toBe("2024");
  });

  it("serves both versions at their own paths, and only 1.1 when it is asked to", async () => {
    const both = ministry();
    expect(await both.client.document(id(READING.document))).toBeDefined();
    const only = ministry({ versions: ["1.1"] });
    const legacy = await only.provider.handle({
      method: "GET",
      url: `${MINISTRY_ORIGIN}/ims/case/v1p0/CFDocuments`,
      headers: {},
      body: new Uint8Array(),
    });
    expect(legacy.status).toBe(404);
  });

  it("asks for the credential on every call but the discovery file, when it has a token", async () => {
    const { client, provider } = ministry({ token: "secret" });
    await expect(client.document(id(MATHEMATICS.document))).rejects.toMatchObject({ status: 401 });
    expect((await client.discovery()).paths).toHaveProperty("/CFDocuments");
    const response = await provider.handle({
      method: "GET",
      url: `${MINISTRY_ORIGIN}/ims/case/v1p1/CFDocuments`,
      headers: { authorization: "Bearer secret" },
      body: new Uint8Array(),
    });
    expect(response.status).toBe(200);
  });

  it("refuses a method other than GET", async () => {
    const { provider } = ministry();
    const response = await provider.handle({
      method: "POST",
      url: `${MINISTRY_ORIGIN}/ims/case/v1p1/CFDocuments`,
      headers: {},
      body: new Uint8Array(),
    });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe("GET");
  });

  it("ends a call when the signal aborts, with the reason of the signal", async () => {
    const { client } = ministry();
    const reason = new Error("Cancelled by the user.");
    await expect(client.package(id(MATHEMATICS.document), { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
  });

  it("answers 500 without the cause when the store fails", async () => {
    const { catalog, provider } = ministry();
    const failing = { ...catalog.store, package: () => Promise.reject(new Error("The disk is on fire.")) };
    const response = await provider.handle(
      {
        method: "GET",
        url: `${MINISTRY_ORIGIN}/ims/case/v1p1/CFPackages/${id(1)}`,
        headers: {},
        body: new Uint8Array(),
      },
      {},
    );
    expect(response.status).toBe(200);
    const broken = ministry({ catalog: { ...catalog, store: failing } });
    const error = await broken.client.package(id(1)).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 500 });
    expect(String((error as ServiceError).body)).not.toContain("disk");
  });
});
