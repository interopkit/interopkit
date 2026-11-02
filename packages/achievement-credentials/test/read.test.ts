import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { CONTEXTS, readCredential, readEntity, validateCredential, validateEntity } from "../src/index.js";
import {
  ACHIEVEMENT,
  achievementCredential,
  achievementCredentialV1p1,
  clrCredential,
  endorsementCredential,
  PROFILE,
  verifiableCredential,
} from "./fixtures.js";

/** Reads a verifiable credential, which every value that this file reads is, and not an Open Badges 2.0 badge. */
const readVerifiable = (value: unknown) => {
  const read = readCredential(value);
  if (!("@context" in read)) throw new Error("The value was read as an Open Badges 2.0 badge.");
  return read;
};

/** The rules and paths of the errors of a value, in order. */
const errorsOf = (value: unknown, options?: Parameters<typeof validateCredential>[1]) =>
  validateCredential(value, options)
    .filter(({ severity }) => severity === "error")
    .map(({ path, rule }) => `${path} ${rule}`);

describe("reading a credential", () => {
  it("reads the smallest credential of each kind into a copy that shares nothing with its input", () => {
    for (const make of [
      achievementCredential,
      achievementCredentialV1p1,
      endorsementCredential,
      clrCredential,
      verifiableCredential,
    ]) {
      const input = make();
      const credential = readVerifiable(input);
      expect(credential).toStrictEqual(input);
      expect(credential).not.toBe(input);
      expect(credential["@context"]).not.toBe(input["@context"]);
    }
  });

  it("reads the kind that the type names, and a kind that the caller asks for", () => {
    expect(
      readCredential({ ...achievementCredential(), type: ["VerifiableCredential", "AchievementCredential"] }),
    ).toMatchObject({ id: "https://example.edu/credentials/1" });
    expect(readCredential(clrCredential(), { kind: "ClrCredential" })).toStrictEqual(clrCredential());
    expect(errorsOf(achievementCredential(), { kind: "EndorsementCredential" })).toContain("name missing-property");
  });

  it("reads a credential under the Verifiable Credentials Data Model 1.1 when the first context says so", () => {
    expect(errorsOf(achievementCredentialV1p1())).toStrictEqual([]);
    expect(
      errorsOf({ ...achievementCredentialV1p1(), "@context": [CONTEXTS.credentialsV2, CONTEXTS.openBadges] }),
    ).toContain("issuanceDate missing-property".replace("issuanceDate", "validFrom"));
  });

  it("writes the only member of a list as a list, which the compacted form of JSON-LD allows", () => {
    const compact = { ...achievementCredential(), type: "OpenBadgeCredential" };
    expect(errorsOf(compact)).toStrictEqual(["type invalid-value"]);
    const credential = readCredential({
      ...achievementCredential(),
      evidence: { type: ["Evidence"], narrative: "A portfolio." },
      proof: { type: "DataIntegrityProof" },
      termsOfUse: { type: "Terms" },
      credentialSchema: { id: "https://example.edu/schema", type: "1EdTechJsonSchemaValidator2019" },
    });
    expect(credential).toMatchObject({
      evidence: [{ narrative: "A portfolio." }],
      proof: [{ type: "DataIntegrityProof" }],
      termsOfUse: [{ type: "Terms" }],
      credentialSchema: [{ type: "1EdTechJsonSchemaValidator2019" }],
    });
  });

  it("accepts the single type that is the class of a class that needs only one", () => {
    const value = {
      ...achievementCredential(),
      credentialSubject: { ...(achievementCredential().credentialSubject as object), type: "AchievementSubject" },
    };
    expect(readCredential(value)).toMatchObject({ credentialSubject: { type: ["AchievementSubject"] } });
  });

  it("refuses a type that does not hold the class, and a context that is not the contexts of the class in order", () => {
    expect(errorsOf({ ...achievementCredential(), type: ["OpenBadgeCredential"] })).toContain("type invalid-value");
    expect(errorsOf({ ...achievementCredential(), type: ["VerifiableCredential"] })).toStrictEqual([]);
    expect(
      errorsOf({ ...achievementCredential(), "@context": [CONTEXTS.openBadges, CONTEXTS.credentialsV2] }),
    ).toStrictEqual(['["@context"][0] invalid-value', '["@context"][1] invalid-format']);
    expect(errorsOf({ ...achievementCredential(), "@context": CONTEXTS.credentialsV2 })).toStrictEqual([
      '["@context"] wrong-type',
    ]);
    expect(errorsOf({ ...achievementCredential(), "@context": [CONTEXTS.credentialsV2] })).toStrictEqual([
      '["@context"][1] wrong-type',
    ]);
  });

  it("accepts further contexts, as an address or as a context that the credential holds", () => {
    const value = {
      ...achievementCredential(),
      "@context": [
        CONTEXTS.credentialsV2,
        CONTEXTS.openBadges,
        "https://example.edu/ctx",
        { ex: "https://example.edu/ns#" },
      ],
    };
    expect(readVerifiable(value)["@context"]).toStrictEqual(value["@context"]);
    expect(errorsOf({ ...value, "@context": [...value["@context"], 5] })).toStrictEqual(['["@context"][4] wrong-type']);
  });

  it("refuses a property that a closed class does not have, and keeps what an open class is given", () => {
    const withImage = {
      ...achievementCredential(),
      image: { id: "https://example.edu/i.png", type: "Image", extra: 1 },
    };
    expect(errorsOf(withImage)).toStrictEqual(["image.extra unknown-property"]);
    const extended = { ...achievementCredential(), "https://example.edu/ns#note": { list: [1, { a: null }] } };
    const credential = readCredential(extended);
    expect(credential).toStrictEqual(extended);
    expect(credential["https://example.edu/ns#note" as never]).not.toBe(extended["https://example.edu/ns#note"]);
  });

  it("does not carry a property named __proto__ and leaves the prototype of the result alone", () => {
    const value = JSON.parse(JSON.stringify(achievementCredential()).replace("{", '{"__proto__":{"admin":true},'));
    const credential = readCredential(value);
    expect(Object.getPrototypeOf(credential)).toBe(Object.prototype);
    expect("admin" in credential).toBe(false);
  });

  it("refuses a text that is a map of languages, which the schemas allow and the readers do not", () => {
    expect(errorsOf({ ...endorsementCredential(), name: { en: "Endorsement" } })).toStrictEqual(["name wrong-type"]);
  });

  it("refuses a value that is not JSON, and one that nests too deep", () => {
    expect(errorsOf({ ...achievementCredential(), id: () => 1 })).toStrictEqual([" invalid-value"]);
    let deep: Record<string, unknown> = { ...PROFILE };
    for (let level = 0; level < 100; level += 1) deep = { ...PROFILE, parentOrg: deep };
    const issues = validateCredential({ ...achievementCredential(), issuer: deep });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("nests more than 64 levels");
  });

  it("refuses a date and time that has no offset, and a date that is not a calendar date", () => {
    expect(errorsOf({ ...achievementCredential(), validFrom: "2024-06-13T10:00:00" })).toStrictEqual([
      "validFrom invalid-format",
    ]);
    expect(
      errorsOf({
        ...achievementCredential(),
        credentialSubject: {
          ...(achievementCredential().credentialSubject as object),
          activityEndDate: "2024-13-01T00:00:00Z",
        },
      }),
    ).toStrictEqual(["credentialSubject.activityEndDate invalid-format"]);
    expect(errorsOf({ ...achievementCredential(), issuer: { ...PROFILE, dateOfBirth: "2024-02-30" } })).toStrictEqual([
      "issuer.dateOfBirth invalid-format",
    ]);
  });

  it("reads an issuer that is a profile or the address of one", () => {
    expect(readCredential({ ...achievementCredential(), issuer: "https://example.edu/issuers/1" }).issuer).toBe(
      "https://example.edu/issuers/1",
    );
    expect(errorsOf({ ...achievementCredential(), issuer: 5 })).toStrictEqual(["issuer wrong-type"]);
  });

  it("reads a term of a vocabulary or an ext: term, and refuses another", () => {
    const achievement = (achievementType: string) => ({
      ...achievementCredential(),
      credentialSubject: {
        ...(achievementCredential().credentialSubject as object),
        achievement: { ...ACHIEVEMENT, achievementType },
      },
    });
    expect(errorsOf(achievement("Badge"))).toStrictEqual([]);
    expect(errorsOf(achievement("ext:MyTerm"))).toStrictEqual([]);
    expect(errorsOf(achievement("ext:"))).toStrictEqual([
      "credentialSubject.achievement.achievementType invalid-value",
    ]);
    expect(errorsOf(achievement("not-ext:a"))).toStrictEqual([
      "credentialSubject.achievement.achievementType invalid-value",
    ]);
    expect(errorsOf(achievement("Other"))).toStrictEqual([
      "credentialSubject.achievement.achievementType invalid-value",
    ]);
  });

  it("refuses an endorsementJwt that is not a compact JWS, and an inLanguage that is not a language tag", () => {
    expect(errorsOf({ ...achievementCredential(), endorsementJwt: "a.b" })).toStrictEqual([
      "endorsementJwt[0] invalid-format".replace("[0]", ""),
    ]);
    expect(readCredential({ ...achievementCredential(), endorsementJwt: ["a.b.c"] })).toMatchObject({
      endorsementJwt: ["a.b.c"],
    });
    const language = (inLanguage: string) => ({
      ...achievementCredential(),
      credentialSubject: {
        ...(achievementCredential().credentialSubject as object),
        achievement: { ...ACHIEVEMENT, inLanguage },
      },
    });
    expect(errorsOf(language("pt-BR"))).toStrictEqual([]);
    expect(errorsOf(language("english"))).toStrictEqual(["credentialSubject.achievement.inLanguage invalid-format"]);
  });
});

