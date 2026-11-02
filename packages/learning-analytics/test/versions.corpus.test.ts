import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { handleCaliperRequest } from "../src/endpoint/index.js";
import {
  ACTIONS,
  CALIPER_1_1_CONTEXT,
  ENTITY_TYPES,
  EVENT_TYPES,
  LTI_MESSAGE_TYPES,
  METRICS,
  ROLES,
  readEntity,
  readEvent,
  STATUSES,
} from "../src/index.js";
import { NOT_IN_1_1, TERMS_NOT_IN_1_1 } from "../src/v1p1/index.js";
import { fixtures, ORACLE_1_1 } from "./caliper-oracle.js";
import { EXTENSION_TERMS_1_1, TERMS_1_1, undefinedTerms } from "./context-oracle.js";
import { post, recorder } from "./endpoint-fixture.js";

const V1P1 = { version: "1.1" } as const;

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_104, numRuns: 60 };

/** The documents of the fixtures of Caliper 1.1: every event and entity, and every item of every envelope. */
const DOCUMENTS = [...fixtures("caliper", false, "1.1")].flatMap(([name, text]) => {
  const value: Record<string, unknown> & { readonly data?: readonly Record<string, unknown>[] } = JSON.parse(text);
  if (name.startsWith("caliperEnvelope"))
    return (value.data ?? []).map((item, index) => ({ name: `${name}[${index}]`, item }));
  return name.startsWith("caliperEndpoint") ? [] : [{ name, item: value }];
});

/**
 * Finds the first member that differs between a document and its changed copy, with its path as `.a.b` and the value that it has
 * in the copy.
 */
function firstChange(
  before: unknown,
  after: unknown,
  path = "",
): { readonly path: string; readonly value: unknown } | undefined {
  if (JSON.stringify(before) === JSON.stringify(after)) return undefined;
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) {
    return { path, value: after };
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const found = firstChange(Reflect.get(before, key), Reflect.get(after, key), `${path}.${key}`);
    if (found !== undefined) return found;
  }
  return { path, value: after };
}

/**
 * Tells whether a change turns the `@context` of a nested entity into an object. Section 4.1 of Caliper 1.1 lets a context be
 * a string, an object or an array wherever a JSON object is defined, and schema_1_1 allows a string or an array.
 */
function isNestedContextObject(change: ReturnType<typeof firstChange>): boolean {
  const { path = "", value } = change ?? {};
  return /\.[^.]+\.@context$/u.test(path) && typeof value === "object" && value !== null && !Array.isArray(value);
}

const isEvent = (item: unknown): boolean =>
  typeof item === "object" && item !== null && EVENT_TYPES.some((type) => type === Reflect.get(item, "type"));

