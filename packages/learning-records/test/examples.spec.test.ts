import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readSpecPage } from "../../../scripts/spec-examples.js";
import { type RuleRole, validateStatement, validateStatements } from "../src/index.js";

const ROOT = resolve(import.meta.dirname, "../../..");
/** The JSON of the examples of the xAPI base standard, which `pnpm spec-examples` downloads at a pinned hash. */
const EXAMPLES = readSpecPage(ROOT, "xapi-base-standard-examples.json");
/** The JSON of the PUT and POST requests of the same repository. */
const REQUESTS = readSpecPage(ROOT, "xapi-put-and-post-examples.json");

type Example = Record<string, unknown>;

function isExample(value: unknown): value is Example {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A whole Statement: an Actor, a Verb and an Object, and not the SubStatement that the standard prints on its own. */
function isStatement(value: unknown): value is Example {
  return isExample(value) && "actor" in value && "verb" in value && "object" in value && !("objectType" in value);
}

/** A batch of Statements in a request. The responses of the examples are lists of ids, which are not batches. */
function isBatch(value: unknown): value is Example[] {
  return Array.isArray(value) && value.length > 0 && value.every(isStatement);
}

/** A Statement with an Object, for the parts that the standard prints without one. */
function aboutObject(object: unknown): Example {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    actor: { mbox: "mailto:learner@example.org" },
    verb: { id: "http://adlnet.gov/expapi/verbs/experienced" },
    object,
  };
}

/** Where and in which rule a value has a finding, for each. */
function findings(value: unknown, role: RuleRole): string[] {
  return validateStatement(value, { role }).map(({ path, rule, severity }) => `${severity} ${rule} ${path}`);
}

const STATEMENTS = [...EXAMPLES, ...REQUESTS].filter(isStatement);
const BATCHES = REQUESTS.filter(isBatch);
/** The Activity Definitions of the interactions, which the standard prints without their Statement. */
const DEFINITIONS = EXAMPLES.filter((block) => isExample(block) && Object.keys(block).join() === "definition");

describe("the examples of the base standard", () => {
  it("hold the Statements, the objects and the Activity Definitions that the tests read", () => {
    expect(EXAMPLES).toHaveLength(19);
    expect(REQUESTS).toHaveLength(8);
    expect(STATEMENTS).toHaveLength(7);
    expect(BATCHES).toHaveLength(2);
    expect(DEFINITIONS).toHaveLength(10);
  });

  it("are Statements that an LRS accepts, as they are", () => {
    for (const statement of STATEMENTS) expect(findings(statement, "lrs")).toStrictEqual([]);
  });

  it("are batches that an LRS accepts, as they are", () => {
    for (const batch of BATCHES) expect(validateStatements(batch)).toStrictEqual([]);
  });

  it("have an Activity, an Agent, a Group and a SubStatement for an Object that an LRS accepts", () => {
    const objects = EXAMPLES.filter((block) => isExample(block) && "objectType" in block);
    expect(objects.map((block) => (block as Example).objectType)).toStrictEqual([
      "Activity",
      "Agent",
      "Group",
      "SubStatement",
    ]);
    for (const object of objects) expect(findings(aboutObject(object), "lrs")).toStrictEqual([]);
  });

  it("have ten Activity Definitions of an interaction that both roles accept, with the response patterns they print", () => {
    for (const { definition } of DEFINITIONS as { definition: unknown }[]) {
      const statement = aboutObject({ id: "https://example.org/activities/interaction", definition });
      expect(findings(statement, "lrs")).toStrictEqual([]);
      expect(findings(statement, "provider")).toStrictEqual([]);
    }
  });

  it("show a Learning Record Provider what it should and should not send, which the Statements of the examples do not always follow", () => {
    expect(STATEMENTS.map((statement) => findings(statement, "provider"))).toStrictEqual([
      ["warning timestamp-precision timestamp"],
      ["warning lrs-managed-property stored", "warning lrs-managed-property authority", "error invalid-value version"],
      ["warning timestamp-precision timestamp", "error invalid-value version"],
      ["warning timestamp-precision timestamp", "error invalid-value version"],
      ["warning timestamp-precision timestamp", "warning missing-property id"],
      ["warning timestamp-precision timestamp"],
      ["warning timestamp-precision timestamp", "warning missing-property id"],
    ]);
  });
});
