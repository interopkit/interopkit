import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { ENTITY_TYPES, readEntity } from "../src/index.js";
import { ENTITY_SCHEMAS } from "../src/read/internal.js";
import {
  closure,
  documentArbitrary,
  ENTITY_TERMS,
  fixtures,
  narrowedDefinitions,
  SCHEMA_1_2,
  schemaAccepts,
} from "./caliper-oracle.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_102, numRuns: 60 };

/** Tells whether the reader takes a value. */
function reads(value: unknown): boolean {
  try {
    readEntity(value);
    return true;
  } catch {
    return false;
  }
}

/** The names of the properties that the schema of a class of the reader declares. */
function propertiesOf(term: string): string[] {
  const [, object] = Reflect.get(Reflect.get(ENTITY_SCHEMAS, term), "pipe");
  return Object.keys(Reflect.get(object, "entries"));
}

/**
 * The malformed entities of the fixtures that a reader of JSON takes: they differ from a valid entity by writing a decimal
 * number without a fraction (`25` for `25.0`) or an integer with one, which JSON text does not tell apart once it is parsed.
 */
const SAME_NUMBER = [
  "caliperEntityAggregateMeasure-MalformedMaxMetricValueNotAnInt.json",
  "caliperEntityAggregateMeasure-MalformedMetricValueNotAnInt.json",
  "caliperEntityAssignableDigitalResource-MalformedMaxScoreNotAFloat.json",
  "caliperEntityScore-MalformedMaxScoreNotAnInt.json",
];

/** The malformed entities of the fixtures that schema_1_2 accepts, because it leaves open what the tables and the fixtures close. */
const SCHEMA_ACCEPTS = [
  "caliperEntity-MalformedIdNotAnIRI.json",
  "caliperEntity-MalformedOtherIdentifiersContainsWrongEntityType.json",
  "caliperEntity-MalformedOtherIdentifiersNotAString.json",
  "caliperEntityAggregateMeasure-MalformedMaxMetricValueNotAnInt.json",
  "caliperEntityAggregateMeasure-MalformedMetricNotPresent.json",
  "caliperEntityAggregateMeasure-MalformedMetricValueNotAnInt.json",
  "caliperEntityAggregateMeasure-MalformedMetricValueNotPresent.json",
  "caliperEntityAggregateMeasureCollection-MalformedItemsContainsWrongEntityType.json",
  "caliperEntityAssessment-MalformedItemsContainsWrongEntityType.json",
  "caliperEntityAssignableDigitalResource-MalformedMaxScoreNotAFloat.json",
  "caliperEntityAttempt-MalformedIsPartOfWrongEntityType.json",
  "caliperEntityCollection-MalformedItemsContainsWrongElementType.json",
  "caliperEntityComment-MalformedValueNotAnInt.json",
  "caliperEntityDigitalResource-MalformedIsPartOfNotAString.json",
  "caliperEntityDigitalResourceCollection-MalformedItemsContainsWrongEntityType.json",
  "caliperEntityForum-MalformedItemsContainsWrongType.json",
  "caliperEntityForum-MalformedItemsNotAList.json",
  "caliperEntityHighlightAnnotation-MalformedSelectionWrongEntityType.json",
  "caliperEntityLtiLink-MalformedMessageTypeUnknownValue.json",
  "caliperEntityMessage-MalformedAttachmentsContainsWrongType.json",
  "caliperEntityMultiselectScale-MalformedIsOrderedSelectionNotAnInt.json",
  "caliperEntityQuestionnaire-MalformedItemsContainsWrongEntityType.json",
  "caliperEntityQuestionnaire-MalformedItemsNotAList.json",
  "caliperEntityScore-MalformedCommentNotAnInt.json",
  "caliperEntityScore-MalformedMaxScoreNotAnInt.json",
  "caliperEntitySession-MalformedUserWrongEntityType.json",
  "caliperEntitySystemIdentifier-MalformedSourceWrongEntityType.json",
  "caliperEntityThread-MalformedItemsContainsWrongType.json",
  "caliperEntityThread-MalformedItemsNotAList.json",
];

describe("the entity reader against the fixtures of caliper-spec", () => {
  it("reads every entity that the fixtures show, and returns it as the fixture has it", () => {
    const positives = fixtures("caliperEntity");
    expect(positives.size).toBeGreaterThan(60);
    for (const [name, text] of positives) {
      const value: unknown = JSON.parse(text);
      expect(readEntity(value), name).toStrictEqual(value);
    }
  });

  it("refuses every malformed entity of the fixtures, but those that differ only in the form of a number", () => {
    const taken: string[] = [];
    const schemaTakes: string[] = [];
    for (const [name, text] of fixtures("caliperEntity", true)) {
      let value: { readonly type?: unknown };
      try {
        value = JSON.parse(text);
      } catch {
        continue;
      }
      if (reads(value)) taken.push(name);
      const term = typeof value.type === "string" && SCHEMA_1_2.has(value.type) ? value.type : undefined;
      if (term !== undefined && schemaAccepts(term)(value)) schemaTakes.push(name);
    }
    expect(taken).toStrictEqual(SAME_NUMBER);
    expect(schemaTakes).toStrictEqual(SCHEMA_ACCEPTS);
  });
});

describe("the entity reader against schema_1_2", () => {
  const definitions = narrowedDefinitions();
  const classes = ENTITY_TERMS.filter((term) => SCHEMA_1_2.has(term));

  it("has a schema for every class of entity but those of the Library Use Profile, which publishes none", () => {
    expect(ENTITY_TYPES.filter((term) => !SCHEMA_1_2.has(term)).sort()).toStrictEqual([
      "Library",
      "LibraryActivity",
      "LibraryResource",
      "LibrarySpace",
    ]);
    expect(
      closure("Entity")
        .filter((term) => ENTITY_TERMS.includes(term))
        .sort(),
    ).toStrictEqual([...ENTITY_TERMS].sort());
  });

  it.each(classes)("declares every property of the schema of %s that the tables keep", (term) => {
    const legacy = closure("DigitalResource").includes(term)
      ? [
          "alignedLearningObjective",
          "objectType",
          "dateToActivate",
          "dateToShow",
          "dateToStartOn",
          "dateToSubmit",
          "maxAttempts",
          "maxSubmits",
          "maxScore",
        ]
      : [];
    const pinned = new Set([
      "isPartOf",
      "orderedSelection",
      "LtiMessageType",
      "scale",
      "curveFactor",
      "curvedTotalScore",
      "extraCreditScore",
      "normalScore",
      "penaltyScore",
      "totalScore",
      ...legacy,
    ]);
    const ours = new Set(propertiesOf(term));
    const schema = SCHEMA_1_2.get(term);
    const declared = Object.keys(Reflect.get(schema ?? {}, "properties") ?? {}).filter((name) => name !== "@context");
    expect(declared.filter((name) => !ours.has(name) && !pinned.has(name))).toStrictEqual([]);
  });

  it.each(classes)(
    "reads an entity of %s that the schema accepts, and refuses what the schema refuses after a change",
    (term) => {
      const accepts = schemaAccepts(term);
      fc.assert(
        fc.property(documentArbitrary(term, definitions), mutations, (entity, mutation) => {
          expect(accepts(entity), JSON.stringify(entity)).toBe(true);
          expect(reads(entity), JSON.stringify(entity)).toBe(true);
          const changed = mutate(entity, mutation, BAD_STRINGS);
          if (!accepts(changed)) expect(reads(changed), JSON.stringify(changed)).toBe(false);
        }),
        RUNS,
      );
    },
  );
});