/** Reads a document as 1.1 and returns the sentence of the error, or `undefined` when it reads. */
function refusal(item: unknown): string | undefined {
  try {
    if (isEvent(item)) readEvent(item, V1P1);
    else readEntity(item, V1P1);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("the readers of Caliper 1.1 against the fixtures of caliper-spec", () => {
  it("reads every event and entity that the fixtures show, and returns it as the fixture has it, but one", () => {
    expect(DOCUMENTS.length).toBeGreaterThan(130);
    const refused: string[] = [];
    for (const { name, item } of DOCUMENTS) {
      if (refusal(item) !== undefined) refused.push(name);
      else expect(isEvent(item) ? readEvent(item, V1P1) : readEntity(item, V1P1), name).toStrictEqual(item);
    }
    expect(refused).toStrictEqual(["caliperEventSubmittedMultiContext.json"]);
  });

  it("refuses the event that gives an object of a class that a context of the sender defines, and a profile", () => {
    const item = DOCUMENTS.find(({ name }) => name === "caliperEventSubmittedMultiContext.json")?.item ?? {};
    expect(item.profile).toBe("GeneralProfile");
    expect(refusal(item)).toMatch(
      /^The event is invalid at object: expected an entity of type .*, found an entity of type Thesis\.$/u,
    );
    const { profile: _profile, object: _object, ...rest } = item;
    expect(
      refusal({ ...rest, object: { id: "https://example.edu/handle/2027.42/130810", type: "Document" } }),
    ).toBeUndefined();
  });

  it("receives every envelope of the fixtures with every item that it holds, as an envelope of 1.1", async () => {
    const envelopes = [...fixtures("caliperEnvelope", false, "1.1")].map(([name, text]) => ({
      name,
      envelope: JSON.parse(text) as Record<string, unknown> & { readonly data: readonly unknown[] },
    }));
    expect(envelopes.length).toBeGreaterThan(7);
    for (const { name, envelope } of envelopes) {
      for (const strict of [false, true]) {
        const endpoint = recorder({ strict });
        const response = await handleCaliperRequest(post(envelope), endpoint.options);
        expect(response, name).toStrictEqual({ status: 200, headers: {}, body: "" });
        expect(endpoint.received[0]?.data, name).toStrictEqual(envelope.data);
        expect(endpoint.received[0]?.findings, name).toStrictEqual([]);
        expect(endpoint.received[0]?.dataVersion, name).toBe(CALIPER_1_1_CONTEXT);
      }
      const only12 = recorder({ versions: ["1.2"] });
      expect((await handleCaliperRequest(post(envelope), only12.options)).status, name).toBe(422);
    }
  });
});

describe("the published JSON-LD contexts of Caliper 1.1", () => {
  const missing = (terms: readonly string[]) =>
    terms.filter((term) => !TERMS_1_1.has(term) && ![...EXTENSION_TERMS_1_1.values()].some((own) => own.has(term)));
  const kept = (terms: readonly string[], added: readonly string[]) => terms.filter((term) => !added.includes(term));

  it("define every term of the model that 1.1 reads, but those that the context and the specification disagree on", () => {
    expect(missing(kept(EVENT_TYPES, NOT_IN_1_1.events))).toStrictEqual([]);
    expect(missing(kept(ENTITY_TYPES, NOT_IN_1_1.entities))).toStrictEqual([]);
    const rolesAdded = TERMS_NOT_IN_1_1.filter(({ property }) => property === "roles").flatMap(({ terms }) => terms);
    expect(missing(kept(ROLES, rolesAdded))).toStrictEqual(
      ["Mentor#Auditor"].filter((role) => missing([role]).length > 0),
    );
    const actionsAdded = TERMS_NOT_IN_1_1.filter(({ property }) => property === "action").flatMap(({ terms }) => terms);
    // Appendix A lists the two actions of closed captioning for the media event, and no context of 1.1 defines them.
    expect(missing(kept(ACTIONS, actionsAdded))).toStrictEqual(["DisabledClosedCaptioning", "EnabledClosedCaptioning"]);
    expect(missing([...STATUSES, ...LTI_MESSAGE_TYPES, ...METRICS])).toStrictEqual([]);
  });

  it("define every node type and property that the fixtures write, but the three that the extension profiles leave out", () => {
    const problems: string[] = [];
    // A document that names a context of the sender's own is defined by that context as well, which the test does not read.
    const namesOnlyCaliper = (item: unknown) =>
      [Reflect.get(item as object, "@context")]
        .flat()
        .every(
          (context) => typeof context === "string" && context.startsWith("http://purl.imsglobal.org/ctx/caliper/"),
        );
    for (const { name, item } of DOCUMENTS.filter(({ item: each }) => namesOnlyCaliper(each))) {
      problems.push(...undefinedTerms(item).map((problem) => `${name}: ${problem}`));
    }
    // The core context lacks `Collection`, which only the Survey profile defines; the Feedback and the Survey profiles define
    // `MultiselectionScale` and `MultiselectScale` in turn; and neither defines `scale`, the property of a question.
    expect(problems).toStrictEqual([
      "caliperEntityCollection.json: document: the node type Collection is not defined",
      "caliperEntityMultiselectScale.json: document: the node type MultiselectScale is not defined",
      "caliperEntityQuestionnaireItem.json: document.question.scale: the term is not defined",
      "caliperEntityRatingWithMultiselectScale.json: document.question.scale: the node type MultiselectScale is not defined",
      "caliperEventQuestionnaireItemCompletedRatingScaleQuestion.json: document.object.question.scale: the term is not defined",
      "caliperEventQuestionnaireItemStarted.json: document.object.question.scale: the term is not defined",
    ]);
  });
});

describe("the readers of Caliper 1.1 against schema_1_1", () => {
  const { schemas, schemaAccepts, entityTerms, eventTerms, narrowedDefinitions, documentArbitrary, closure } =
    ORACLE_1_1;
  const definitions = narrowedDefinitions();

  it("has a schema for every class of the tables, and for none of the extension profiles", () => {
    const withoutSchema = [...EVENT_TYPES, ...ENTITY_TYPES].filter((term) => !schemas.has(term));
    for (const term of [...entityTerms, ...eventTerms]) expect(schemas.has(term), term).toBe(true);
    expect(withoutSchema).toContain("QuestionnaireEvent");
    expect(withoutSchema).toContain("Questionnaire");
    expect(
      closure("Entity")
        .filter((term) => entityTerms.includes(term))
        .sort(),
    ).toStrictEqual([...entityTerms].sort());
  });

  it("accepts, for every fixture that a schema describes, what the readers read, but six that the schemas cannot tell", () => {
    const refused: string[] = [];
    for (const { name, item } of DOCUMENTS) {
      const term = typeof item.type === "string" && schemas.has(item.type) ? item.type : undefined;
      if (term === undefined || refusal(item) !== undefined) continue;
      if (!schemaAccepts(term)(item)) refused.push(name);
    }
    // The schemas give a metric as a number, leave the generic Entity out of a collection, and know no class of an extension
    // profile as the object, the target or the generated entity of an event.
    expect(refused).toStrictEqual([
      "caliperEntityAggregateMeasure.json",
      "caliperEntityAggregateMeasureCollection.json",
      "caliperEntityCollection.json",
      "caliperEventNavigationNavigatedToQuestionnaireItem.json",
      "caliperEventToolUseUsedWithProgress.json",
      "caliperEventViewViewedQuestionnaireItem.json",
    ]);
  });

  it.each(entityTerms.filter((term) => schemas.has(term)))(
    "reads an entity of %s that the schema accepts, and refuses what the schema refuses after a change",
    (term) => {
      const accepts = schemaAccepts(term);
      fc.assert(
        fc.property(documentArbitrary(term, definitions), mutations, (entity, mutation) => {
          expect(accepts(entity), JSON.stringify(entity)).toBe(true);
          expect(refusal(entity), JSON.stringify(entity)).toBeUndefined();
          const changed = mutate(entity, mutation, BAD_STRINGS);
          if (!accepts(changed) && !isNestedContextObject(firstChange(entity, changed))) {
            expect(refusal(changed), JSON.stringify(changed)).toBeTypeOf("string");
          }
        }),
        RUNS,
      );
    },
  );

  it.each(["Event", ...eventTerms].filter((term) => schemas.has(term)))(
    "reads an event of %s that the schema accepts, and refuses what the schema refuses after a change",
    (term) => {
      const accepts = schemaAccepts(term);
      const identifiers = fc.uuid().map((uuid) => `urn:uuid:${uuid}`);
      fc.assert(
        fc.property(documentArbitrary(term, definitions, identifiers), mutations, (event, mutation) => {
          expect(accepts(event), JSON.stringify(event)).toBe(true);
          expect(refusal(event), JSON.stringify(event)).toBeUndefined();
          const changed = mutate(event, mutation, BAD_STRINGS);
          if (!accepts(changed) && !isNestedContextObject(firstChange(event, changed))) {
            expect(refusal(changed), JSON.stringify(changed)).toBeTypeOf("string");
          }
        }),
        RUNS,
      );
    },
  );
});
