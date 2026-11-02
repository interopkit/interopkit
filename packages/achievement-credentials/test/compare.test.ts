import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { credentialSummary, newerCredential, sameCredential } from "../src/index.js";
import {
  ACHIEVEMENT,
  achievementCredential,
  achievementCredentialV1p1,
  clrCredential,
  endorsementCredential,
  PROFILE,
  verifiableCredential,
} from "./fixtures.js";

type Credential = Parameters<typeof newerCredential>[0];

/** A credential with a change, for the comparisons. */
const credential = (change: Record<string, unknown>): Credential =>
  ({ ...achievementCredential(), ...change }) as never;

describe("sameCredential", () => {
  it("is true for two credentials with the same id and the same issuer, whatever else they hold", () => {
    expect(sameCredential(credential({}), credential({ name: "Other", validFrom: "2030-01-01T00:00:00Z" }))).toBe(true);
  });

  it("compares the issuer by its id, whether it is a profile or an address", () => {
    expect(
      sameCredential(credential({ issuer: PROFILE.id }), credential({ issuer: { ...PROFILE, name: "Renamed" } })),
    ).toBe(true);
    expect(
      sameCredential(credential({ issuer: PROFILE.id }), credential({ issuer: "https://example.edu/issuers/2" })),
    ).toBe(false);
  });

  it("is false when the id differs, and for a credential that has none", () => {
    expect(sameCredential(credential({}), credential({ id: "https://example.edu/credentials/2" }))).toBe(false);
    expect(sameCredential(credential({ id: undefined }), credential({}))).toBe(false);
    expect(sameCredential(credential({}), credential({ id: undefined }))).toBe(false);
    expect(sameCredential(verifiableCredential() as never, verifiableCredential() as never)).toBe(false);
  });

  it("unescapes percent-encoded characters and trims white space before it compares (OB 10)", () => {
    expect(
      sameCredential(
        credential({ id: "https://example.edu/credentials/a%20b" }),
        credential({ id: "https://example.edu/credentials/a b" }),
      ),
    ).toBe(true);
    expect(
      sameCredential(
        credential({ id: "https://example.edu/%7Ecredentials/%C3%A9" }),
        credential({ id: "https://example.edu/~credentials/é" }),
      ),
    ).toBe(true);
    expect(sameCredential(credential({ id: "  https://example.edu/credentials/1\n" }), credential({}))).toBe(true);
    expect(
      sameCredential(
        credential({ issuer: " https://example.edu/issuers/1%2F" }),
        credential({ issuer: "https://example.edu/issuers/1/" }),
      ),
    ).toBe(true);
  });

  it("leaves a percent-encoded run that is not UTF-8 as it is, and compares case", () => {
    expect(
      sameCredential(
        credential({ id: "https://example.edu/%E0%A4%A" }),
        credential({ id: "https://example.edu/%E0%A4%A" }),
      ),
    ).toBe(true);
    expect(
      sameCredential(credential({ id: "https://example.edu/%FF" }), credential({ id: "https://example.edu/�" })),
    ).toBe(false);
    expect(sameCredential(credential({ id: "https://example.edu/Credentials/1" }), credential({}))).toBe(false);
  });

  it("refuses a credential that is not an object with an issuer, as JavaScript or JSON hands it over", () => {
    for (const text of ["null", "5", '"text"', "[]", "{}", '{"issuer":5}', '{"issuer":{}}', '{"id":5,"issuer":"x"}']) {
      expect(() => sameCredential(JSON.parse(text), credential({}))).toThrow(DataError);
      expect(() => sameCredential(credential({}), JSON.parse(text))).toThrow(DataError);
    }
    expect(() => sameCredential(JSON.parse("null"), credential({}))).toThrow(
      "The first credential is invalid: expected an object, found null.",
    );
    expect(() => sameCredential(credential({}), JSON.parse("{}"))).toThrow(
      'The second credential is invalid: missing the property "issuer".',
    );
  });
});

