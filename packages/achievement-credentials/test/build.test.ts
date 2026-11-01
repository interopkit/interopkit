import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { deepFreeze } from "../../../scripts/json-mutation.js";
import {
  buildAchievementCredential,
  buildClrCredential,
  buildEndorsementCredential,
  CONTEXTS,
  caseAlignment,
  readCredential,
  readEntity,
  validateCredential,
} from "../src/index.js";
import { ACHIEVEMENT, achievementCredential, PROFILE } from "./fixtures.js";

const ISSUED = "2024-06-13T10:00:00Z";

/** The smallest input of an AchievementCredential. */
function achievementInput() {
  return {
    id: "https://example.edu/credentials/1",
    issuer: PROFILE,
    validFrom: ISSUED,
    name: "Course badge",
    subject: { id: "did:example:learner" },
    achievement: ACHIEVEMENT,
  };
}

const CREDENTIAL_SCHEMA = {
  id: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json",
  type: "1EdTechJsonSchemaValidator2019",
};

describe("buildAchievementCredential", () => {
  it("writes the contexts, the types, the subject and the official schema around the input", () => {
    expect(buildAchievementCredential(achievementInput())).toStrictEqual({
      "@context": [CONTEXTS.credentialsV2, CONTEXTS.openBadges, CONTEXTS.extensions],
      id: "https://example.edu/credentials/1",
      type: ["VerifiableCredential", "OpenBadgeCredential"],
      name: "Course badge",
      issuer: PROFILE,
      validFrom: ISSUED,
      credentialSubject: { type: ["AchievementSubject"], id: "did:example:learner", achievement: ACHIEVEMENT },
      credentialSchema: [CREDENTIAL_SCHEMA],
    });
  });

  it("is a credential that readCredential reads as itself and validateCredential finds sound", () => {
    const credential = buildAchievementCredential(achievementInput());
    expect(readCredential(credential)).toStrictEqual(credential);
    expect(validateCredential(credential)).toStrictEqual([]);
    expect(credential.credentialSchema?.[0]).toStrictEqual(CREDENTIAL_SCHEMA);
  });

  it("carries every optional part of the input", () => {
    const evidence = [{ type: ["Evidence"], narrative: "A portfolio." }];
    const credential = buildAchievementCredential({
      ...achievementInput(),
      description: "Passed.",
      image: { id: "https://example.edu/badge.png", type: "Image" },
      validUntil: "2030-01-01T00:00:00Z",
      awardedDate: ISSUED,
      subject: {
        identifier: [
          { type: "IdentityObject", hashed: false, identityHash: "a@example.com", identityType: "emailAddress" },
        ],
        result: [{ type: ["Result"], value: "A" }],
        activityStartDate: "2024-01-01T00:00:00Z",
        activityEndDate: "2024-05-01T00:00:00Z",
        creditsEarned: 3,
        role: "Student",
        term: "Spring",
      },
      evidence,
      endorsement: [],
      endorsementJwt: ["a.b.c"],
      credentialStatus: { id: "https://example.edu/status/1#5", type: "BitstringStatusListEntry" },
      refreshService: { id: "https://example.edu/refresh/1", type: "1EdTechCredentialRefresh" },
      termsOfUse: [{ type: "Terms" }],
    });
    expect(credential).toMatchObject({
      description: "Passed.",
      validUntil: "2030-01-01T00:00:00Z",
      awardedDate: ISSUED,
      credentialSubject: { creditsEarned: 3, role: "Student", term: "Spring", result: [{ value: "A" }] },
      evidence,
      endorsementJwt: ["a.b.c"],
      credentialStatus: { type: "BitstringStatusListEntry" },
      termsOfUse: [{ type: "Terms" }],
    });
    expect(validateCredential(credential)).toStrictEqual([]);
  });

  it("does not change its input, and shares nothing with it", () => {
    const input = deepFreeze(achievementInput());
    const credential = buildAchievementCredential(input);
    expect(credential.issuer).not.toBe(input.issuer);
    expect(credential.credentialSubject.achievement).not.toBe(input.achievement);
    expect(input).toStrictEqual(achievementInput());
  });

  it("refuses an input that has a fault, and names every fault", () => {
    expect(() =>
      buildAchievementCredential({
        ...achievementInput(),
        id: "relative/path",
        validFrom: "2024-06-13",
        name: 5 as never,
      }),
    ).toThrow(
      /^The input is invalid: id: expected a URI with a scheme.*; validFrom: expected a date and time as RFC 3339.*; name: expected a string, found 5\.$/u,
    );
  });

  it("refuses a property that the input does not have, and an input that is missing one", () => {
    expect(() => buildAchievementCredential({ ...achievementInput(), validFrm: ISSUED } as never)).toThrow(
      'The input is invalid: validFrm: unexpected property "validFrm".',
    );
    const { achievement: _, ...without } = achievementInput();
    expect(() => buildAchievementCredential(without as never)).toThrow(
      'The input is invalid: achievement: missing the property "achievement".',
    );
  });

  it("refuses a subject that nothing identifies, which the schemas allow", () => {
    expect(() => buildAchievementCredential({ ...achievementInput(), subject: {} })).toThrow(
      "The credential is invalid: credentialSubject: has neither an id nor an identifier",
    );
  });

  it("refuses a class of the input that is wrong, with the path in the input's own terms", () => {
    expect(() =>
      buildAchievementCredential({ ...achievementInput(), achievement: { ...ACHIEVEMENT, name: 5 } as never }),
    ).toThrow("The input is invalid: achievement.name: expected a string, found 5.");
    expect(() => buildAchievementCredential({ ...achievementInput(), issuer: { id: "x" } as never })).toThrow(
      'issuer.type: missing the property "type"',
    );
  });

  it("refuses an input that nests too deep, and one that is not JSON", () => {
    let deep: Record<string, unknown> = { ...PROFILE };
    for (let level = 0; level < 100; level += 1) deep = { ...PROFILE, parentOrg: deep };
    expect(() => buildAchievementCredential({ ...achievementInput(), issuer: deep as never })).toThrow(
      "nests more than 64 levels",
    );
    expect(() => buildAchievementCredential({ ...achievementInput(), name: (() => 1) as never })).toThrow(DataError);
  });
});

