import { resolve } from "node:path";
import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { readPackage, validateEntity, validatePackage } from "../src/index.js";

/** The JSON that the Implementation Guide 1.1 prints, which `pnpm spec-examples` downloads at a pinned hash. */
const BLOCKS = readSpecPage(resolve(import.meta.dirname, "../../.."), "case-implementation-guide-1p1.json");

type Example = Record<string, unknown>;

function isExample(value: unknown): value is Example {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finds the one example that the test describes. */
function example(describes: string, matches: (block: Example) => boolean): Example {
  const found = BLOCKS.filter((block): block is Example => isExample(block) && matches(block));
  if (found.length !== 1)
    throw new Error(`The guide holds ${found.length} examples of ${describes}, and the tests read one.`);
  return found[0] ?? {};
}

const ASSOCIATION = () => example("an association", (block) => "associationType" in block);
const ITEM_TYPES = () => example("item types", (block) => "CFItemTypes" in block && !("CFDocument" in block));
const RUBRIC = () => example("a rubric", (block) => "CFDocument" in block && !("CFItems" in block));
const COURSE_CODES = () => example("course codes", (block) => "CFDocument" in block && "CFItems" in block);

/** Where and in which rule a value has an error. */
const errorsOf = (value: unknown) =>
  validatePackage(value)
    .filter(({ severity }) => severity === "error")
    .map(({ path, rule }) => `${path} ${rule}`);

describe("the examples of the Implementation Guide", () => {
  it("holds the four examples that the tests read", () => {
    expect(BLOCKS).toHaveLength(4);
  });

  it("are read when they are conformant: the association of 4.4 and the item types of 4.6", () => {
    expect(validateEntity("CFAssociation", ASSOCIATION())).toStrictEqual([]);
    expect(validateEntity("CFItemTypeSet", ITEM_TYPES())).toStrictEqual([]);
  });

  it("are not packages when they are sketches: the rubric and the course codes", () => {
    expect(errorsOf(RUBRIC())).toStrictEqual([
      "CFDocument.identifier invalid-format",
      "CFDocument.uri missing-property",
      "CFDocument.creator missing-property",
      "CFDocument.lastChangeDateTime invalid-format",
      "CFDocument.CFItems unknown-property",
    ]);
    expect(errorsOf(COURSE_CODES())).toStrictEqual([
      "CFDocument.creator missing-property",
      "CFDocument.title missing-property",
      "CFDocument.lastChangeDateTime missing-property",
      "CFItems[0].lastChangeDateTime missing-property",
      "CFItems[0].subject wrong-type",
      "CFItems[0].HumanCodingScheme unknown-property",
      "CFItemTypes unknown-property",
    ]);
    expect(() => readPackage(RUBRIC())).toThrow(DataError);
    expect(() => readPackage(COURSE_CODES())).toThrow(DataError);
  });
});
