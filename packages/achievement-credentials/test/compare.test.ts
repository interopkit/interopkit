import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { isSameCredential, selectNewerCredential, summarizeCredential } from "../src/index.js";
import {
  ACHIEVEMENT,
  achievementCredential,
  achievementCredentialV1p1,
  clrCredential,
  endorsementCredential,
  PROFILE,
  verifiableCredential,
} from "./fixtures.js";

type Credential = Parameters<typeof selectNewerCredential>[0];

/** A credential with a change, for the comparisons. */
const credential = (change: Record<string, unknown>): Credential =>
  ({ ...achievementCredential(), ...change }) as never;

describe("isSameCredential", () => {
  it("is true for two credentials with the same id and the same issuer, whatever else they hold", () => {
    expect(isSameCredential(credential({}), credential({ name: "Other", validFrom: "2030-01-01T00:00:00Z" }))).toBe(
      true,
    );
  });

  it("compares the issuer by its id, whether it is a profile or an address", () => {
    expect(
      isSameCredential(credential({ issuer: PROFILE.id }), credential({ issuer: { ...PROFILE, name: "Renamed" } })),
    ).toBe(true);
    expect(
      isSameCredential(credential({ issuer: PROFILE.id }), credential({ issuer: "https://example.edu/issuers/2" })),
    ).toBe(false);
  });

  it("is false when the id differs, and for a credential that has none", () => {
    expect(isSameCredential(credential({}), credential({ id: "https://example.edu/credentials/2" }))).toBe(false);
    expect(isSameCredential(credential({ id: undefined }), credential({}))).toBe(false);
    expect(isSameCredential(credential({}), credential({ id: undefined }))).toBe(false);
    expect(isSameCredential(verifiableCredential() as never, verifiableCredential() as never)).toBe(false);
  });

  it("unescapes percent-encoded characters and trims white space before it compares (OB 10)", () => {
    expect(
      isSameCredential(
        credential({ id: "https://example.edu/credentials/a%20b" }),
        credential({ id: "https://example.edu/credentials/a b" }),
      ),
    ).toBe(true);
    expect(
      isSameCredential(
        credential({ id: "https://example.edu/%7Ecredentials/%C3%A9" }),
        credential({ id: "https://example.edu/~credentials/é" }),
      ),
    ).toBe(true);
    expect(isSameCredential(credential({ id: "  https://example.edu/credentials/1\n" }), credential({}))).toBe(true);
    expect(
      isSameCredential(
        credential({ issuer: " https://example.edu/issuers/1%2F" }),
        credential({ issuer: "https://example.edu/issuers/1/" }),
      ),
    ).toBe(true);
  });

  it("leaves a percent-encoded run that is not UTF-8 as it is, and compares case", () => {
    expect(
      isSameCredential(
        credential({ id: "https://example.edu/%E0%A4%A" }),
        credential({ id: "https://example.edu/%E0%A4%A" }),
      ),
    ).toBe(true);
    expect(
      isSameCredential(credential({ id: "https://example.edu/%FF" }), credential({ id: "https://example.edu/�" })),
    ).toBe(false);
    expect(isSameCredential(credential({ id: "https://example.edu/Credentials/1" }), credential({}))).toBe(false);
  });

  it("refuses a credential that is not an object with an issuer, as JavaScript or JSON hands it over", () => {
    for (const text of ["null", "5", '"text"', "[]", "{}", '{"issuer":5}', '{"issuer":{}}', '{"id":5,"issuer":"x"}']) {
      expect(() => isSameCredential(JSON.parse(text), credential({}))).toThrow(DataError);
      expect(() => isSameCredential(credential({}), JSON.parse(text))).toThrow(DataError);
    }
    expect(() => isSameCredential(JSON.parse("null"), credential({}))).toThrow(
      "The first credential is invalid: expected an object, found null.",
    );
    expect(() => isSameCredential(credential({}), JSON.parse("{}"))).toThrow(
      'The second credential is invalid: missing the property "issuer".',
    );
  });
});

