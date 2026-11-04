import { describe, expect, it } from "vitest";
import * as attachments from "../src/attachments/index.js";
import * as client from "../src/client/index.js";
import * as root from "../src/index.js";
import * as signing from "../src/signing/index.js";
import * as store from "../src/store/index.js";

describe("the public API", () => {
  it("exports only what the package documents", () => {
    expect(Object.keys(root).sort()).toStrictEqual(
      [
        "buildStatement",
        "buildVoidingStatement",
        "CONTEXT_ACTIVITY_TYPES",
        "convertStatementVersion",
        "deriveStatementId",
        "formatDuration",
        "formatStatement",
        "INTERACTION_TYPES",
        "isDuration",
        "isSameStatement",
        "mboxSha1sum",
        "parseDuration",
        "readStatement",
        "parseStatementJson",
        "RULE_ROLES",
        "STATEMENT_FORMATS",
        "validateStatement",
        "validateStatements",
        "VERB_VOIDED",
        "XAPI_VERSIONS",
      ].sort(),
    );
  });

  it("exports from the subpaths only what each documents", () => {
    expect(Object.keys(attachments).sort()).toStrictEqual(["hashAttachment", "readMultipart", "writeMultipart"]);
    expect(Object.keys(client)).toStrictEqual(["createLrsClient"]);
    expect(Object.keys(store).sort()).toStrictEqual([
      "LRS_ACTIONS",
      "handleLrsRequest",
      "matchesStatementQuery",
      "readBasicAuthorization",
    ]);
    expect(Object.keys(signing).sort()).toStrictEqual([
      "SIGNATURE_USAGE_TYPE",
      "signStatement",
      "verifyStatementSignature",
    ]);
  });
});
