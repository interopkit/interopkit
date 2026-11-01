import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("the exports", () => {
  it("are what the package documents and nothing else", () => {
    expect(Object.keys(api).sort()).toStrictEqual(
      [
        "ACHIEVEMENT_TYPES",
        "ALIGNMENT_TARGET_TYPES",
        "AUTHORIZATION_ERRORS",
        "ASSOCIATION_TYPES",
        "CONTEXTS",
        "CREDENTIAL_KINDS",
        "ENTITY_KINDS",
        "IDENTIFIER_TYPES",
        "REGISTRATION_ERRORS",
        "RESULT_STATUS_TYPES",
        "RESULT_TYPES",
        "STATUS_CODES_MAJOR",
        "STATUS_CODES_MINOR",
        "STATUS_SEVERITIES",
        "TOKEN_ERRORS",
        "buildAchievementCredential",
        "buildClrCredential",
        "buildEndorsementCredential",
        "caseAlignment",
        "credentialSummary",
        "hashIdentifier",
        "matchesIdentifier",
        "newerCredential",
        "sameCredential",
        "readCredential",
        "readEntity",
        "validateCredential",
        "validateEntity",
      ].sort(),
    );
  });
});
