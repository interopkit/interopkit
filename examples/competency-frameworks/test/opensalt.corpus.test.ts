import type { CasePackage, CFPckgAssociation, CFPckgItem } from "@interopkit/competency-frameworks";
import { createCaseClient } from "@interopkit/competency-frameworks/client";
import { associationsOf, diffPackages } from "@interopkit/competency-frameworks/graph";
import { DataError, type Fetch, ServiceError } from "@interopkit/core";
import { beforeAll, describe, expect, it } from "vitest";
import { importFramework, OPENSALT_ORIGIN, type Session, signIn } from "../../../validation/opensalt/session.ts";
import { type Copies, changesBetween, outline, syncFrameworks } from "../src/consumer.ts";
import { identifierOf } from "../src/identifiers.ts";
import { MATHEMATICS, mathematics2025, READING } from "../src/ministry.ts";
import { ministry } from "./ministry-fixture.ts";

const REQUIRED = ["OPENSALT_URL", "OPENSALT_USER", "OPENSALT_PASSWORD"] as const;
const [BASE, USER, PASSWORD] = REQUIRED.map((name) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`The environment variable ${name} is not set: run pnpm opensalt.`);
  return value;
}) as [string, string, string];

/** The paths that the client asked OpenSALT for, in order. */
const asked: string[] = [];

/** A `fetch` for the client: its address is `https`, and OpenSALT listens on loopback, so each call is sent there. */
const toOpenSalt: Fetch = (url, init) => {
  const target = new URL(url);
  asked.push(`${target.pathname}${target.search}`);
  return fetch(`${BASE}${target.pathname}${target.search}`, {
    method: init.method,
    headers: init.headers,
    redirect: "manual",
    signal: init.signal,
  });
};

const client = createCaseClient({ baseUrl: OPENSALT_ORIGIN, fetch: toOpenSalt });
const id = identifierOf;

type Json = Record<string, unknown>;

/** The title that OpenSALT gives a node of an association that is not in the package. */
const EXTERNAL_TITLE = "destination node";

/** Sorts the keys of every object and the members of every list that has identifiers, so that only content is compared. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    const members = value.map(canonical);
    const keyed = members.every((member) => typeof member === "object" && member !== null && "identifier" in member);
    return keyed
      ? members.sort((a, b) => String((a as Json).identifier).localeCompare(String((b as Json).identifier)))
      : members;
  }
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => Reflect.get(value, key) !== undefined)
      .map((key) => [key, canonical(Reflect.get(value, key))]),
  );
}

/** Leaves out the extensions of the levels of a rubric, which OpenSALT reads as one object and the schema of CASE gives as a list. */
function withoutLevelExtensions(framework: CasePackage): CasePackage {
  return {
    ...framework,
    CFRubrics: (framework.CFRubrics ?? []).map((rubric) => ({
      ...rubric,
      CFRubricCriteria: (rubric.CFRubricCriteria ?? []).map((criterion) => ({
        ...criterion,
        CFRubricCriterionLevels: (criterion.CFRubricCriterionLevels ?? []).map(({ extensions: _, ...level }) => level),
      })),
    })),
  };
}

/**
 * What OpenSALT keeps of an imported package, written as the transformation of the package that was sent. It keeps every
 * identifier and address, and it:
 * - gives each item that has no status dates the dates of the document;
 * - keeps the type of an item only when the item links to it, and gives an association with no `sequenceNumber` the number 0;
 * - omits `targetType` when it is `CASE`, which is its default, on a node that the package holds, and gives a node that it
 *   does not hold the title "destination node", as it keeps no title for what it does not store;
 * - keeps only the concepts and subjects that the document or an item links to;
 * - keeps no `extensions` of the package or of its definitions;
 * - keeps no `rubricId` of a criterion and no `rubricCriterionId` of a level, since they sit inside what they name.
 */