describe("selectNewerCredential", () => {
  const older = credential({ validFrom: "2024-06-13T10:00:00Z" });
  const newer = credential({ validFrom: "2024-06-13T10:00:01Z" });

  it("returns the credential with the newer validFrom, whichever comes first, and the argument itself", () => {
    expect(selectNewerCredential(older, newer)).toBe(newer);
    expect(selectNewerCredential(newer, older)).toBe(newer);
  });

  it("returns the first when both became valid at the same instant", () => {
    const same = credential({ validFrom: "2024-06-13T12:00:00+02:00" });
    expect(selectNewerCredential(older, same)).toBe(older);
    expect(selectNewerCredential(same, older)).toBe(same);
  });

  it("compares the instants and not the text, so that an offset does not matter", () => {
    const early = credential({ validFrom: "2024-06-13T10:00:00+02:00" });
    const late = credential({ validFrom: "2024-06-13T09:00:00Z" });
    expect(selectNewerCredential(early, late)).toBe(late);
    expect(selectNewerCredential(late, early)).toBe(late);
  });

  it("compares the issuanceDate of a credential under the Verifiable Credentials Data Model 1.1", () => {
    const at = (issuanceDate: string) => ({ ...achievementCredentialV1p1(), issuanceDate }) as unknown as Credential;
    const [old, recent] = [at("2024-06-13T10:00:00Z"), at("2024-06-14T10:00:00Z")];
    expect(selectNewerCredential(old, recent)).toBe(recent);
    expect(selectNewerCredential(recent, old)).toBe(recent);
    expect(() => selectNewerCredential(old, at("2024-06-14"))).toThrow(
      "has no validFrom that is a date and time of RFC 3339 with an offset",
    );
  });

  it("refuses two credentials that are not the same credential", () => {
    expect(() => selectNewerCredential(older, credential({ id: "https://example.edu/credentials/2" }))).toThrow(
      "The credentials are not the same credential: they differ in id or in the id of the issuer.",
    );
    expect(() => selectNewerCredential(older, credential({ issuer: "https://example.edu/issuers/2" }))).toThrow(
      DataError,
    );
    expect(() => selectNewerCredential(credential({ id: undefined }), credential({ id: undefined }))).toThrow(
      DataError,
    );
  });

  it("refuses a credential with no validFrom that is a date and time with an offset", () => {
    expect(() => selectNewerCredential(credential({ validFrom: undefined }), older)).toThrow(
      "The first credential has no validFrom that is a date and time of RFC 3339 with an offset, found undefined.",
    );
    expect(() => selectNewerCredential(older, credential({ validFrom: "2024-06-13" }))).toThrow(
      'The second credential has no validFrom that is a date and time of RFC 3339 with an offset, found "2024-06-13".',
    );
  });

  it("refuses a credential that is not an object with an issuer, as JavaScript or JSON hands it over", () => {
    for (const text of ["null", "5", "[]", "{}", '{"validFrom":5}']) {
      expect(() => selectNewerCredential(JSON.parse(text), older)).toThrow(DataError);
      expect(() => selectNewerCredential(older, JSON.parse(text))).toThrow(DataError);
    }
  });
});

describe("summarizeCredential", () => {
  const badge = (change: Record<string, unknown> = {}) => ({ ...achievementCredential(), ...change }) as never;

  it("shows an achievement credential by its achievement when it has no name, description or image of its own", () => {
    const summary = summarizeCredential(badge({ issuer: { ...PROFILE, name: "Example University" } }));
    expect(summary).toStrictEqual({
      kind: "badge",
      name: "Course",
      description: "Passed the course.",
      issuerName: "Example University",
      issuer: PROFILE.id,
      validFrom: "2024-06-13T10:00:00Z",
    });
  });

  it("shows the date of the award beside validFrom, which a reissue moves", () => {
    const reissued = badge({ validFrom: "2025-01-01T00:00:00Z", awardedDate: "2024-06-13T10:00:00Z" });
    expect(summarizeCredential(reissued)).toMatchObject({
      validFrom: "2025-01-01T00:00:00Z",
      awardedDate: "2024-06-13T10:00:00Z",
    });
    expect(summarizeCredential(badge())).not.toHaveProperty("awardedDate");
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
    expect(summarizeCredential(own)).toMatchObject({
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
    expect(summarizeCredential(fromAchievement).image).toBe("https://example.edu/achievement.png");
  });

  it("takes the issuer from an address as well as from a profile, which then has no name to show", () => {
    expect(summarizeCredential(badge({ issuer: PROFILE.id }))).toMatchObject({ issuer: PROFILE.id });
    expect(summarizeCredential(badge({ issuer: PROFILE.id }))).not.toHaveProperty("issuerName");
    expect(summarizeCredential(badge())).not.toHaveProperty("issuerName");
  });

  it("shows an endorsement and a CLR by their own names", () => {
    expect(summarizeCredential(endorsementCredential() as never)).toMatchObject({
      kind: "endorsement",
      name: "Endorsement",
    });
    expect(summarizeCredential(clrCredential() as never)).toMatchObject({ kind: "clr", name: "Transcript" });
  });

  it("shows a credential under the Verifiable Credentials Data Model 1.1 by issuanceDate and expirationDate", () => {
    const old = { ...achievementCredentialV1p1(), expirationDate: "2030-01-01T00:00:00Z" } as never;
    expect(summarizeCredential(old)).toMatchObject({
      kind: "badge",
      name: "Course badge",
      validFrom: "2024-06-13T10:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
    });
  });

  it("refuses a VerifiableCredential that no class of Open Badges or CLR describes, and a value that is not a credential", () => {
    expect(() => summarizeCredential(verifiableCredential() as never)).toThrow(
      "The credential is a VerifiableCredential of no class that Open Badges or CLR defines, so there is nothing to show.",
    );
    for (const text of ["null", "5", "[]", "{}"])
      expect(() => summarizeCredential(JSON.parse(text))).toThrow(DataError);
    expect(() => summarizeCredential(badge({ validFrom: "x" }))).toThrow("The credential is invalid at validFrom");
  });
});
