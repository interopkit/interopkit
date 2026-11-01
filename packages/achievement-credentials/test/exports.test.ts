import { describe, expect, it } from "vitest";
import * as baking from "../src/baking/index.js";
import * as dataIntegrity from "../src/data-integrity/index.js";
import * as api from "../src/index.js";
import * as jwt from "../src/jwt/index.js";
import * as keys from "../src/keys/index.js";
import * as refresh from "../src/refresh/index.js";
import * as status from "../src/status/index.js";

describe("the exports", () => {
  it("are what the package documents and nothing else", () => {
    expect(Object.keys(api).sort()).toStrictEqual(
      [
        "ACHIEVEMENT_TYPES",
        "ALIGNMENT_TARGET_TYPES",
        "AUTHORIZATION_ERRORS",
        "ASSOCIATION_TYPES",
        "CHECK_OUTCOMES",
        "CONTEXTS",
        "CREDENTIAL_APIS",
        "CREDENTIAL_KINDS",
        "ENTITY_KINDS",
        "IDENTIFIER_TYPES",
        "KEY_RELATIONSHIPS",
        "REGISTRATION_ERRORS",
        "RESULT_STATUS_TYPES",
        "RESULT_TYPES",
        "STATUS_CODES_MAJOR",
        "STATUS_CODES_MINOR",
        "STATUS_SEVERITIES",
        "TOKEN_ERRORS",
        "VERIFICATION_CHECKS",
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

  it("of baking are its four functions", () => {
    expect(Object.keys(baking).sort()).toStrictEqual(["bakePng", "bakeSvg", "readPng", "readSvg"]);
  });

  it("are, for the subpath data-integrity, the proofs, the loader of contexts and safe mode", () => {
    expect(Object.keys(dataIntegrity).sort()).toStrictEqual([
      "KNOWN_CONTEXTS",
      "addProof",
      "createContextLoader",
      "deriveDisclosure",
      "validateJsonLd",
      "verifyProof",
    ]);
  });

  it("are, for the subpath status, the list, the index, the credential of the list and its check", () => {
    expect(Object.keys(status).sort()).toStrictEqual([
      "allocateStatusIndex",
      "createStatusList",
      "createStatusListCache",
      "issueStatusListCredential",
      "setCredentialStatus",
      "verifyCredentialStatus",
    ]);
  });

  it("are, for the subpath refresh, the request to the service and the answer of the issuer", () => {
    expect(Object.keys(refresh).sort()).toStrictEqual(["handleRefreshRequest", "refreshCredential"]);
  });

  it("are, for the subpath keys, the resolver and the check of the binding", () => {
    expect(Object.keys(keys).sort()).toStrictEqual(["createKeyResolver", "verifyIssuerKey"]);
  });

  it("are, for the subpath jwt, the signature and the reader", () => {
    expect(Object.keys(jwt).sort()).toStrictEqual(["readCredentialJwt", "signCredentialJwt"]);
  });
});