function asOpenSaltKeeps(sent: CasePackage): CasePackage {
  const { statusStartDate, statusEndDate } = sent.CFDocument;
  const linked = new Set(
    [sent.CFDocument, ...(sent.CFItems ?? [])].flatMap((entity) =>
      ["conceptKeywordsURI" in entity ? entity.conceptKeywordsURI : undefined, ...(entity.subjectURI ?? [])].flatMap(
        (link) => (link === undefined ? [] : [link.identifier]),
      ),
    ),
  );
  const held = new Set([sent.CFDocument.identifier, ...(sent.CFItems ?? []).map(({ identifier }) => identifier)]);
  const node = <T extends { readonly identifier: string; readonly title: string; readonly targetType?: string }>(
    link: T,
  ) => {
    const { targetType, ...rest } = link;
    if (!held.has(link.identifier)) return { ...link, title: EXTERNAL_TITLE };
    return targetType === "CASE" ? rest : link;
  };
  const { extensions: _, ...definitions } = sent.CFDefinitions ?? {};
  const { extensions: __, ...kept } = sent;
  return {
    ...kept,
    CFItems: (sent.CFItems ?? []).map(
      ({ CFItemType, ...item }): CFPckgItem => ({
        ...item,
        ...(item.CFItemTypeURI === undefined ? {} : { CFItemType }),
        ...(statusStartDate === undefined ? {} : { statusStartDate: item.statusStartDate ?? statusStartDate }),
        ...(statusEndDate === undefined ? {} : { statusEndDate: item.statusEndDate ?? statusEndDate }),
      }),
    ),
    CFAssociations: (sent.CFAssociations ?? []).map(
      (association): CFPckgAssociation => ({
        ...association,
        sequenceNumber: association.sequenceNumber ?? 0,
        originNodeURI: node(association.originNodeURI),
        destinationNodeURI: node(association.destinationNodeURI),
      }),
    ),
    ...(sent.CFDefinitions === undefined
      ? {}
      : {
          CFDefinitions: {
            ...definitions,
            CFConcepts: (definitions.CFConcepts ?? []).filter(({ identifier }) => linked.has(identifier)),
            CFSubjects: (definitions.CFSubjects ?? []).filter(({ identifier }) => linked.has(identifier)),
          },
        }),
    ...(sent.CFRubrics === undefined
      ? {}
      : {
          CFRubrics: sent.CFRubrics.map((rubric) => ({
            ...rubric,
            CFRubricCriteria: (rubric.CFRubricCriteria ?? []).map(({ rubricId: _id, ...criterion }) => ({
              ...criterion,
              CFRubricCriterionLevels: (criterion.CFRubricCriterionLevels ?? []).map(
                ({ rubricCriterionId: _cid, ...level }) => level,
              ),
            })),
          })),
        }),
  } as CasePackage;
}

/** A package as the example's provider serves it, in the given edition of the mathematics framework. */
async function served(identifier: string, edition: "2024" | "2025" = "2024"): Promise<CasePackage> {
  const { client: ministryClient, catalog } = ministry();
  if (edition === "2025") catalog.publish(mathematics2025());
  const found = await ministryClient.package(identifier);
  if (found === undefined) throw new Error(`The example's provider has no package ${identifier}.`);
  return found;
}

let session: Session;
let sent: { mathematics: CasePackage; reading: CasePackage };
let imported: { mathematics: { status: number; body: string }; reading: { status: number; body: string } };

beforeAll(async () => {
  session = await signIn(BASE, USER, PASSWORD);
  sent = { mathematics: await served(id(MATHEMATICS.document)), reading: await served(id(READING.document)) };
  imported = {
    mathematics: await importFramework(BASE, session, JSON.stringify(withoutLevelExtensions(sent.mathematics))),
    reading: await importFramework(BASE, session, JSON.stringify(sent.reading)),
  };
});

