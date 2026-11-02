import type { HttpResponse } from "@interopkit/core/http";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { readEntity } from "../src/index.js";
import { handleCredentialsRequest } from "../src/provider/index.js";
import { achievementCredential } from "./fixtures.js";
import { ORIGIN, ROOTS, serving } from "./provider-fixture.js";

/** The seed and the number of runs of every property, fixed so that a failure repeats. */
const RUNS = { seed: 20_261_103, numRuns: 300 };

/** The statuses that the provider answers with. */
const STATUSES = [200, 201, 304, 400, 401, 403, 404, 405, 413, 415, 422, 429, 500];

const encoder = new TextEncoder();

/** Checks that an answer has a status of the provider, and that a failure carries an `imsx_StatusInfo`. */
function expectAnswer(response: HttpResponse): void {
  expect(STATUSES).toContain(response.status);
  if (response.status >= 400)
    expect(() => readEntity("imsx_StatusInfo", JSON.parse(String(response.body)))).not.toThrow();
}

/** A body: text, JSON, a credential with one value changed, or bytes. */
const body = fc.oneof(
  fc.string({ maxLength: 80 }),
  fc.jsonValue({ maxDepth: 4 }).map((value) => JSON.stringify(value)),
  fc
    .tuple(fc.constantFrom(...Object.keys(achievementCredential())), fc.jsonValue({ maxDepth: 2 }))
    .map(([name, value]) => JSON.stringify({ ...achievementCredential(), [name]: value })),
  fc.uint8Array({ maxLength: 80 }),
);

/** A request below the root of the API, or near it: any method, path, query, media type, token and body. */
const requests = fc.record({
  method: fc.constantFrom("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "get"),
  path: fc.oneof(fc.constantFrom("/credentials", "/profile", "/discovery", "", "/"), fc.webPath({ size: "small" })),
  query: fc.oneof(
    fc.constant(""),
    fc.constantFrom("?limit=0", "?limit=2&offset=1", "?since=2024-06-13T10:00:00Z", "?limit=1&limit=2"),
    fc.webQueryParameters({ size: "small" }).map((query) => `?${query}`),
  ),
  type: fc.option(fc.constantFrom("application/json", "application/vc+ld+json", "text/plain", "text/html", "")),
  token: fc.option(fc.constantFrom("token-all", "token-read", "token-unknown")),
  body,
});

describe("the provider, for any request", () => {
  it("answers with a status of the API and an imsx_StatusInfo for a failure, and never throws", async () => {
    await fc.assert(
      fc.asyncProperty(requests, async ({ method, path, query, type, token, body: content }) => {
        const { options } = serving("badges", { maxBodyBytes: 200 });
        const response = await handleCredentialsRequest(
          {
            method,
            url: `${ORIGIN}${ROOTS.badges}${path}${query}`,
            headers: {
              ...(type === null ? {} : { "content-type": type }),
              ...(token === null ? {} : { authorization: `Bearer ${token}` }),
            },
            body: typeof content === "string" ? encoder.encode(content) : content,
          },
          options,
        );
        expectAnswer(response);
      }),
      RUNS,
    );
  });

  it("stores a body only when it is a credential of the API, for any body of an upsert", async () => {
    await fc.assert(
      fc.asyncProperty(body, fc.constantFrom("application/json", "text/plain"), async (content, type) => {
        const { options, held } = serving();
        const response = await handleCredentialsRequest(
          {
            method: "POST",
            url: `${ORIGIN}${ROOTS.badges}/credentials`,
            headers: { "content-type": type, authorization: "Bearer token-all" },
            body: typeof content === "string" ? encoder.encode(content) : content,
          },
          options,
        );
        expectAnswer(response);
        expect([201, 400, 422]).toContain(response.status);
        expect(held.credentials.size).toBe(response.status === 201 ? 1 : 0);
      }),
      RUNS,
    );
  });
});