describe("buildEndorsementCredential", () => {
  const input = () => ({
    id: "https://example.edu/endorsements/1",
    issuer: PROFILE,
    validFrom: ISSUED,
    name: "Endorsement",
    endorses: "https://example.edu/achievements/1",
  });

  it("writes the subject that names what is endorsed, and the official schema", () => {
    expect(buildEndorsementCredential(input())).toStrictEqual({
      "@context": [CONTEXTS.credentialsV2, CONTEXTS.openBadges, CONTEXTS.extensions],
      id: "https://example.edu/endorsements/1",
      type: ["VerifiableCredential", "EndorsementCredential"],
      name: "Endorsement",
      issuer: PROFILE,
      validFrom: ISSUED,
      credentialSubject: { id: "https://example.edu/achievements/1", type: ["EndorsementSubject"] },
      credentialSchema: [
        {
          id: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_endorsementcredential_schema.json",
          type: "1EdTechJsonSchemaValidator2019",
        },
      ],
    });
  });

  it("carries the comment, the validity and the status, and reads as itself", () => {
    const credential = buildEndorsementCredential({
      ...input(),
      comment: "Rigorous.",
      validUntil: "2030-01-01T00:00:00Z",
      credentialStatus: { id: "https://example.edu/status/2#7", type: "BitstringStatusListEntry" },
    });
    expect(credential).toMatchObject({
      credentialSubject: { endorsementComment: "Rigorous." },
      validUntil: "2030-01-01T00:00:00Z",
    });
    expect(readCredential(credential)).toStrictEqual(credential);
  });

  it("refuses a property that the input does not have", () => {
    expect(() => buildEndorsementCredential({ ...input(), endorsing: "x" } as never)).toThrow(
      'The input is invalid: endorsing: unexpected property "endorsing".',
    );
  });

  it("refuses an input with faults, and names every one", () => {
    expect(() => buildEndorsementCredential({ ...input(), endorses: 7 as never, validFrom: "x" })).toThrow(
      /^The input is invalid: validFrom: expected a date and time.*; endorses: expected a string, found 7\.$/u,
    );
  });
});