describe("importing the frameworks that the example's provider serves into OpenSALT", () => {
  it("refuses a package with the extensions of a rubric level as the schema of CASE gives them, a list of objects", async () => {
    const answer = await importFramework(BASE, session, JSON.stringify(sent.mathematics));
    expect(answer.status).toBe(422);
    expect(JSON.parse(answer.body).error).toMatch(
      /^Object expected, \[\{"band":"excellent"\}\] received .*extensions/u,
    );
  });

  it("accepts the packages once those extensions are left out", () => {
    expect(imported.mathematics).toStrictEqual({ status: 200, body: JSON.stringify({ message: "Success" }) });
    expect(imported.reading).toStrictEqual({ status: 200, body: JSON.stringify({ message: "Success" }) });
  });
});

describe("the client reading OpenSALT", () => {
  it("lists the two frameworks, and asks for the next page with the offset because OpenSALT honors limit and offset", async () => {
    const paged = createCaseClient({ baseUrl: OPENSALT_ORIGIN, fetch: toOpenSalt, pageSize: 1 });
    asked.length = 0;
    const titles: string[] = [];
    for await (const document of paged.documents()) titles.push(document.title);
    expect(titles.sort()).toStrictEqual(["English Language Arts, Grade 3", "Mathematics, Grade 3"]);
    expect(asked).toStrictEqual([
      "/ims/case/v1p1/CFDocuments?limit=1&offset=0",
      "/ims/case/v1p1/CFDocuments?limit=1&offset=1",
    ]);
  });

  it("gets every document whatever the filter, because OpenSALT does not apply it", async () => {
    const titles: string[] = [];
    for await (const document of client.documents({
      filter: { field: "title", predicate: "~", value: "mathematics" },
    })) {
      titles.push(document.title);
    }
    expect(titles).toHaveLength(2);
  });

  it("reads the package with what was imported, apart from what OpenSALT adds and leaves out", async () => {
    const found = await client.package(id(MATHEMATICS.document));
    expect(canonical(found)).toStrictEqual(canonical(asOpenSaltKeeps(withoutLevelExtensions(sent.mathematics))));
    const diff = diffPackages(sent.mathematics, found ?? sent.mathematics);
    expect([diff.added.length, diff.removed.length, diff.replaced.length]).toStrictEqual([0, 0, 0]);
    expect(diff.changed.map(({ after }) => after.humanCodingScheme)).toStrictEqual([
      "NF.1",
      "NF.2",
      "NF.3",
      "MD",
      "MD.1",
    ]);
  });

  it("reads the package of the plain framework as it was imported", async () => {
    expect(canonical(await client.package(id(READING.document)))).toStrictEqual(
      canonical(asOpenSaltKeeps(sent.reading)),
    );
  });

  it("reads each entity by itself, with the link to its document", async () => {
    const item = await client.item(id(MATHEMATICS.numberLine));
    expect(item?.humanCodingScheme).toBe("NF.2");
    expect(item?.CFDocumentURI.identifier).toBe(id(MATHEMATICS.document));
    expect((await client.document(id(MATHEMATICS.document)))?.CFPackageURI?.identifier).toBe(id(MATHEMATICS.document));
    expect((await client.association(id(23)))?.CFDocumentURI?.identifier).toBe(id(MATHEMATICS.document));
    expect((await client.associationGrouping(id(MATHEMATICS.structure)))?.title).toBe("Structure");
    expect((await client.concept(id(MATHEMATICS.concept)))?.CFConcepts.map(({ title }) => title)).toStrictEqual([
      "Fractions",
    ]);
    expect((await client.subject(id(MATHEMATICS.subject)))?.CFSubjects.map(({ title }) => title)).toStrictEqual([
      "Mathematics",
    ]);
    expect((await client.license(id(MATHEMATICS.license)))?.title).toBe("CC BY 4.0");
    expect((await client.itemType(id(MATHEMATICS.domainType)))?.CFItemTypes.map(({ title }) => title)).toStrictEqual([
      "Domain",
    ]);
    expect((await client.rubric(id(MATHEMATICS.rubric)))?.CFRubricCriteria).toHaveLength(1);
  });

  it("answers an identifier it does not hold with undefined", async () => {
    expect(await client.item(id(9999))).toBeUndefined();
  });

  it("answers the associations of an item with a link to the document in each, which the schema of the set does not have", async () => {
    const error = await client.itemAssociations(id(MATHEMATICS.numberLine)).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain("CFDocumentURI");
  });

  it("leaves the associations of an item to the package, which holds the same ones as the provider's set", async () => {
    const found = await client.package(id(MATHEMATICS.document));
    const { origin, destination } = associationsOf(found ?? sent.mathematics, id(MATHEMATICS.numberLine));
    const fromProvider = await ministry().client.itemAssociations(id(MATHEMATICS.numberLine));
    expect([...origin, ...destination].map(({ identifier }) => identifier).sort()).toStrictEqual(
      (fromProvider?.CFAssociations ?? []).map(({ identifier }) => identifier).sort(),
    );
  });

  it("has no discovery file at the address of the binding", async () => {
    const error = await client.discovery().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 404 });
  });
});