describe("the nested classes", () => {
  it("reads the alignments of a rubric criterion level, and of a result, in a result description", () => {
    const alignment = {
      type: ["Alignment"],
      targetName: "Fractions",
      targetUrl: "https://standards.example.org/items/1",
    };
    const achievement = {
      ...ACHIEVEMENT,
      resultDescription: [
        {
          id: "https://example.edu/results/1",
          type: ["ResultDescription"],
          name: "Grade",
          resultType: "RubricCriterion",
          alignment,
          rubricCriterionLevel: {
            id: "https://example.edu/levels/1",
            type: ["RubricCriterionLevel"],
            name: "Met",
            alignment,
          },
        },
      ],
    };
    const read = readEntity("Achievement", achievement);
    expect(read).toMatchObject({
      resultDescription: [{ alignment: [alignment], rubricCriterionLevel: [{ alignment: [alignment] }] }],
    });
  });
});

describe("judging a credential", () => {
  it("finds an error in a subject that nothing identifies, and none when it has an id or an identifier", () => {
    const subject = (extra: object) => ({
      ...achievementCredential(),
      credentialSubject: { type: ["AchievementSubject"], achievement: ACHIEVEMENT, ...extra },
    });
    expect(errorsOf(subject({}))).toStrictEqual(["credentialSubject subject-unidentified"]);
    expect(errorsOf(subject({ identifier: [] }))).toStrictEqual(["credentialSubject subject-unidentified"]);
    expect(errorsOf(subject({ id: "did:example:a" }))).toStrictEqual([]);
    expect(
      errorsOf(
        subject({
          identifier: [
            { type: "IdentityObject", hashed: false, identityHash: "a@example.com", identityType: "emailAddress" },
          ],
        }),
      ),
    ).toStrictEqual([]);
  });

  it("finds an error in a validity period that ends before it begins, in either data model, and none when it ends when it begins", () => {
    const period = (from: string, until: string) => ({
      ...achievementCredential(),
      validFrom: from,
      validUntil: until,
    });
    expect(errorsOf(period("2024-06-13T18:46:03Z", "2024-06-13T18:46:02Z"))).toStrictEqual([
      "validUntil validity-period",
    ]);
    expect(errorsOf(period("2024-06-13T18:46:03Z", "2024-06-13T20:46:02+02:00"))).toStrictEqual([
      "validUntil validity-period",
    ]);
    expect(errorsOf(period("2024-06-13T18:46:03Z", "2024-06-13T20:46:03+02:00"))).toStrictEqual([]);
    expect(errorsOf(period("2024-06-13T18:46:03Z", "2024-06-13T18:46:04Z"))).toStrictEqual([]);
    const old = { ...achievementCredentialV1p1(), expirationDate: "2020-01-01T00:00:00Z" };
    expect(errorsOf(old)).toStrictEqual(["expirationDate validity-period"]);
  });

  it("finds an error in a credential of no class of Open Badges whose subject says nothing", () => {
    const plain = (subject: object) => ({
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      type: ["VerifiableCredential"],
      issuer: "https://example.edu/issuers/1",
      validFrom: "2024-06-13T18:46:03Z",
      credentialSubject: subject,
    });
    expect(errorsOf(plain({}))).toStrictEqual(["credentialSubject subject-empty"]);
    expect(errorsOf(plain({ id: "did:example:a" }))).toStrictEqual([]);
    expect(errorsOf(plain({ name: "Alice" }))).toStrictEqual([]);
  });

  it("finds the same error in a subject of a CLR, in either data model", () => {
    const clr = clrCredential();
    expect(
      errorsOf({
        ...clr,
        credentialSubject: { type: ["ClrSubject"], verifiableCredential: [achievementCredential()] },
      }),
    ).toStrictEqual(["credentialSubject subject-unidentified"]);
  });

  it("warns of an identity that says it is hashed and holds no hash of a form the specification names", () => {
    const identified = (identityHash: string, hashed = true) => ({
      ...achievementCredential(),
      credentialSubject: {
        type: ["AchievementSubject"],
        achievement: ACHIEVEMENT,
        identifier: [{ type: "IdentityObject", hashed, identityHash, identityType: "emailAddress" }],
      },
    });
    const sha = `sha256$${"a".repeat(64)}`;
    expect(validateCredential(identified(sha))).toStrictEqual([]);
    expect(validateCredential(identified(`md5$${"B".repeat(32)}`))).toStrictEqual([]);
    expect(validateCredential(identified("a@example.com", false))).toStrictEqual([]);
    expect(validateCredential(identified("a@example.com"))).toStrictEqual([
      expect.objectContaining({
        path: "credentialSubject.identifier[0].identityHash",
        rule: "identity-hash-form",
        severity: "warning",
      }),
    ]);
    expect(validateCredential(identified("sha256$abc"))[0]?.rule).toBe("identity-hash-form");
    expect(readCredential(identified("a@example.com"))).toBeDefined();
  });

  it("gives the findings in the order of the value, one for each fault, without the path in the sentence", () => {
    const issues = validateCredential({ ...achievementCredential(), id: 5, name: 7, validFrom: "x" });
    expect(issues.map(({ path, rule }) => `${path} ${rule}`)).toStrictEqual([
      "id wrong-type",
      "name wrong-type",
      "validFrom invalid-format",
    ]);
    for (const issue of issues) expect(issue.message).not.toContain(issue.path);
  });

  it("gives a finding for a value that is not an object, and does not throw", () => {
    for (const value of [null, "text", 5, [], true]) {
      expect(validateCredential(value).length).toBeGreaterThan(0);
    }
  });
});