describe("buildClrCredential", () => {
  const input = () => ({
    id: "https://example.edu/clrs/1",
    issuer: PROFILE,
    validFrom: ISSUED,
    name: "Transcript",
    subject: { id: "did:example:learner" },
    credentials: [achievementCredential() as never],
  });

  it("writes the three contexts, the subject that holds the credentials, and the official schema", () => {
    const clr = buildClrCredential(input());
    expect(clr).toStrictEqual({
      "@context": [CONTEXTS.credentialsV2, CONTEXTS.clr, CONTEXTS.openBadges, CONTEXTS.extensions],
      id: "https://example.edu/clrs/1",
      type: ["VerifiableCredential", "ClrCredential"],
      name: "Transcript",
      issuer: PROFILE,
      validFrom: ISSUED,
      credentialSubject: {
        type: ["ClrSubject"],
        id: "did:example:learner",
        verifiableCredential: [achievementCredential()],
      },
      credentialSchema: [
        {
          id: "https://purl.imsglobal.org/spec/clr/v2p0/schema/json/clr_v2p0_clrcredential_schema.json",
          type: "1EdTechJsonSchemaValidator2019",
        },
      ],
    });
    expect(readCredential(clr)).toStrictEqual(clr);
  });

  it("carries the associations, the partial flag and the status", () => {
    const clr = buildClrCredential({
      ...input(),
      associations: [
        {
          type: "Association",
          associationType: "isPartOf",
          sourceId: "https://example.edu/a/1",
          targetId: "https://example.edu/a/2",
        },
      ],
      partial: true,
      validUntil: "2030-01-01T00:00:00Z",
      credentialStatus: { id: "https://example.edu/status/3#1", type: "BitstringStatusListEntry" },
      refreshService: { id: "https://example.edu/refresh/3", type: "1EdTechCredentialRefresh" },
    });
    expect(clr).toMatchObject({ partial: true, credentialSubject: { association: [{ associationType: "isPartOf" }] } });
    expect(validateCredential(clr)).toStrictEqual([]);
  });

  it("writes the payload of a CLR in a JWT when its credentials are compact JWS", () => {
    const payload = buildClrCredential({ ...input(), credentials: ["a.b.c", "d.e.f"] });
    expect(payload).toMatchObject({
      credentialSubject: { type: ["ClrSubject"], verifiableCredential: ["a.b.c", "d.e.f"] },
    });
    expect(readEntity("ClrCredentialJwtPayload", payload)).toStrictEqual(payload);
  });

  it("refuses a list of credentials that is empty, that mixes the two forms, or holds a credential that is wrong", () => {
    expect(() => buildClrCredential({ ...input(), credentials: [] })).toThrow(
      "credentials: expected a length of at least 1, found 0.",
    );
    expect(() =>
      buildClrCredential({ ...input(), credentials: [achievementCredential() as never, "a.b.c" as never] }),
    ).toThrow(DataError);
    expect(() => buildClrCredential({ ...input(), credentials: ["a.b.c", 5 as never] })).toThrow(
      "credentials[1]: expected a string, found 5.",
    );
    expect(() =>
      buildClrCredential({ ...input(), credentials: [{ ...achievementCredential(), id: 5 } as never] }),
    ).toThrow("credentials[0].id: expected a string, found 5.");
    expect(() => buildClrCredential({ ...input(), credentials: "a.b.c" as never })).toThrow(DataError);
  });

  it("refuses a learner that nothing identifies, in either form", () => {
    expect(() => buildClrCredential({ ...input(), subject: {} })).toThrow(
      "credentialSubject: has neither an id nor an identifier",
    );
    expect(() => buildClrCredential({ ...input(), subject: {}, credentials: ["a.b.c"] })).toThrow(
      "credentialSubject: has neither an id nor an identifier",
    );
  });
});

describe("caseAlignment", () => {
  it("builds the alignment to an item of a CASE framework, with its code and framework when it has them", () => {
    const item = { uri: "https://standards.example.org/ims/case/v1p1/CFItems/2b6d1c9e", name: "Understand fractions" };
    expect(caseAlignment(item)).toStrictEqual({
      type: ["Alignment"],
      targetUrl: item.uri,
      targetName: item.name,
      targetType: "CFItem",
    });
    expect(caseAlignment({ ...item, code: "3.NF.A.1", framework: "Common Core" })).toMatchObject({
      targetCode: "3.NF.A.1",
      targetFramework: "Common Core",
    });
  });

  it("is an alignment that a credential can hold", () => {
    const alignment = caseAlignment({ uri: "https://standards.example.org/items/1", name: "Fractions" });
    const credential = buildAchievementCredential({
      ...achievementInput(),
      achievement: { ...ACHIEVEMENT, alignment: [alignment] },
    });
    expect(readCredential(credential)).toStrictEqual(credential);
  });

  it("refuses an item that is wrong, and names every fault", () => {
    expect(() => caseAlignment({ uri: "items/1", name: 5 as never })).toThrow(
      /^The item is invalid: uri: expected a URI with a scheme.*; name: expected a string, found 5\.$/u,
    );
    expect(() => caseAlignment({ uri: "https://x.example/1", name: "n", extra: 1 } as never)).toThrow(
      'unexpected property "extra"',
    );
  });
});

describe("the builders on input of other types", () => {
  const builders = [
    ["buildAchievementCredential", buildAchievementCredential],
    ["buildEndorsementCredential", buildEndorsementCredential],
    ["buildClrCredential", buildClrCredential],
    ["caseAlignment", caseAlignment],
  ] as const;

  it.each(builders)("%s refuses what JSON or JavaScript hands over that is not its input", (_name, build) => {
    for (const text of ["null", "5", '"text"', "[]", "{}", '{"id":5}']) {
      expect(() => (build as (input: unknown) => unknown)(JSON.parse(text))).toThrow(DataError);
    }
    expect(() => (build as (input: unknown) => unknown)(undefined)).toThrow(DataError);
  });
});