describe("the client of CASE 1.0 reading OpenSALT", () => {
  const legacy = createCaseClient({ baseUrl: OPENSALT_ORIGIN, fetch: toOpenSalt, version: "1.0" });

  it("reads a document, an item and an association", async () => {
    expect((await legacy.document(id(MATHEMATICS.document)))?.title).toBe("Mathematics, Grade 3");
    expect((await legacy.item(id(MATHEMATICS.numberLine)))?.humanCodingScheme).toBe("NF.2");
    expect((await legacy.association(id(23)))?.associationType).toBe("isChildOf");
  });

  it("reads the package of the plain framework, with its three items", async () => {
    expect((await legacy.package(id(READING.document)))?.CFItems).toHaveLength(3);
  });

  it("refuses the package that has a node in another kind of system, because OpenSALT writes its targetType on the 1.0 path too", async () => {
    const error = await legacy.package(id(MATHEMATICS.document)).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toMatch(/targetType/u);
  });
});

// The flows below change what OpenSALT holds, so they run last.
describe("the school platform of the example synchronizing from OpenSALT", () => {
  const copies: Copies = new Map();
  const platform = createCaseClient({ baseUrl: OPENSALT_ORIGIN, fetch: toOpenSalt });

  it("fetches both frameworks the first time and none the second, and outlines the first as the provider's copy is", async () => {
    const first = await syncFrameworks(platform, copies);
    expect([...first.fetched].sort()).toStrictEqual(["English Language Arts, Grade 3", "Mathematics, Grade 3"]);
    const again = await syncFrameworks(platform, copies);
    expect(again.fetched).toStrictEqual([]);
    expect([...again.current].sort()).toStrictEqual([...first.fetched].sort());
    expect(outline(copies.get(id(MATHEMATICS.document)) ?? sent.mathematics)).toStrictEqual(outline(sent.mathematics));
  });

  it("fetches only the framework that the ministry published again, and finds what its second edition changed", async () => {
    const before = copies.get(id(MATHEMATICS.document));
    const second = await served(id(MATHEMATICS.document), "2025");
    const answer = await importFramework(BASE, session, JSON.stringify(withoutLevelExtensions(second)));
    expect(answer.status).toBe(200);
    const report = await syncFrameworks(platform, copies);
    expect(report).toStrictEqual({ fetched: ["Mathematics, Grade 3"], current: ["English Language Arts, Grade 3"] });
    const after = copies.get(id(MATHEMATICS.document));
    expect(changesBetween(before ?? sent.mathematics, after ?? sent.mathematics).replaced).toStrictEqual([
      "MD.1 by MD.2",
    ]);
    expect(
      changesBetween(before ?? sent.mathematics, after ?? sent.mathematics).added.map((line) => line.split(" ")[0]),
    ).toStrictEqual(["NF.4", "MD.2"]);
  });
});
