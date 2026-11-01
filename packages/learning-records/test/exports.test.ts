import { describe, expect, it } from "vitest";
import * as attachments from "../src/attachments/index.js";
import * as root from "../src/index.js";
import * as signing from "../src/signing/index.js";

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

  it("exports from the subpaths only what each documents", () => {
    expect(Object.keys(attachments).sort()).toStrictEqual(["attachmentHash", "readMultipart", "writeMultipart"]);
    expect(Object.keys(signing).sort()).toStrictEqual([
      "SIGNATURE_USAGE_TYPE",
      "signStatement",
      "verifyStatementSignature",
    ]);
  });
});
