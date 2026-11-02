import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { EVENT_TYPES, readEntity, readEvent } from "../src/index.js";
import {
  documentArbitrary,
  EVENT_TERMS,
  fixtures,
  narrowedDefinitions,
  SCHEMA_1_2,
  schemaAccepts,
} from "./caliper-oracle.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_103, numRuns: 60 };

/** Tells whether the reader takes an event. */
function reads(value: unknown): boolean {
  try {
    readEvent(value);
    return true;
  } catch {
    return false;
  }
}

/** The identifiers of events: a UUID as a URN. */
const URNS = fc.uuid().map((uuid) => `urn:uuid:${uuid}`);

describe("the event reader against the fixtures of caliper-spec", () => {
  it("reads every event that the fixtures show, and returns it as the fixture has it", () => {
    const positives = fixtures("caliperEvent");
    expect(positives.size).toBeGreaterThan(45);
    for (const [name, text] of positives) {
      const value: unknown = JSON.parse(text);
      expect(readEvent(value), name).toStrictEqual(value);
    }
  });

  it("reads every event and every entity that the envelopes of the fixtures carry", () => {
    let read = 0;
    for (const [name, text] of fixtures("caliperEnvelope")) {
      const { data }: { data: readonly Record<string, unknown>[] } = JSON.parse(text);
      for (const [index, document] of data.entries()) {
        const isEvent = EVENT_TYPES.some((type) => type === document.type);
        expect(isEvent ? readEvent(document) : readEntity(document), `${name}[${index}]`).toStrictEqual(document);
        read += 1;
      }
    }
    expect(read).toBeGreaterThan(170);
  });

  it("refuses every malformed event of the fixtures", () => {
    const taken: string[] = [];
    const schemaTakes: string[] = [];
    for (const [name, text] of fixtures("caliperEvent", true)) {
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
    expect(taken).toStrictEqual([]);
    // The schemas leave open what the tables close: the class of an entity, the action of an event, and a reference that is no
    // string, and they cannot say that a launch needs the session of its platform.
    expect(schemaTakes).toHaveLength(62);
    for (const name of schemaTakes) {
      expect(name).toMatch(
        /(WrongEntityType|WrongAction|NotAString|NoFederatedSession|MalformedReferrerEntityType)\.json$/u,
      );
    }
  });
});

describe("the event reader against schema_1_2", () => {
  const definitions = narrowedDefinitions();
  const classes = ["Event", ...EVENT_TERMS].filter((term) => SCHEMA_1_2.has(term));

  it("has a schema for every event but those of the Library Use Profile, which publishes none", () => {
    expect(EVENT_TYPES.filter((term) => !SCHEMA_1_2.has(term)).sort()).toStrictEqual([
      "LibraryParticipationEvent",
      "LibraryResourceUseEvent",
      "LibraryUseEvent",
    ]);
  });

  it.each(classes)(
    "reads an event of %s that the schema accepts, and refuses what the schema refuses after a change",
    (term) => {
      const accepts = schemaAccepts(term);
      fc.assert(
        fc.property(documentArbitrary(term, definitions, URNS), mutations, (event, mutation) => {
          expect(accepts(event), JSON.stringify(event)).toBe(true);
          expect(reads(event), JSON.stringify(event)).toBe(true);
          const changed = mutate(event, mutation, BAD_STRINGS);
          if (!accepts(changed)) expect(reads(changed), JSON.stringify(changed)).toBe(false);
        }),
        RUNS,
      );
    },
  );
});
