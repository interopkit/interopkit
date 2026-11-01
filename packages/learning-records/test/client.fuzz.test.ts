import { DataError, ServiceError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fakeLrs, type Reply } from "./fake-lrs.js";
import { uuid } from "./full-statement.js";
import { RUNS } from "./fuzz.js";
import { clientOf, collect, statementOf } from "./lrs-client.js";

const AGENT = { mbox: "mailto:learner@example.org" } as const;
const ACTIVITY = "https://example.org/activities/course-1";
const PRINTABLE = fc.stringMatching(/^[ -~]{0,40}$/u);

/** Replies of any status with any body and the headers that the client reads, written as a server might write them. */
const replies: fc.Arbitrary<Reply> = fc.record({
  status: fc.constantFrom(200, 200, 200, 204, 404, 409, 412, 400, 500),
  body: fc.oneof(
    fc.jsonValue().map((value) => JSON.stringify(value)),
    fc.uint8Array({ maxLength: 120 }),
    PRINTABLE,
    fc.record({ statements: fc.array(fc.jsonValue(), { maxLength: 3 }), more: PRINTABLE }),
    fc.array(PRINTABLE, { maxLength: 3 }),
  ),
  headers: fc.record(
    {
      "content-type": fc.constantFrom("application/json", "multipart/mixed; boundary=x", "text/plain", "image/png"),
      etag: PRINTABLE,
      "last-modified": PRINTABLE,
      "x-experience-api-consistent-through": PRINTABLE,
    },
    { requiredKeys: [] },
  ),
});

/** Runs a call and checks that it resolves, or rejects with the errors of the family and no other. */
async function settles(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    expect(error instanceof DataError || error instanceof ServiceError).toBe(true);
  }
}

describe("the client on any answer", () => {
  it("resolves or rejects with a DataError or a ServiceError, whatever the LRS answers to any call", async () => {
    await fc.assert(
      fc.asyncProperty(replies, async (reply) => {
        const client = clientOf(fakeLrs(() => reply));
        const state = { resource: "state", activityId: ACTIVITY, agent: AGENT, stateId: "s" } as const;
        const precondition = { precondition: { ifNoneMatch: "*" } } as const;
        await settles(() => client.sendStatement(statementOf(1)));
        await settles(() => client.sendStatements([statementOf(1), statementOf(2)]));
        await settles(() => client.getStatement(uuid(1)));
        await settles(() => collect(client.queryStatements({})));
        await settles(() => collect(client.queryStatements({ attachments: true })));
        await settles(() => client.getDocument(state));
        await settles(() =>
          client.putDocument(state, { contentType: "text/plain", body: new Uint8Array(3) }, precondition),
        );
        await settles(() => client.postDocument(state, { a: 1 }, precondition));
        await settles(() => client.deleteDocument(state, { precondition: { ifMatch: '"a"' } }));
        await settles(() => client.listDocumentIds({ resource: "agent-profile", agent: AGENT }));
        await settles(() => client.deleteStates({ resource: "state", activityId: ACTIVITY, agent: AGENT }));
        await settles(() => client.getActivity(ACTIVITY));
        await settles(() => client.getPerson(AGENT));
        await settles(() => client.about());
      }),
      RUNS,
    );
  });
});