describe("the refusal of readCredential", () => {
  it("names the path of the first error, counts the others, and names the function that lists them all", () => {
    const value = { ...achievementCredential(), id: 5, name: 7 };
    expect(() => readCredential(value)).toThrow(DataError);
    expect(() => readCredential(value)).toThrow(
      "The credential is invalid at id: expected a string, found 5. 1 more error: validateCredential lists every finding.",
    );
    expect(() => readCredential({ ...value, validFrom: "x" })).toThrow("2 more errors");
  });

  it("refuses a subject that nothing identifies, which the schemas allow", () => {
    expect(() =>
      readCredential({
        ...achievementCredential(),
        credentialSubject: { type: "AchievementSubject", achievement: ACHIEVEMENT },
      }),
    ).toThrow("at credentialSubject: has neither an id nor an identifier");
  });
});

describe("the limit of findings", () => {
  const stopped = (findings: readonly { readonly rule: string }[]) => findings.at(-1)?.rule === "findings-stopped";

  it("lists at most 1,000 findings of a credential and ends the list with one that says it stopped", () => {
    const evidence = Array.from({ length: 100_000 }, () => ({}));
    const findings = validateCredential({ ...achievementCredential(), evidence });
    expect(findings).toHaveLength(1001);
    expect(findings.at(-1)).toStrictEqual({
      path: "",
      rule: "findings-stopped",
      message: "the check stopped after 1000 findings, so there may be more.",
      severity: "error",
    });
  });

  it("lists at most 1,000 findings of a list of numbers where strings belong, and of an entity", () => {
    const zeros = Array.from({ length: 1_000_000 }, () => 0);
    expect(validateCredential({ ...achievementCredential(), type: zeros })).toHaveLength(1001);
    expect(validateEntity("Profile", { ...PROFILE, type: zeros })).toHaveLength(1001);
    expect(validateEntity("Profile", { ...PROFILE, type: zeros }, { maxFindings: 7 })).toHaveLength(8);
  });

  it("keeps the findings in the order of the check, whatever the limit", () => {
    const value = { ...achievementCredential(), evidence: Array.from({ length: 500 }, () => ({})) };
    const some = validateCredential(value, { maxFindings: 5 });
    expect(some).toHaveLength(6);
    expect(validateCredential(value, { maxFindings: 9 }).slice(0, 5)).toStrictEqual(some.slice(0, 5));
  });

  it("does not stop a list that has exactly the limit", () => {
    const value = { ...achievementCredential(), id: 5, name: 7 };
    expect(validateCredential(value, { maxFindings: 2 })).toHaveLength(2);
    expect(stopped(validateCredential(value, { maxFindings: 1 }))).toBe(true);
  });

  it("makes a reader refuse a value whose errors stopped the check, and say that there may be more", () => {
    const value = { ...achievementCredential(), evidence: Array.from({ length: 50 }, () => ({})) };
    expect(() => readCredential(value, { maxFindings: 2 })).toThrow(
      "At least 1 more error: the check stopped at its limit, and validateCredential with a higher maxFindings lists more.",
    );
    expect(() => readEntity("Profile", { ...PROFILE, type: [0, 0, 0] }, { maxFindings: 1 })).toThrow(
      "There may be more errors: the check stopped at its limit, and validateEntity with a higher maxFindings lists more.",
    );
  });

  it("refuses a limit that is not a positive integer", () => {
    expect(() => validateCredential(achievementCredential(), { maxFindings: 0 })).toThrow(
      "The read options is invalid at maxFindings: expected a value of at least 1, found 0.",
    );
    expect(() => readEntity("Profile", PROFILE, JSON.parse('{"maxFindings":"5"}'))).toThrow(
      'The read options is invalid at maxFindings: expected a number, found "5".',
    );
    expect(() => validateEntity("Profile", PROFILE, JSON.parse('{"kind":"Profile"}'))).toThrow(DataError);
    expect(() => validateEntity("Profile", PROFILE, JSON.parse("null"))).toThrow(DataError);
  });
});

