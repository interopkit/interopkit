import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mutate, mutations } from "../../../scripts/json-mutation.js";
import { readStatement } from "../src/index.js";
import { handleLrsRequest } from "../src/store/index.js";
import { fullStatement, providerStatement, subStatementStatement } from "./full-statement.js";
import { RUNS, STRINGS } from "./fuzz.js";
import { memory, optionsOf, requestOf } from "./memory-lrs.js";

const PRINTABLE = fc.stringMatching(/^[ -~]{0,60}$/u);

/** Text and bytes that a client might send as a body: JSON of any shape, text, bytes. */
const bodies = fc.oneof(
  fc.jsonValue().map((value) => JSON.stringify(value)),
  PRINTABLE,
  fc.uint8Array({ maxLength: 80 }),
);

describe("the handler on any request", () => {
  it("answers every request with a status and the version header, and throws nothing, whatever the method, path, query, headers and body", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"),
        fc.constantFrom("/statements", "/statements/", "/nothing", "/agents", "/statements/x"),
        PRINTABLE,
        fc.record(
          {
            "content-type": fc.constantFrom(
              "application/json",
              "multipart/mixed; boundary=x",
              "text/plain",
              "multipart/mixed",
            ),
            accept: fc.constantFrom("application/json", "text/html", "*/*", "x/y;q=2", "garbage"),
            "accept-language": PRINTABLE,
            "x-experience-api-version": fc.constantFrom("2.0.0", "2.0", "1.0.3", "x"),
          },
          { requiredKeys: [] },
        ),
        bodies,
        async (method, path, query, headers, body) => {
          const response = await handleLrsRequest(
            requestOf(method, path, { query: query.replaceAll("#", "%23"), headers, body }),
            optionsOf(memory()),
          );
          expect(response.status).toBeGreaterThanOrEqual(200);
          expect(response.status).toBeLessThan(600);
          expect(response.status).not.toBe(500);
          expect(["2.0.0", "1.0.3"]).toContain(response.headers["x-experience-api-version"]);
        },
      ),
      RUNS,
    );
  });

  it("stores a Statement with a change only when it is one that the readers accept, and then stores what they read", async () => {
    const statements = fc
      .constantFrom(fullStatement(), providerStatement(), subStatementStatement())
      .map((statement) => JSON.parse(JSON.stringify(statement)));
    await fc.assert(
      fc.asyncProperty(statements, mutations, async (statement, mutation) => {
        const changed = mutate(statement, mutation, STRINGS);
        const store = memory();
        const response = await handleLrsRequest(
          requestOf("POST", "/statements", {
            headers: { "content-type": "application/json" },
            body: JSON.stringify([changed]),
          }),
          optionsOf(store),
        );
        expect([200, 204, 400, 413]).toContain(response.status);
        if (response.status === 400) {
          expect(store.held.size).toBe(0);
          return;
        }
        for (const { statement: held } of store.held.values()) {
          expect(readStatement(held)).toStrictEqual(held);
        }
      }),
      RUNS,
    );
  });
});