describe("newerCredential", () => {
  const older = credential({ validFrom: "2024-06-13T10:00:00Z" });
  const newer = credential({ validFrom: "2024-06-13T10:00:01Z" });

  it("returns the credential with the newer validFrom, whichever comes first, and the argument itself", () => {
    expect(newerCredential(older, newer)).toBe(newer);
    expect(newerCredential(newer, older)).toBe(newer);
  });

  it("returns the first when both became valid at the same instant", () => {
    const same = credential({ validFrom: "2024-06-13T12:00:00+02:00" });
    expect(newerCredential(older, same)).toBe(older);
    expect(newerCredential(same, older)).toBe(same);
  });

  it("compares the instants and not the text, so that an offset does not matter", () => {
    const early = credential({ validFrom: "2024-06-13T10:00:00+02:00" });
    const late = credential({ validFrom: "2024-06-13T09:00:00Z" });
    expect(newerCredential(early, late)).toBe(late);
    expect(newerCredential(late, early)).toBe(late);
  });

  it("compares the issuanceDate of a credential under the Verifiable Credentials Data Model 1.1", () => {
    const at = (issuanceDate: string) => ({ ...achievementCredentialV1p1(), issuanceDate }) as unknown as Credential;
    const [old, recent] = [at("2024-06-13T10:00:00Z"), at("2024-06-14T10:00:00Z")];
    expect(newerCredential(old, recent)).toBe(recent);
    expect(newerCredential(recent, old)).toBe(recent);
    expect(() => newerCredential(old, at("2024-06-14"))).toThrow(
      "has no validFrom that is a date and time of RFC 3339 with an offset",
    );
  });

  it("refuses two credentials that are not the same credential", () => {
    expect(() => newerCredential(older, credential({ id: "https://example.edu/credentials/2" }))).toThrow(
      "The credentials are not the same credential: they differ in id or in the id of the issuer.",
    );
    expect(() => newerCredential(older, credential({ issuer: "https://example.edu/issuers/2" }))).toThrow(DataError);
    expect(() => newerCredential(credential({ id: undefined }), credential({ id: undefined }))).toThrow(DataError);
  });

  it("refuses a credential with no validFrom that is a date and time with an offset", () => {
    expect(() => newerCredential(credential({ validFrom: undefined }), older)).toThrow(
      "The first credential has no validFrom that is a date and time of RFC 3339 with an offset, found undefined.",
    );
    expect(() => newerCredential(older, credential({ validFrom: "2024-06-13" }))).toThrow(
      'The second credential has no validFrom that is a date and time of RFC 3339 with an offset, found "2024-06-13".',
    );
  });

  it("refuses a credential that is not an object with an issuer, as JavaScript or JSON hands it over", () => {
    for (const text of ["null", "5", "[]", "{}", '{"validFrom":5}']) {
      expect(() => newerCredential(JSON.parse(text), older)).toThrow(DataError);
      expect(() => newerCredential(older, JSON.parse(text))).toThrow(DataError);
    }
  });
});

describe("credentialSummary", () => {
  const badge = (change: Record<string, unknown> = {}) => ({ ...achievementCredential(), ...change }) as never;

  it("shows an achievement credential by its achievement when it has no name, description or image of its own", () => {
    const summary = credentialSummary(badge({ issuer: { ...PROFILE, name: "Example University" } }));
    expect(summary).toStrictEqual({
      kind: "badge",
      name: "Course",
      description: "Passed the course.",
      issuerName: "Example University",
      issuer: PROFILE.id,
      validFrom: "2024-06-13T10:00:00Z",
    });
  });

  it("shows the name, description and image of the credential before those of the achievement", () => {
    const own = badge({
      name: "Course badge",
      description: "Awarded for the course.",
      image: { id: "https://example.edu/badge.png", type: "Image" },
      validUntil: "2030-01-01T00:00:00Z",
      credentialSubject: {
        ...(achievementCredential().credentialSubject as object),
        achievement: { ...ACHIEVEMENT, image: { id: "https://example.edu/achievement.png", type: "Image" } },
      },
    });
    expect(credentialSummary(own)).toMatchObject({
      name: "Course badge",
      description: "Awarded for the course.",
      image: "https://example.edu/badge.png",
      validUntil: "2030-01-01T00:00:00Z",
    });
    const fromAchievement = badge({
      credentialSubject: {
        ...(achievementCredential().credentialSubject as object),
        achievement: { ...ACHIEVEMENT, image: { id: "https://example.edu/achievement.png", type: "Image" } },
      },
    });
    expect(credentialSummary(fromAchievement).image).toBe("https://example.edu/achievement.png");
  });

  it("takes the issuer from an address as well as from a profile, which then has no name to show", () => {
    expect(credentialSummary(badge({ issuer: PROFILE.id }))).toMatchObject({ issuer: PROFILE.id });
    expect(credentialSummary(badge({ issuer: PROFILE.id }))).not.toHaveProperty("issuerName");
    expect(credentialSummary(badge())).not.toHaveProperty("issuerName");
  });

  it("shows an endorsement and a CLR by their own names", () => {
    expect(credentialSummary(endorsementCredential() as never)).toMatchObject({
      kind: "endorsement",
      name: "Endorsement",
    });
    expect(credentialSummary(clrCredential() as never)).toMatchObject({ kind: "clr", name: "Transcript" });
  });

  it("shows a credential under the Verifiable Credentials Data Model 1.1 by issuanceDate and expirationDate", () => {
    const old = { ...achievementCredentialV1p1(), expirationDate: "2030-01-01T00:00:00Z" } as never;
    expect(credentialSummary(old)).toMatchObject({
      kind: "badge",
      name: "Course badge",
      validFrom: "2024-06-13T10:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
    });
  });

  it("refuses a VerifiableCredential that no class of Open Badges or CLR describes, and a value that is not a credential", () => {
    expect(() => credentialSummary(verifiableCredential() as never)).toThrow(
      "The credential is a VerifiableCredential of no class that Open Badges or CLR defines, so there is nothing to show.",
    );
    for (const text of ["null", "5", "[]", "{}"]) expect(() => credentialSummary(JSON.parse(text))).toThrow(DataError);
    expect(() => credentialSummary(badge({ validFrom: "x" }))).toThrow("The credential is invalid at validFrom");
  });
});
