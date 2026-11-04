import { DataError } from "@interopkit/core";
import { createIssueSink } from "@interopkit/core/checks";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAD_STRINGS, mutate, mutations } from "../../../scripts/json-mutation.js";
import { soundAssertion, soundRevocationList } from "../../../scripts/open-badges-v2-rules.js";
import { CONTEXTS, readCredential, summarizeCredential, validateCredential } from "../src/index.js";
import { inspectDocumentV2, readJwsPayload } from "../src/read/internal.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_261_102, numRuns: 300 };

/** Values of every kind that JSON or JavaScript can hand over, including those that JSON cannot write. */
const anything = fc.oneof(
  fc.jsonValue(),
  fc.anything({ withNullPrototype: true, withBigInt: true, withDate: true, withMap: true, withTypedArray: true }),
);

/** The strings that a member may be replaced by: the bad forms of the formats, and the terms that the reader tells apart. */
const STRINGS = [
  ...BAD_STRINGS,
  "hosted",
  "signed",
  "verify",
  "Issuer",
  "urn:uuid:2f9d1c9e-0d36-4c4f-9a43-7f1e6e1c0a01",
  "sha256$abc",
  "md5$0123456789abcdef0123456789abcdef",
  "data:image/png;base64,iVBORw0KGgo=",
  "_:b0",
  CONTEXTS.openBadgesV2,
];

/** Tells whether a function returns, or throws the error of the family, and nothing else. */
function returnsOrRefuses(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DataError);
  }
}

describe("the reader of Open Badges 2.0 on any value", () => {
  it("answers a document of any members, or a BadgeAssertionV2 of any parts, with findings or a refusal", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), anything), anything, anything, (members, badge, issuer) => {
        const document = { ...members, "@context": CONTEXTS.openBadgesV2 };
        const parts = { version: "2.0", assertion: members, badge, issuer };
        for (const value of [document, parts]) {
          expect(Array.isArray(validateCredential(value))).toBe(true);
          returnsOrRefuses(() => readCredential(value));
          returnsOrRefuses(() => summarizeCredential(value as never));
        }
        const sink = createIssueSink(1000, false);
        expect(() => inspectDocumentV2("revocation-list", members, sink)).not.toThrow();
      }),
      RUNS,
    );
  });

  it("refuses an assertion with a change exactly when it has an error, and reads what it returned as itself", () => {
    fc.assert(
      fc.property(mutations, mutations, (first, second) => {
        const changed = mutate(Object(mutate(soundAssertion(), first, STRINGS)), second, STRINGS);
        const findings = validateCredential(changed);
        for (const finding of findings) {
          expect(finding.rule).toMatch(/^[a-z0-9-]+$/u);
          expect(finding.path === "" || finding.message.startsWith(finding.path)).toBe(false);
        }
        if (findings.some(({ severity }) => severity === "error")) {
          expect(() => readCredential(changed)).toThrow(DataError);
          return;
        }
        const read = readCredential(changed);
        expect(readCredential(read)).toStrictEqual(read);
        expect(readCredential(JSON.parse(JSON.stringify(read)))).toStrictEqual(read);
      }),
      RUNS,
    );
  });

  it("gives a revocation list with a change findings that name a path and a kebab-case rule", () => {
    fc.assert(
      fc.property(mutations, (change) => {
        const sink = createIssueSink(1000, false);
        inspectDocumentV2("revocation-list", mutate(soundRevocationList(), change, STRINGS), sink);
        for (const finding of sink.list()) expect(finding.rule).toMatch(/^[a-z0-9-]+$/u);
      }),
      RUNS,
    );
  });
});

describe("readJwsPayload on any text", () => {
  /** A compact JWS with a payload of the given text and a header and a signature that are not checked. */
  const jws = (payload: string) => `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(payload, "utf8").toString("base64url")}.c2ln`;

  it("returns a payload or a reason, and throws nothing", () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ unit: "binary" }), (text, payload) => {
        expect(readJwsPayload(text, 1000)).toBeTypeOf("object");
        expect(readJwsPayload(jws(payload), 1000)).toBeTypeOf("object");
      }),
      RUNS,
    );
  });

  it("reads back every JSON object that a JWS carries", () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue({ maxDepth: 5 })), (object) => {
        const text = JSON.stringify(object);
        expect(readJwsPayload(jws(text), 1_000_000)).toStrictEqual({ value: JSON.parse(text) });
      }),
      RUNS,
    );
  });
});
