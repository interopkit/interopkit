import { createHash } from "node:crypto";
import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hashIdentifier, matchesIdentifier } from "../src/index.js";

const RUNS = { seed: 20_241_104, numRuns: 200 };

/** The hash of text by an independent implementation. */
const oracle = (algorithm: "sha256" | "md5", text: string) =>
  `${algorithm}$${createHash(algorithm).update(text, "utf8").digest("hex")}`;

describe("hashIdentifier", () => {
  it("hashes the identifier and the salt as the specification's example does", () => {
    // OB B.7, IdentityHash: the email identifier 'a@example.com' salted with 'Kosher'.
    expect(hashIdentifier("a@example.com", "Kosher")).toBe(
      "sha256$b5809d8a92f8858436d7e6b87c12ebc0ae1eac4baecc2c0b913aee2c922ef399",
    );
  });

  it("is the SHA-256 of the UTF-8 of the identifier followed by the salt, whatever they are", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), fc.string({ unit: "binary" }), (value, salt) => {
        expect(hashIdentifier(value, salt)).toBe(oracle("sha256", `${value}${salt}`));
      }),
      RUNS,
    );
  });

  it("does not salt the identifier when the salt is empty", () => {
    expect(hashIdentifier("a@example.com", "")).toBe(oracle("sha256", "a@example.com"));
  });

  it("refuses an argument that is not a string, as JavaScript or JSON hands it over", () => {
    for (const value of [null, 5, {}, [], undefined]) {
      expect(() => hashIdentifier(JSON.parse(JSON.stringify(value ?? null)), "")).toThrow(DataError);
      expect(() => hashIdentifier("a", JSON.parse(JSON.stringify(value ?? null)))).toThrow(DataError);
    }
    expect(() => hashIdentifier(JSON.parse("5"), "")).toThrow("The identifier is invalid: expected a string, found 5.");
  });
});

describe("matchesIdentifier", () => {
  const email = { type: "emailAddress", value: "a@example.com" };
  const hashed = (salt: string | undefined, algorithm: "sha256" | "md5" = "sha256") => ({
    type: "IdentityObject" as const,
    hashed: true,
    identityHash: oracle(algorithm, `${email.value}${salt ?? ""}`),
    identityType: "emailAddress" as const,
    ...(salt === undefined ? {} : { salt }),
  });

  it("matches a plain value that equals the known one, and no other, of the same type", () => {
    const plain = {
      type: "IdentityObject" as const,
      hashed: false,
      identityHash: "a@example.com",
      identityType: "emailAddress" as const,
    };
    expect(matchesIdentifier(plain, email)).toBe(true);
    expect(matchesIdentifier({ ...plain, identityHash: "A@example.com" }, email)).toBe(false);
    expect(matchesIdentifier(plain, { ...email, type: "userName" })).toBe(false);
  });

  it("hashes the known value with the salt of the recipient and compares it with the hash it holds (OB 9.3)", () => {
    expect(matchesIdentifier(hashed("Kosher"), email)).toBe(true);
    expect(matchesIdentifier(hashed(undefined), email)).toBe(true);
    expect(matchesIdentifier(hashed("Kosher"), { ...email, value: "b@example.com" })).toBe(false);
    expect(matchesIdentifier({ ...hashed("Kosher"), salt: "Other" }, email)).toBe(false);
  });

  it("reads the algorithm from the hash, and either case of its digits", () => {
    expect(matchesIdentifier(hashed("Kosher", "md5"), email)).toBe(true);
    const upper = hashed("Kosher");
    expect(
      matchesIdentifier({ ...upper, identityHash: `sha256$${upper.identityHash.slice(7).toUpperCase()}` }, email),
    ).toBe(true);
    expect(matchesIdentifier({ ...upper, identityHash: upper.identityHash.replace("sha256", "sha1") }, email)).toBe(
      false,
    );
    expect(matchesIdentifier({ ...upper, identityHash: "no-separator" }, email)).toBe(false);
  });

  it("matches the recipient of an Open Badges 2.0 assertion, by its own fields", () => {
    const type = "email";
    const v2 = { identity: oracle("sha256", "a@example.comKosher"), type, hashed: true, salt: "Kosher" };
    expect(matchesIdentifier(v2, { type, value: email.value })).toBe(true);
    expect(
      matchesIdentifier({ ...v2, identity: oracle("md5", "a@example.comKosher") }, { type, value: email.value }),
    ).toBe(true);
    expect(matchesIdentifier({ identity: "a@example.com", type, hashed: false }, { type, value: email.value })).toBe(
      true,
    );
    expect(
      matchesIdentifier({ identity: "a@example.com", type: "url", hashed: false }, { type, value: email.value }),
    ).toBe(false);
  });

  it("refuses an identity or a known identity that is not of the forms, as JavaScript or JSON hands it over", () => {
    const parse = (text: string) => JSON.parse(text);
    for (const identity of [
      "null",
      "5",
      "[]",
      '{"identity":5}',
      '{"identityHash":"x"}',
      '{"identity":"x","type":"email","hashed":true,"extra":1}',
    ]) {
      expect(() => matchesIdentifier(parse(identity), email)).toThrow(DataError);
    }
    for (const known of [
      "null",
      '{"type":"emailAddress"}',
      '{"type":5,"value":"x"}',
      '{"type":"a","value":"b","salt":"c"}',
    ]) {
      expect(() => matchesIdentifier(hashed("Kosher"), parse(known))).toThrow(DataError);
    }
    expect(() => matchesIdentifier(parse('{"identityHash":"x"}'), email)).toThrow(
      'The identity is invalid: missing the property "type".',
    );
  });

  it("is true for the hash that hashIdentifier writes, for any identifier and salt", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (value, salt) => {
        const identity = {
          type: "IdentityObject" as const,
          hashed: true,
          identityHash: hashIdentifier(value, salt),
          identityType: "systemId" as const,
          salt,
        };
        expect(matchesIdentifier(identity, { type: "systemId", value })).toBe(true);
      }),
      RUNS,
    );
  });
});