describe("the options and the kind", () => {
  it("refuses options that are not an object with a kind of CREDENTIAL_KINDS", () => {
    for (const options of [null, "x", [], { kind: "Badge" }, { kind: 5 }, { other: 1 }]) {
      expect(() => readCredential(achievementCredential(), JSON.parse(JSON.stringify(options)))).toThrow(DataError);
      expect(() => validateCredential(achievementCredential(), JSON.parse(JSON.stringify(options)))).toThrow(DataError);
    }
    expect(() => readCredential(achievementCredential(), JSON.parse('{"kind":"Badge"}'))).toThrow(
      "The read options is invalid at kind",
    );
  });

  it("refuses a kind of entity that is not one of ENTITY_KINDS, from JSON as well", () => {
    for (const kind of [null, 5, "Badge", {}, "achievement"]) {
      expect(() => readEntity(JSON.parse(JSON.stringify(kind)), PROFILE)).toThrow(DataError);
      expect(() => validateEntity(JSON.parse(JSON.stringify(kind)), PROFILE)).toThrow(DataError);
    }
  });
});

describe("the refusal of readEntity", () => {
  it("names the path of the first error, and refuses a subject that nothing identifies, which the schemas allow", () => {
    expect(() => readEntity("Profile", { id: 5, type: ["Profile"] })).toThrow(
      "The Profile is invalid at id: expected a string, found 5.",
    );
    expect(() => readEntity("ClrSubjectJwtPayload", { type: "ClrSubject", verifiableCredential: ["a.b.c"] })).toThrow(
      "The ClrSubjectJwtPayload is invalid: has neither an id nor an identifier",
    );
  });
});

