import { DataError, ServiceError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createCredentialsClient, discoverService } from "../src/client/index.js";
import { BASE, fakeServer, JWS, json } from "./fake-server.js";
import { achievementCredential, PROFILE } from "./fixtures.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_241_107, numRuns: 300 };

/** Runs a call and returns what it throws, or undefined when it returns. */
async function thrownBy(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  return undefined;
}

const refusal = (error: unknown) => error === undefined || error instanceof DataError || error instanceof ServiceError;

/** An answer of any status, with a body of any text or JSON and any of the headers that the client reads. */
const answer = fc
  .tuple(
    fc.constantFrom(200, 200, 200, 201, 202, 304, 400, 404, 429, 500),
    fc.oneof(
      fc.jsonValue().map((value) => JSON.stringify(value)),
      fc.string({ maxLength: 60 }),
    ),
    fc.record(
      {
        "x-total-count": fc.string({ maxLength: 6 }),
        link: fc.string({ maxLength: 40 }),
        "retry-after": fc.string({ maxLength: 8 }),
      },
      { requiredKeys: [] },
    ),
  )
  .map(
    ([status, body, headers]) =>
      () =>
        new Response(status === 304 ? null : body, { status, headers }),
  );

describe("the client on any answer", () => {
  it("lists, adds and reads the profile into values, a DataError or a ServiceError", async () => {
    await fc.assert(
      fc.asyncProperty(answer, fc.constantFrom("badges", "clr"), async (make, api) => {
        let calls = 0;
        const { fetch } = fakeServer(() => {
          calls += 1;
          return calls > 5 ? json({}, 500) : make();
        });
        const client = createCredentialsClient({ api, baseUrl: BASE, fetch, token: async () => "t" });
        const listing = await thrownBy(async () => {
          for await (const _each of client.listCredentials()) {
            // Reading is all that is asked for.
          }
        });
        expect(refusal(listing)).toBe(true);
        expect(refusal(await thrownBy(() => client.getProfile()))).toBe(true);
        expect(refusal(await thrownBy(() => client.putProfile(PROFILE)))).toBe(true);
        expect(
          refusal(await thrownBy(() => client.upsertCredential(api === "badges" ? JWS : achievementCredential()))),
        ).toBe(true);
      }),
      RUNS,
    );
  });

  it("discovers a service from any answer into a description, a DataError or a ServiceError", async () => {
    await fc.assert(
      fc.asyncProperty(answer, async (make) => {
        expect(refusal(await thrownBy(() => discoverService(BASE, "badges", { fetch: fakeServer(make).fetch })))).toBe(
          true,
        );
      }),
      RUNS,
    );
  });
});

describe("the iteration of the credentials", () => {
  it("ends, and gives each credential once, whatever the pages and the headers say", async () => {
    const page = fc.record({
      ids: fc.array(fc.integer({ min: 1, max: 6 }), { maxLength: 2 }),
      jws: fc.boolean(),
      total: fc.option(fc.integer({ min: 0, max: 30 }), { nil: undefined }),
      next: fc.option(fc.boolean(), { nil: undefined }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(page, { minLength: 1, maxLength: 8 }), async (pages) => {
        let calls = 0;
        const { fetch } = fakeServer(() => {
          const at = calls;
          calls += 1;
          // A server that never ends the iteration is stopped by the test and not by the client.
          if (calls > 60) return json({}, 500);
          const one = pages[Math.min(at, pages.length - 1)];
          if (one === undefined) return json({});
          const headers: Record<string, string> = {};
          if (one.total !== undefined) headers["x-total-count"] = String(one.total);
          if (one.next !== undefined) headers.link = one.next ? `<${BASE}/n>; rel="next"` : `<${BASE}/f>; rel="first"`;
          const credential = one.ids.map((id) => ({
            ...achievementCredential(),
            id: `https://example.edu/credentials/${id}`,
          }));
          return json(
            { credential, ...(one.jws && one.ids.length < 2 ? { compactJwsString: [JWS] } : {}) },
            200,
            headers,
          );
        });
        const client = createCredentialsClient({
          api: "badges",
          baseUrl: BASE,
          fetch,
          token: async () => "t",
          pageSize: 2,
        });
        const found: string[] = [];
        const error = await thrownBy(async () => {
          for await (const each of client.listCredentials())
            found.push(typeof each === "string" ? each : JSON.stringify(each));
        });
        expect(error === undefined || (error instanceof ServiceError && error.status === 500)).toBe(true);
        expect(new Set(found).size).toBe(found.length);
      }),
      RUNS,
    );
  });
});
