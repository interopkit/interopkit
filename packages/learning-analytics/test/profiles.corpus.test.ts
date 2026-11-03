import { describe, expect, it } from "vitest";
import {
  type CaliperFinding,
  EVENT_TYPES,
  readEntity,
  readEvent,
  validateEntity,
  validateEvent,
} from "../src/index.js";
import { fixtures } from "./caliper-oracle.js";

/** A document of a fixture with the name of its file, and its place in the envelope that holds it. */
interface Document {
  readonly name: string;
  readonly value: Record<string, unknown>;
}

/** The events and the entities of the fixtures that begin with a prefix: a file holds one, or an envelope holds many. */
function documents(prefix: string, negative = false): Document[] {
  return [...fixtures(prefix, negative)].flatMap(([name, text]) => {
    let parsed: { readonly data?: unknown };
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const found: Record<string, unknown>[] = Array.isArray(parsed.data) ? parsed.data : [parsed];
    return found.map((value, index) => ({ name: `${name}[${index}]`, value }));
  });
}

const isEvent = (value: Record<string, unknown>): boolean => EVENT_TYPES.some((type) => type === value.type);
const judge = (value: Record<string, unknown>): readonly CaliperFinding[] =>
  isEvent(value) ? validateEvent(value) : validateEntity(value);
const errorsOf = (findings: readonly CaliperFinding[]) => findings.filter(({ severity }) => severity === "error");

/**
 * The fixtures that mark an event with the General Profile although it is a NavigationEvent, which section 3.15 allows the
 * generic Event alone.
 */
const GENERAL_PROFILE_ON_NAVIGATION = ["caliperEnvelopeEventBatch.json[0]", "caliperEnvelopeEventThinned.json[0]"];

describe("validateEvent and validateEntity against the fixtures of caliper-spec", () => {
  const positives = [...documents("caliperEvent"), ...documents("caliperEnvelope"), ...documents("caliperEntity")];

  it("finds no error in a fixture that the readers take, but the two that put the General Profile on a navigation", () => {
    expect(positives.length).toBeGreaterThan(200);
    const faulty = positives.filter(({ value }) => errorsOf(judge(value)).length > 0).map(({ name }) => name);
    expect(faulty).toStrictEqual(GENERAL_PROFILE_ON_NAVIGATION);
    for (const name of GENERAL_PROFILE_ON_NAVIGATION) {
      const { value } = positives.find((document) => document.name === name) ?? { value: {} };
      expect(errorsOf(judge(value))).toMatchObject([{ path: "profile", rule: "profile-event" }]);
    }
  });

  it("finds only the warnings that the sentences of the profiles name, in the fixtures that follow the rules", () => {
    const rules = new Set(positives.flatMap(({ value }) => judge(value).map(({ rule }) => rule)));
    expect([...rules].sort()).toStrictEqual([
      "general-profile-modeled",
      "generated-missing",
      "profile-event",
      "profile-missing",
      "profile-object",
    ]);
  });

  it("finds an error in every malformed fixture that the reader refuses, and in none that the reader takes", () => {
    const negatives = [...documents("caliperEvent", true), ...documents("caliperEntity", true)];
    expect(negatives.length).toBeGreaterThan(200);
    const disagreed: string[] = [];
    for (const { name, value } of negatives) {
      let reads = true;
      try {
        if (isEvent(value)) readEvent(value);
        else readEntity(value);
      } catch {
        reads = false;
      }
      if (reads === errorsOf(judge(value)).length > 0) disagreed.push(name);
    }
    expect(disagreed).toStrictEqual([]);
  });
});
