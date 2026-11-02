import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  APPROVED_ALGORITHMS,
  CONTEXT_ROLES,
  CONTEXT_SUB_ROLES,
  CONTEXT_TYPES,
  canonicalizeContextType,
  canonicalizeRole,
  INSTITUTION_ROLES,
  LTI_SYSTEM_ROLES,
  MESSAGE_TYPES,
  SCOPES,
  SYSTEM_ROLES,
} from "../src/index.js";
import { isVocabularyContextType, isVocabularyRole } from "../src/protocol/internal.js";
import { FUZZ } from "./fuzz.js";

const LIS = "http://purl.imsglobal.org/vocab/lis/v2";

describe("the vocabularies of LTI Core Appendix A", () => {
  it("hold the entries the appendix counts: 7 system, 14 institution and 8 context roles, 51 sub-roles, TestUser, 4 context types", () => {
    expect(
      [SYSTEM_ROLES, INSTITUTION_ROLES, CONTEXT_ROLES, CONTEXT_SUB_ROLES, LTI_SYSTEM_ROLES, CONTEXT_TYPES].map(
        (list) => list.length,
      ),
    ).toEqual([7, 14, 8, 51, 1, 4]);
  });

  it("spell the roles as the appendix does, with the prefix of their vocabulary", () => {
    expect(SYSTEM_ROLES.every((uri) => uri.startsWith(`${LIS}/system/person#`))).toBe(true);
    expect(INSTITUTION_ROLES.every((uri) => uri.startsWith(`${LIS}/institution/person#`))).toBe(true);
    expect(CONTEXT_ROLES.every((uri) => uri.startsWith(`${LIS}/membership#`))).toBe(true);
    expect(CONTEXT_SUB_ROLES).toContain(`${LIS}/membership/Instructor#TeachingAssistant`);
    expect(CONTEXT_SUB_ROLES).toContain(`${LIS}/membership/Officer#Vice-Chair`);
    expect(LTI_SYSTEM_ROLES).toEqual(["http://purl.imsglobal.org/vocab/lti/system/person#TestUser"]);
    expect(CONTEXT_TYPES).toContain(`${LIS}/course#CourseOffering`);
  });

  it("have no entry twice", () => {
    for (const list of [SYSTEM_ROLES, INSTITUTION_ROLES, CONTEXT_ROLES, CONTEXT_SUB_ROLES, CONTEXT_TYPES]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe("canonicalizeRole", () => {
  it("maps the simple name of a context role to its URI, as the appendix says a platform may send it", () => {
    expect(canonicalizeRole("Instructor")).toBe(`${LIS}/membership#Instructor`);
    for (const uri of CONTEXT_ROLES) expect(canonicalizeRole(uri.slice(uri.indexOf("#") + 1)), uri).toBe(uri);
  });

  it("returns every other role as it is: a URI of a vocabulary, a role of another vocabulary and the deprecated person# URIs", () => {
    for (const role of [
      ...SYSTEM_ROLES,
      ...INSTITUTION_ROLES,
      ...CONTEXT_SUB_ROLES,
      `${LIS}/person#Administrator`,
      "instructor",
      "https://x.example/role",
      "",
      "__proto__",
      "constructor",
    ]) {
      expect(canonicalizeRole(role), role).toBe(role);
    }
  });

  it("is idempotent for any text", () => {
    fc.assert(
      fc.property(fc.string(), (role) => canonicalizeRole(canonicalizeRole(role)) === canonicalizeRole(role)),
      FUZZ,
    );
  });
});

describe("canonicalizeContextType", () => {
  it("maps the deprecated simple name and the deprecated URN of a context type to its URI", () => {
    for (const uri of CONTEXT_TYPES) {
      const name = uri.slice(uri.indexOf("#") + 1);
      expect(canonicalizeContextType(name), name).toBe(uri);
      expect(canonicalizeContextType(`urn:lti:context-type:ims/lis/${name}`), name).toBe(uri);
      expect(canonicalizeContextType(uri), uri).toBe(uri);
    }
  });

  it("returns a type of no vocabulary as it is, Canvas's Account among them", () => {
    for (const type of ["Account", "urn:lti:context-type:ims/lis/Account", "__proto__", ""]) {
      expect(canonicalizeContextType(type), type).toBe(type);
    }
  });
});

describe("the vocabulary tests that the writer uses", () => {
  it("know a role of any vocabulary and a simple name of a context role, and no other", () => {
    for (const role of [
      SYSTEM_ROLES[0],
      INSTITUTION_ROLES[0],
      CONTEXT_ROLES[0],
      CONTEXT_SUB_ROLES[0],
      LTI_SYSTEM_ROLES[0],
      "Learner",
    ]) {
      expect(isVocabularyRole(role ?? ""), role).toBe(true);
    }
    for (const role of ["Account", "learner", "", `${LIS}/membership#Teacher`])
      expect(isVocabularyRole(role), role).toBe(false);
    expect(isVocabularyContextType("CourseSection")).toBe(true);
    expect(isVocabularyContextType("Account")).toBe(false);
  });
});

describe("the names the package exports", () => {
  it("list the six algorithms of Security Framework 1.1 section 7.2, the seven message types and the scopes of the services", () => {
    expect(APPROVED_ALGORITHMS).toEqual(["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"]);
    expect([...MESSAGE_TYPES].sort()).toEqual(
      [
        "LtiDeepLinkingRequest",
        "LtiDeepLinkingResponse",
        "LtiEndAssessment",
        "LtiResourceLinkRequest",
        "LtiStartAssessment",
        "LtiStartProctoring",
        "LtiSubmissionReviewRequest",
      ].sort(),
    );
    expect(Object.values(SCOPES)).toHaveLength(10);
    expect(SCOPES.score).toBe("https://purl.imsglobal.org/spec/lti-ags/scope/score");
    expect(SCOPES.contextMembershipReadonly).toBe(
      "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly",
    );
  });
});
