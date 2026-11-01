import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { refreshCredential } from "../src/refresh/index.js";
import { createStatusList, setCredentialStatus, verifyCredentialStatus } from "../src/status/index.js";
import { decodeList, isSet } from "../src/status/internal.js";
import { serve } from "./key-fixtures.js";
import { credentialWithStatus, LIST_URL, world } from "./status-fixtures.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_108, numRuns: 100 };

describe("the encoded list", () => {
  it("is refused as a value for any text, and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (text) => {
        const decoded = await decodeList(`u${text}`);
        expect("bits" in decoded || "reason" in decoded).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("a status list", () => {
  it("has exactly the entries that were set", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.nat(131_071), { maxLength: 40 }), (indexes) => {
        const list = indexes.reduce((current, index) => setCredentialStatus(current, index, true), createStatusList());
        const set = Array.from({ length: list.length }, (_, index) => index).filter((index) => isSet(list.bits, index));
        expect(set).toStrictEqual([...indexes].sort((first, second) => first - second));
      }),
      RUNS,
    );
  });
});

describe("the status check", () => {
  it("returns a check for whatever the list address answers, and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.string({ maxLength: 300 }),
          fc.jsonValue({ maxDepth: 3 }).map((value) => JSON.stringify(value)),
        ),
        async (body) => {
          const w = world({ [LIST_URL]: body });
          const result = await verifyCredentialStatus(credentialWithStatus(), w.options);
          expect(["failed", "unavailable"]).toContain(result.outcome);
        },
      ),
      RUNS,
    );
  });

  it("returns a check for any credential status, and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue({ maxDepth: 3 }), async (entry) => {
        const w = world();
        const credential = { ...credentialWithStatus(), credentialStatus: entry } as never;
        const result = await verifyCredentialStatus(credential, w.options);
        expect(["failed", "skipped", "unavailable", "passed"]).toContain(result.outcome);
      }),
      RUNS,
    );
  });
});

describe("the refresh", () => {
  it("answers a credential, a compact JWS or a refusal for whatever the service answers", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 300 }), async (body) => {
        const credential = {
          ...credentialWithStatus(),
          refreshService: { id: "https://example.edu/refresh/1", type: "1EdTechCredentialRefresh" },
        } as never;
        const { fetch } = serve({ "https://example.edu/refresh/1": body });
        try {
          const refreshed = await refreshCredential(credential, { fetch });
          expect(typeof refreshed === "string" || typeof refreshed === "object").toBe(true);
        } catch (error) {
          expect((error as Error).name).toMatch(/DataError|ServiceError/u);
        }
      }),
      RUNS,
    );
  });
});
