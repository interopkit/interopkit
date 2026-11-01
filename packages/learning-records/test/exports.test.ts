import { describe, expect, it } from "vitest";
import * as root from "../src/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "buildStatement",
        "CONTEXT_ACTIVITY_TYPES",
        "deriveStatementId",
        "formatDuration",
        "formatStatement",
        "formatTimestamp",
        "INTERACTION_TYPES",
        "mboxSha1sum",
        "parseDuration",
        "readStatement",
        "readStatementJson",
        "RULE_ROLES",
        "sameStatement",
        "STATEMENT_FORMATS",
        "validateStatement",
        "validateStatements",
        "VERB_VOIDED",
        "voidingStatement",
      ].sort(),
    );
  });
});
