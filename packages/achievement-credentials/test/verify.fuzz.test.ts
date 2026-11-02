import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { VERIFICATION_CHECKS } from "../src/index.js";
import { verifyCredential } from "../src/verify/index.js";
import { KEYS } from "./key-fixtures.js";
import { world } from "./status-fixtures.js";
import { badge, forge, jwsOf } from "./verify-fixtures.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_109, numRuns: 100 };

const BASE64URL = fc.stringMatching(/^[A-Za-z0-9_-]{1,40}$/u);

describe("the verification of any input", () => {
  it("gives a result of eight checks, none of them verified, or refuses an input that is no string and no object", async () => {
    const { options } = world();
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string({ maxLength: 300 }), fc.jsonValue({ maxDepth: 4 })), async (input) => {
        const verifiable =
          typeof input === "string" || (typeof input === "object" && input !== null && !Array.isArray(input));
        if (!verifiable) {
          await expect(verifyCredential(input as never, options)).rejects.toBeInstanceOf(DataError);
          return;
        }
        const result = await verifyCredential(input, options);
        expect(result.verified).toBe(false);
        expect(result.checks.map(({ check }) => check)).toStrictEqual([...VERIFICATION_CHECKS]);
        expect(result.credential).toBeUndefined();
      }),
      RUNS,
    );
  });

  it("gives a result that is not verified for any three parts of base64url, which are no signature of a key", async () => {
    const { options } = world();
    await fc.assert(
      fc.asyncProperty(fc.tuple(BASE64URL, BASE64URL, BASE64URL), async ([header, payload, signature]) => {
        const result = await verifyCredential(`${header}.${payload}.${signature}`, options);
        expect(result.verified).toBe(false);
        expect(result.checks).toHaveLength(VERIFICATION_CHECKS.length);
      }),
      RUNS,
    );
  });

  it("does not verify a credential in a JWS of which any one character has been changed", async () => {
    const { options } = world();
    const jws = await jwsOf();
    expect((await verifyCredential(jws, options)).verified).toBe(true);
    await fc.assert(
      fc.asyncProperty(fc.nat(jws.length - 1), fc.constantFrom("A", "b", "9", "-", "_", "."), async (at, character) => {
        if (jws[at] === character) return;
        const changed = `${jws.slice(0, at)}${character}${jws.slice(at + 1)}`;
        expect((await verifyCredential(changed, options)).verified).toBe(false);
      }),
      RUNS,
    );
  });

  it("gives a result for a signed credential whose status, schema, refresh service or endorsements are any JSON", async () => {
    const { options } = world();
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("credentialStatus", "credentialSchema", "refreshService", "endorsementJwt", "endorsement"),
        fc.jsonValue({ maxDepth: 3 }),
        async (property, value) => {
          const jws = await forge({ ...badge(), iss: "https://example.edu/issuers/1", [property]: value }, KEYS.es256);
          const result = await verifyCredential(jws, options);
          expect(result.checks).toHaveLength(VERIFICATION_CHECKS.length);
          expect(typeof result.verified).toBe("boolean");
        },
      ),
      RUNS,
    );
  });
});

describe("the limits of the input", () => {
  it("hold for any limit: a credential over a limit is a format failure and one within them is verified", async () => {
    const { options } = world();
    const jws = await jwsOf();
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 3000 }), async (maxInputBytes) => {
        const result = await verifyCredential(jws, { ...options, maxInputBytes });
        expect(result.verified).toBe(maxInputBytes >= jws.length);
        if (maxInputBytes < jws.length) expect(result.checks[0]?.outcome).toBe("failed");
      }),
      RUNS,
    );
  });
});