describe("reading an entity", () => {
  it("reads a profile, an achievement and the keys, and returns a copy", () => {
    expect(readEntity("Profile", PROFILE)).toStrictEqual(PROFILE);
    expect(readEntity("Profile", PROFILE)).not.toBe(PROFILE);
    expect(readEntity("Achievement", ACHIEVEMENT)).toStrictEqual(ACHIEVEMENT);
    const jwk = { kty: "EC", crv: "P-256", x: "x", y: "y" };
    expect(readEntity("JWK", jwk)).toStrictEqual(jwk);
    expect(readEntity("JWKS", { keys: jwk })).toStrictEqual({ keys: [jwk] });
    const multikey = { id: "did:example:a#k", cryptosuite: "eddsa-rdfc-2022", publicKeyMultibase: "z6Mk" };
    expect(readEntity("Multikey", multikey)).toStrictEqual(multikey);
    expect(validateEntity("Multikey", { ...multikey, secretKey: "z" })).toHaveLength(1);
  });

  it("reads the answer of an API with a credential or a compact JWS, and writes one as a list", () => {
    const answer = readEntity("GetOpenBadgeCredentialsResponse", {
      credential: achievementCredential(),
      compactJwsString: "a.b.c",
    });
    expect(answer).toStrictEqual({ credential: [achievementCredential()], compactJwsString: ["a.b.c"] });
    expect(readEntity("GetClrCredentialsResponse", { credential: [clrCredential()] })).toStrictEqual({
      credential: [clrCredential()],
    });
    expect(readEntity("GetOpenBadgeCredentialsResponse", {})).toStrictEqual({});
    expect(
      validateEntity("GetOpenBadgeCredentialsResponse", { credential: [achievementCredential()], extra: 1 }),
    ).toHaveLength(1);
  });

  it("reads the status of an answer, and refuses a code that its vocabulary does not hold", () => {
    const status = {
      imsx_codeMajor: "failure",
      imsx_severity: "error",
      imsx_codeMinor: {
        imsx_codeMinorField: { imsx_codeMinorFieldName: "limit", imsx_codeMinorFieldValue: "invalid_query_parameter" },
      },
    };
    expect(readEntity("imsx_StatusInfo", status)).toMatchObject({
      imsx_codeMinor: { imsx_codeMinorField: [{ imsx_codeMinorFieldName: "limit" }] },
    });
    expect(validateEntity("imsx_StatusInfo", { ...status, imsx_codeMajor: "broken" })).toHaveLength(1);
  });

  it("reads the service description of an API and carries what OpenAPI adds", () => {
    const description = {
      openapi: "3.0.1",
      info: {
        title: "Badges",
        version: "1",
        termsOfService: "https://example.edu/terms",
        "x-imssf-privacyPolicyUrl": "https://example.edu/privacy",
      },
      components: {
        securitySchemes: {
          OAuth2ACG: {
            type: "oauth2",
            "x-imssf-registrationUrl": "https://example.edu/register",
            flows: { authorizationCode: {} },
          },
        },
      },
      paths: { "/credentials": {} },
    };
    expect(readEntity("ServiceDescriptionDocument", description)).toStrictEqual(description);
  });

  it("reads the payload of a CLR in a JWT, whose subject holds compact JWS strings", () => {
    const subject = { type: "ClrSubject", id: "did:example:learner", verifiableCredential: ["a.b.c"] };
    expect(readEntity("ClrSubjectJwtPayload", subject)).toMatchObject({
      type: ["ClrSubject"],
      verifiableCredential: ["a.b.c"],
    });
    expect(
      validateEntity("ClrSubjectJwtPayload", { type: "ClrSubject", verifiableCredential: ["a.b.c"] }),
    ).toStrictEqual([expect.objectContaining({ rule: "subject-unidentified" })]);
    const payload = { ...clrCredential(), credentialSubject: subject };
    expect(readEntity("ClrCredentialJwtPayload", payload)).toMatchObject({
      credentialSubject: { verifiableCredential: ["a.b.c"] },
    });
    expect(
      validateEntity("ClrCredentialJwtPayload", {
        ...payload,
        credentialSubject: { type: "ClrSubject", verifiableCredential: ["a.b.c"] },
      }),
    ).toStrictEqual([expect.objectContaining({ path: "credentialSubject", rule: "subject-unidentified" })]);
  });
});
