import { describe, expect, it } from "vitest";
import {
  AGENT_TYPES,
  CALIPER_CONTEXT,
  COURSE_OFFERING_TYPES,
  DIGITAL_RESOURCE_TYPES,
  ENTITY_TYPES,
  LIBRARY_PROFILE_CONTEXT,
  ORGANIZATION_TYPES,
  QUESTION_TYPES,
  SCALE_TYPES,
} from "../src/index.js";
import { ENTITY_SCHEMAS } from "../src/read/internal.js";

describe("the model", () => {
  it("names the context of Caliper 1.2 and the context of the Library Use Profile", () => {
    expect(CALIPER_CONTEXT).toBe("http://purl.imsglobal.org/ctx/caliper/v1p2");
    expect(LIBRARY_PROFILE_CONTEXT).toBe("http://purl.imsglobal.org/ctx/caliper/v1p2/LibraryProfile-extension");
  });

  it("has a schema for every entity type and for no other term", () => {
    expect(Object.keys(ENTITY_SCHEMAS).sort()).toStrictEqual([...ENTITY_TYPES].sort());
  });

  it("lists no term twice in a vocabulary and names only entity types in a range", () => {
    expect(new Set(ENTITY_TYPES).size).toBe(ENTITY_TYPES.length);
    for (const range of [
      AGENT_TYPES,
      ORGANIZATION_TYPES,
      COURSE_OFFERING_TYPES,
      DIGITAL_RESOURCE_TYPES,
      QUESTION_TYPES,
      SCALE_TYPES,
    ]) {
      expect(new Set(range).size).toBe(range.length);
      for (const term of range) expect(ENTITY_TYPES).toContain(term);
    }
  });
});
