import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it, vi } from "vitest";
import { readMultipart, writeMultipart } from "../src/attachments/index.js";
import type { Statement, StatementQuery } from "../src/index.js";
import { fakeLrs, type Reply } from "./fake-lrs.js";
import { uuid } from "./full-statement.js";
import { CONSISTENT_THROUGH, clientOf, collect, ENDPOINT, failureOf, fromJson, statementOf } from "./lrs-client.js";
import { dataOf, statementWithAttachments } from "./multipart.js";

const decoder = new TextDecoder();

/** The body of a request as text. */
function textOf(body: unknown): string {
  return body instanceof Uint8Array ? decoder.decode(body) : String(body);
}

describe("sendStatement", () => {
  it("stores a Statement with PUT under its id, as JSON, and resolves stored for 204", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    expect(await clientOf(lrs).sendStatement(statementOf(1))).toBe("stored");
    const [request] = lrs.requests;
    expect(lrs.paths()).toStrictEqual([`/xapi/statements?statementId=${uuid(1)}`]);
    expect(request?.init.method).toBe("PUT");
    expect(request?.init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(textOf(request?.init.body))).toStrictEqual(statementOf(1));
  });

  it("resolves conflict for 409, which is another Statement with the id", async () => {
    const lrs = fakeLrs(() => ({ status: 409, body: "the Statement differs" }));
    expect(await clientOf(lrs).sendStatement(statementOf(1))).toBe("conflict");
  });

  it.each([400, 401, 403, 413, 429, 500])("rejects with a ServiceError for %i", async (status) => {
    const lrs = fakeLrs(() => ({ status, body: "no" }));
    const failure = (await failureOf(clientOf(lrs).sendStatement(statementOf(1)))) as ServiceError;
    expect(failure).toBeInstanceOf(ServiceError);
    expect([failure.status, failure.body]).toStrictEqual([status, "no"]);
  });

  it("sends the data of the Attachments as a multipart message when the caller passes them", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const data = dataOf("a certificate");
    const statement = { ...statementOf(2), attachments: statementWithAttachments([data]).attachments };
    await clientOf(lrs).sendStatement(statement, { attachments: [data] });
    const [request] = lrs.requests;
    const contentType = request?.init.headers["content-type"] ?? "";
    expect(contentType).toMatch(/^multipart\/mixed; boundary=interopkit-/u);
    const message = readMultipart(contentType, request?.init.body as Uint8Array);
    expect(message.statements).toStrictEqual(statement);
    expect(message.parts.get(data.sha2)).toStrictEqual(data);
  });

  it("sends a multipart message with only the Statement when the caller passes an empty list", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    await clientOf(lrs).sendStatement(statementOf(3), { attachments: [] });
    expect(lrs.requests[0]?.init.headers["content-type"]).toMatch(/^multipart\/mixed/u);
  });

  it("refuses before any request a Statement with no id, one that breaks a rule of a provider, and data that no header names", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const client = clientOf(lrs);
    const { id: _id, ...withoutId } = statementOf(1);
    await expect(client.sendStatement(withoutId)).rejects.toThrow(
      "The Statement needs an id to be stored with PUT: deriveStatementId makes one that a resend repeats.",
    );
    await expect(client.sendStatement({ ...statementOf(1), timestamp: "2026-01-15T10:30:00+02:00" })).rejects.toThrow(
      /^The statement is invalid at timestamp/u,
    );
    await expect(client.sendStatement(statementOf(1), { attachments: [dataOf("unclaimed")] })).rejects.toThrow(
      "belongs to no Attachment of the Statements.",
    );
    expect(lrs.requests).toHaveLength(0);
  });

  it.each([
    [null, "The options object is invalid: expected an object, found null."],
    [{ attachments: "x" }, 'The options object is invalid at attachments: expected an array, found "x".'],
    [{ attachments: [{ sha2: "x" }] }, "The options object is invalid at attachments[0].sha2: expected a SHA-2 hash"],
    [{ signal: 5 }, "The options object is invalid at signal: expected an AbortSignal, found 5."],
    [{ format: "ids" }, 'The options object is invalid: unexpected property "format".'],
  ])("refuses the options %j", async (options, sentence) => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const client = clientOf(lrs);
    const failure = await failureOf(client.sendStatement(statementOf(1), fromJson(JSON.stringify(options))));
    expect(failure).toBeInstanceOf(DataError);
    expect((failure as Error).message).toContain(sentence);
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("sendStatements", () => {
  it("stores a batch with POST as a JSON array and resolves with the ids that the LRS answers, in order", async () => {
    const lrs = fakeLrs(() => ({ body: [uuid(1), uuid(2)] }));
    expect(await clientOf(lrs).sendStatements([statementOf(1), statementOf(2)])).toStrictEqual([uuid(1), uuid(2)]);
    const [request] = lrs.requests;
    expect(lrs.paths()).toStrictEqual(["/xapi/statements"]);
    expect(request?.init.method).toBe("POST");
    expect(JSON.parse(textOf(request?.init.body))).toStrictEqual([statementOf(1), statementOf(2)]);
  });

  it("sends Statements that have no id, and takes the ids from the answer", async () => {
    const lrs = fakeLrs(() => ({ body: [uuid(7)] }));
    const { id: _id, ...withoutId } = statementOf(1);
    expect(await clientOf(lrs).sendStatements([withoutId])).toStrictEqual([uuid(7)]);
  });

  it("resolves with the ids of the batch for 204, which a resend may be answered with", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    expect(await clientOf(lrs).sendStatements([statementOf(1), statementOf(2)])).toStrictEqual([uuid(1), uuid(2)]);
  });

  it("refuses a 204 for a batch that has a Statement without an id", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const { id: _id, ...withoutId } = statementOf(1);
    await expect(clientOf(lrs).sendStatements([withoutId])).rejects.toThrow(
      "answered with data that is not valid xAPI: The LRS answered 204 with no ids, and a Statement of the batch has none.",
    );
  });

  it("resolves with the ids of the batch for an answer that lists the new Statements only, or none, as a resend gets from real LRSs", async () => {
    const batch = [statementOf(1), statementOf(2)];
    expect(await clientOf(fakeLrs(() => ({ body: [uuid(2)] }))).sendStatements(batch)).toStrictEqual([
      uuid(1),
      uuid(2),
    ]);
    expect(await clientOf(fakeLrs(() => ({ body: [] }))).sendStatements(batch)).toStrictEqual([uuid(1), uuid(2)]);
    expect(await clientOf(fakeLrs(() => ({ body: [uuid(1).toUpperCase()] }))).sendStatements(batch)).toStrictEqual([
      uuid(1),
      uuid(2),
    ]);
  });

  it("refuses an answer with an id that no Statement of the batch has, and another number of ids for Statements with none", async () => {
    await expect(
      clientOf(fakeLrs(() => ({ body: [uuid(1), uuid(9)] }))).sendStatements([statementOf(1), statementOf(2)]),
    ).rejects.toThrow(`The answer lists the id ${uuid(9)}, which no Statement of the batch has.`);
    const { id: _id, ...withoutId } = statementOf(1);
    await expect(clientOf(fakeLrs(() => ({ body: [uuid(1)] }))).sendStatements([withoutId, withoutId])).rejects.toThrow(
      "The answer lists 1 ids for 2 Statements.",
    );
  });

  it("refuses an answer with ids that are no UUIDs", async () => {
    await expect(clientOf(fakeLrs(() => ({ body: ["x"] }))).sendStatements([statementOf(1)])).rejects.toThrow(
      "The answer is invalid at [0]",
    );
    await expect(clientOf(fakeLrs(() => ({ body: { ids: [] } }))).sendStatements([statementOf(1)])).rejects.toThrow(
      "The answer is invalid",
    );
  });

  it("rejects with a ServiceError for 409, which POST does not expect", async () => {
    const lrs = fakeLrs(() => ({ status: 409 }));
    expect(await failureOf(clientOf(lrs).sendStatements([statementOf(1)]))).toBeInstanceOf(ServiceError);
  });

  it("refuses before any request a batch with two Statements of one id, a Statement that breaks a rule, and what is no list", async () => {
    const lrs = fakeLrs(() => ({ body: [] }));
    const client = clientOf(lrs);
    await expect(client.sendStatements([statementOf(1), statementOf(1)])).rejects.toThrow(
      /^The batch of Statements is invalid at \[1\]\.id/u,
    );
    await expect(client.sendStatements([{ ...statementOf(1), timestamp: "x" }])).rejects.toThrow(
      /^The batch of Statements is invalid at \[0\]\.timestamp/u,
    );
    await expect(client.sendStatements(fromJson("{}"))).rejects.toThrow(/^The batch of Statements is invalid/u);
    expect(lrs.requests).toHaveLength(0);
  });

  it("sends the Attachments as a multipart message", async () => {
    const lrs = fakeLrs(() => ({ body: [uuid(1)] }));
    const data = dataOf("data");
    const statement = { ...statementOf(1), attachments: statementWithAttachments([data]).attachments };
    await clientOf(lrs).sendStatements([statement], { attachments: [data] });
    const [request] = lrs.requests;
    const message = readMultipart(request?.init.headers["content-type"] ?? "", request?.init.body as Uint8Array);
    expect(message.statements).toStrictEqual([statement]);
    expect(message.parts.size).toBe(1);
  });
});

describe("getStatement", () => {
  it("fetches a Statement by its id and reads it as an LRS reads it", async () => {
    const stored: Statement = {
      ...statementOf(1),
      stored: "2026-01-15T10:30:01.000Z",
      authority: { account: { homePage: "https://lrs.example.org", name: "client" } },
      version: "2.0.0",
    };
    const lrs = fakeLrs(() => ({ body: stored }));
    expect(await clientOf(lrs).getStatement(uuid(1))).toStrictEqual(stored);
    expect(lrs.paths()).toStrictEqual([`/xapi/statements?statementId=${uuid(1)}`]);
    expect(lrs.requests[0]?.init.method).toBe("GET");
    expect(lrs.requests[0]?.init.headers.accept).toBe("application/json");
  });

  it("resolves undefined for 404", async () => {
    const lrs = fakeLrs(() => ({ status: 404 }));
    expect(await clientOf(lrs).getStatement(uuid(1))).toBeUndefined();
  });

  it("asks for a voided Statement by voidedStatementId, and for a format", async () => {
    const lrs = fakeLrs(() => ({ body: statementOf(1) }));
    const client = clientOf(lrs);
    await client.getStatement(uuid(1), { voided: true });
    await client.getStatement(uuid(1), { format: "ids" });
    await client.getStatement(uuid(1), { voided: false, format: "canonical" });
    expect(lrs.paths()).toStrictEqual([
      `/xapi/statements?voidedStatementId=${uuid(1)}`,
      `/xapi/statements?statementId=${uuid(1)}&format=ids`,
      `/xapi/statements?statementId=${uuid(1)}&format=canonical`,
    ]);
  });

  it("rejects with a ServiceError for another status", async () => {
    const lrs = fakeLrs(() => ({ status: 500 }));
    expect((await failureOf(clientOf(lrs).getStatement(uuid(1)))) as ServiceError).toBeInstanceOf(ServiceError);
  });

  describe("with attachments", () => {
    const data = dataOf("certificate");
    const statement = { ...statementOf(1), attachments: statementWithAttachments([data]).attachments };

    it("asks for a multipart answer, and resolves with the Statement and the data of its Attachments by their hash", async () => {
      const message = writeMultipart(statement, [data]);
      const lrs = fakeLrs(() => ({ headers: { "content-type": message.contentType }, body: message.body }));
      const found = await clientOf(lrs).getStatement(uuid(1), { attachments: true, format: "exact" });
      expect(found?.statement).toStrictEqual(statement);
      expect(found?.attachments.get(data.sha2)).toStrictEqual(data);
      expect(lrs.paths()).toStrictEqual([`/xapi/statements?statementId=${uuid(1)}&format=exact&attachments=true`]);
      expect(lrs.requests[0]?.init.headers.accept).toBe("multipart/mixed, application/json");
    });

    it("refuses a first part of more tokens than maxTokens of the client, before it parses it", async () => {
      const message = writeMultipart(statement, [data]);
      const lrs = fakeLrs(() => ({ headers: { "content-type": message.contentType }, body: message.body }));
      const failure = (await failureOf(
        clientOf(lrs, { maxTokens: 20 }).getStatement(uuid(1), { attachments: true }),
      )) as DataError;
      expect(failure).toBeInstanceOf(DataError);
      expect(failure.message).toContain("The text has more than 20 tokens");
      expect((await clientOf(lrs).getStatement(uuid(1), { attachments: true }))?.statement).toStrictEqual(statement);
    });

    it("asks for a voided Statement with its data", async () => {
      const message = writeMultipart(statement, [data]);
      const lrs = fakeLrs(() => ({ headers: { "content-type": message.contentType }, body: message.body }));
      await clientOf(lrs).getStatement(uuid(1), { attachments: true, voided: true });
      expect(lrs.paths()).toStrictEqual([`/xapi/statements?voidedStatementId=${uuid(1)}&attachments=true`]);
    });

    it("resolves with no data when the LRS answers with JSON, which it may when no Attachment has data", async () => {
      const lrs = fakeLrs(() => ({ body: statementOf(1) }));
      expect(await clientOf(lrs).getStatement(uuid(1), { attachments: true })).toStrictEqual({
        statement: statementOf(1),
        attachments: new Map(),
      });
    });

    it("resolves with the Statement alone when attachments is false, and says so to the LRS", async () => {
      const lrs = fakeLrs(() => ({ body: statementOf(1) }));
      expect(await clientOf(lrs).getStatement(uuid(1), { attachments: false })).toStrictEqual(statementOf(1));
      expect(lrs.paths()).toStrictEqual([`/xapi/statements?statementId=${uuid(1)}&attachments=false`]);
      expect(lrs.requests[0]?.init.headers.accept).toBe("application/json");
    });

    it("resolves undefined for 404, and refuses a multipart answer that is malformed", async () => {
      expect(
        await clientOf(fakeLrs(() => ({ status: 404 }))).getStatement(uuid(1), { attachments: true }),
      ).toBeUndefined();
      const broken = fakeLrs(() => ({
        headers: { "content-type": "multipart/mixed; boundary=b" },
        body: "not a message",
      }));
      await expect(clientOf(broken).getStatement(uuid(1), { attachments: true })).rejects.toThrow(
        "answered with data that is not valid xAPI: The multipart message is not valid",
      );
    });
  });

  it.each([
    ["not json", "The text is not valid JSON"],
    ['{"actor":{"mbox":"mailto:a@example.org"},"actor":{}}', 'The text has the property "actor" twice'],
    ['{"id":"x"}', "The statement is invalid"],
  ])("refuses an answer that is %j, and says whose answer it was", async (body, sentence) => {
    const lrs = fakeLrs(() => ({ body }));
    const failure = (await failureOf(clientOf(lrs).getStatement(uuid(1)))) as DataError;
    expect(failure).toBeInstanceOf(DataError);
    expect(failure.message).toContain(
      `The LRS at https://lrs.example.org/xapi/statements?statementId=${uuid(1)} answered with data that is not valid xAPI: `,
    );
    expect(failure.message).toContain(sentence);
  });

  it("refuses an answer that is not UTF-8", async () => {
    const lrs = fakeLrs(() => ({ body: Uint8Array.from([0xff, 0xfe]) }));
    await expect(clientOf(lrs).getStatement(uuid(1))).rejects.toThrow(
      "The body is not valid UTF-8 text, which JSON must be.",
    );
  });

  it("refuses an id that is no UUID and options that are not valid, before any request", async () => {
    const lrs = fakeLrs(() => ({ body: statementOf(1) }));
    const client = clientOf(lrs);
    await expect(client.getStatement("x")).rejects.toThrow(/^The statement id is invalid/u);
    await expect(client.getStatement(fromJson("5"))).rejects.toThrow(DataError);
    await expect(client.getStatement(uuid(1), { format: "full" } as never)).rejects.toThrow(
      /^The options object is invalid at format/u,
    );
    await expect(client.getStatement(uuid(1), { attachments: "yes" } as never)).rejects.toThrow(
      /^The options object is invalid at attachments/u,
    );
    await expect(client.getStatement(uuid(1), { data: true } as never)).rejects.toThrow(
      'The options object is invalid: unexpected property "data".',
    );
    expect(lrs.requests).toHaveLength(0);
  });

  it("does not hide an error of the reader that is not about the answer", async () => {
    vi.resetModules();
    vi.doMock("../src/read/index.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/read/index.js")>()),
      readStatement: () => {
        throw new TypeError("a defect of the reader");
      },
    }));
    try {
      const { createLrsClient } = await import("../src/client/index.js");
      const client = createLrsClient({
        endpoint: "https://lrs.example.org/xapi/",
        fetch: fakeLrs(() => ({ body: statementOf(1) })).fetch,
      });
      await expect(client.getStatement(uuid(1))).rejects.toThrow(new TypeError("a defect of the reader"));
      const paged = createLrsClient({
        endpoint: "https://lrs.example.org/xapi/",
        fetch: fakeLrs(() => ({
          headers: { "x-experience-api-consistent-through": CONSISTENT_THROUGH },
          body: { statements: [statementOf(1)] },
        })).fetch,
      });
      await expect(collect(paged.queryStatements({}))).rejects.toThrow(new TypeError("a defect of the reader"));
    } finally {
      vi.doUnmock("../src/read/index.js");
      vi.resetModules();
    }
  });
});

describe("queryStatements", () => {
  /** A page of the LRS: the Statements of the numbers, and the address of the next page. */
  function page(numbers: readonly number[], more?: string, extra: Record<string, string> = {}): Reply {
    return {
      headers: { "x-experience-api-consistent-through": CONSISTENT_THROUGH, ...extra },
      body: { statements: numbers.map(statementOf), ...(more === undefined ? {} : { more }) },
    };
  }

  it("asks for no filter when the query has none, and returns the page with the time it is consistent through", async () => {
    const lrs = fakeLrs(() => page([1, 2]));
    const pages = await collect(clientOf(lrs).queryStatements({}));
    expect(lrs.paths()).toStrictEqual(["/xapi/statements"]);
    expect(pages).toStrictEqual([
      { statements: [statementOf(1), statementOf(2)], attachments: new Map(), consistentThrough: CONSISTENT_THROUGH },
    ]);
  });

  it("writes each filter under the name of the standard, in a fixed order", async () => {
    const lrs = fakeLrs(() => page([]));
    const query: StatementQuery = {
      ascending: true,
      attachments: false,
      format: "canonical",
      limit: 25,
      until: "2026-02-01T00:00:00.000Z",
      since: "2026-01-01T00:00:00.000Z",
      relatedAgents: true,
      relatedActivities: false,
      registration: uuid(9),
      activity: "https://example.org/activities/course-1",
      verb: "http://adlnet.gov/expapi/verbs/completed",
      agent: { mbox: "mailto:learner@example.org" },
    };
    await collect(clientOf(lrs).queryStatements(query));
    const url = new URL(lrs.requests[0]?.url ?? "");
    expect([...url.searchParams.entries()]).toStrictEqual([
      ["agent", '{"mbox":"mailto:learner@example.org"}'],
      ["verb", "http://adlnet.gov/expapi/verbs/completed"],
      ["activity", "https://example.org/activities/course-1"],
      ["registration", uuid(9)],
      ["related_activities", "false"],
      ["related_agents", "true"],
      ["since", "2026-01-01T00:00:00.000Z"],
      ["until", "2026-02-01T00:00:00.000Z"],
      ["limit", "25"],
      ["format", "canonical"],
      ["attachments", "false"],
      ["ascending", "true"],
    ]);
  });

  it("follows more, one request for each page, and stops at the first page without it", async () => {
    const lrs = fakeLrs((url) => {
      const cursor = url.searchParams.get("cursor");
      if (cursor === null) return page([1], "/xapi/statements?cursor=2");
      return cursor === "2" ? page([2], "/xapi/statements?cursor=3") : page([3], "");
    });
    const pages = await collect(clientOf(lrs).queryStatements({ limit: 1 }));
    expect(pages.map(({ statements }) => statements.map(({ id }) => id))).toStrictEqual([
      [uuid(1)],
      [uuid(2)],
      [uuid(3)],
    ]);
    expect(pages.map(({ more }) => more)).toStrictEqual([
      "/xapi/statements?cursor=2",
      "/xapi/statements?cursor=3",
      undefined,
    ]);
    expect(lrs.paths()).toStrictEqual([
      "/xapi/statements?limit=1",
      "/xapi/statements?cursor=2",
      "/xapi/statements?cursor=3",
    ]);
  });

  it("makes the request for a page only when the iteration asks for it", async () => {
    const lrs = fakeLrs(() => page([1], "/xapi/statements?cursor=2"));
    const iteration = clientOf(lrs).queryStatements({})[Symbol.asyncIterator]();
    expect(lrs.requests).toHaveLength(0);
    await iteration.next();
    expect(lrs.requests).toHaveLength(1);
    await iteration.return?.();
    expect(lrs.requests).toHaveLength(1);
  });

  it("follows an address that is relative to the page, and one that is absolute on the same origin", async () => {
    const lrs = fakeLrs((url) => {
      const step = url.searchParams.get("step");
      if (step === null) return page([1], "?step=2");
      return step === "2" ? page([2], "https://lrs.example.org/xapi/statements?step=3") : page([3]);
    });
    const pages = await collect(clientOf(lrs).queryStatements({}));
    expect(pages).toHaveLength(3);
    expect(lrs.paths()).toStrictEqual(["/xapi/statements", "/xapi/statements?step=2", "/xapi/statements?step=3"]);
  });

  it.each([
    ["https://other.example/xapi/statements?cursor=2", "is not on the origin of the LRS"],
    ["http://lrs.example.org/xapi/statements?cursor=2", "is not on the origin of the LRS"],
    ["//other.example/x", "is not on the origin of the LRS"],
    ["https://user:secret@lrs.example.org/xapi/statements", "is not on the origin of the LRS"],
    ["https://lrs.example.org:8443/xapi/statements", "is not on the origin of the LRS"],
    ["https://[", "is not an address"],
  ])("refuses the address of the next page %j, so that the credential stays with the LRS", async (more, sentence) => {
    const lrs = fakeLrs(() => page([1], more));
    const client = clientOf(lrs, { authorization: async () => "Bearer secret" });
    const iteration = client.queryStatements({})[Symbol.asyncIterator]();
    await iteration.next();
    await expect(iteration.next()).rejects.toThrow(sentence);
    expect(lrs.requests).toHaveLength(1);
  });

  it("refuses an address of a page that was fetched already, so that a loop ends", async () => {
    const lrs = fakeLrs(() => page([1], "/xapi/statements?cursor=1"));
    const failure = await failureOf(collect(clientOf(lrs).queryStatements({})));
    expect(failure).toBeInstanceOf(DataError);
    expect(lrs.requests.length).toBeLessThanOrEqual(2);
  });

  it("reads a multipart answer, and returns the data of the Attachments by their hash", async () => {
    const data = dataOf("certificate");
    const statement = { ...statementOf(1), attachments: statementWithAttachments([data]).attachments };
    const message = writeMultipart({ statements: [statement] }, [data]);
    const lrs = fakeLrs(() => ({
      headers: { "content-type": message.contentType, "x-experience-api-consistent-through": CONSISTENT_THROUGH },
      body: message.body,
    }));
    const pages = await collect(clientOf(lrs).queryStatements({ attachments: true }));
    expect(lrs.requests[0]?.init.headers.accept).toBe("multipart/mixed, application/json");
    expect(pages[0]?.statements).toStrictEqual([statement]);
    expect(pages[0]?.attachments.get(data.sha2)).toStrictEqual(data);
  });

  it("refuses a multipart answer that is malformed", async () => {
    const lrs = fakeLrs(() => ({
      headers: {
        "content-type": "multipart/mixed; boundary=b",
        "x-experience-api-consistent-through": CONSISTENT_THROUGH,
      },
      body: "not a message",
    }));
    await expect(collect(clientOf(lrs).queryStatements({ attachments: true }))).rejects.toThrow(
      "answered with data that is not valid xAPI: The multipart message is not valid",
    );
  });

  it("refuses a page with no X-Experience-API-Consistent-Through header", async () => {
    for (const headers of [{}, { "x-experience-api-consistent-through": "" }] as Record<string, string>[]) {
      const lrs = fakeLrs(() => ({ headers, body: { statements: [] } }));
      await expect(collect(clientOf(lrs).queryStatements({}))).rejects.toThrow(
        "The answer has no X-Experience-API-Consistent-Through header, which the standard requires.",
      );
    }
  });

  it.each([
    [{ statements: "x" }, "The page is invalid at statements: expected an array"],
    [{ statements: [], extra: 1 }, 'The page is invalid: unexpected property "extra"'],
    [{ statements: [], more: 5 }, "The page is invalid at more: expected a string"],
    [{ statements: [{ id: "x" }] }, "The page has an invalid Statement at statements[0]. The statement is invalid"],
    [[], "The page is invalid: expected an object, found an array."],
  ])("refuses the page %j", async (body, sentence) => {
    const lrs = fakeLrs(() => ({ headers: { "x-experience-api-consistent-through": CONSISTENT_THROUGH }, body }));
    await expect(collect(clientOf(lrs).queryStatements({}))).rejects.toThrow(sentence);
  });

  it("rejects with a ServiceError when a later page fails, after it gave the earlier ones", async () => {
    const lrs = fakeLrs((url) =>
      url.searchParams.has("cursor") ? { status: 500 } : page([1], "/xapi/statements?cursor=2"),
    );
    const iteration = clientOf(lrs).queryStatements({})[Symbol.asyncIterator]();
    expect((await iteration.next()).done).toBe(false);
    await expect(iteration.next()).rejects.toBeInstanceOf(ServiceError);
  });

  it("ends the wait for a page when the signal aborts", async () => {
    const lrs = fakeLrs(() => new Promise<never>(() => {}));
    const controller = new AbortController();
    const waiting = failureOf(collect(clientOf(lrs).queryStatements({}, { signal: controller.signal })));
    controller.abort(new Error("gave up"));
    expect(await waiting).toStrictEqual(new Error("gave up"));
  });

  describe("a query that is not valid", () => {
    const lrs = fakeLrs(() => page([]));

    it.each([
      [
        { agent: { name: "No identifier" } },
        "The query is invalid at agent: expected an Agent or identified Group with exactly one",
      ],
      [{ agent: { mbox: "mailto:a@example.org", openid: "https://example.org/a" } }, "The query is invalid at agent"],
      [{ agent: { objectType: "Group", member: [] } }, "The query is invalid at agent"],
      [{ verb: "completed" }, "The query is invalid at verb"],
      [{ activity: 5 }, "The query is invalid at activity: expected a string, found 5."],
      [{ registration: "x" }, "The query is invalid at registration"],
      [{ since: "yesterday" }, "The query is invalid at since"],
      [{ until: "2026-01-01" }, "The query is invalid at until"],
      [{ limit: -1 }, "The query is invalid at limit: expected a value of at least 0, found -1."],
      [{ limit: 1.5 }, "The query is invalid at limit"],
      [{ format: "full" }, 'The query is invalid at format: expected "ids", "exact" or "canonical", found "full".'],
      [{ ascending: "yes" }, 'The query is invalid at ascending: expected true or false, found "yes".'],
      [{ related_agents: true }, 'The query is invalid: unexpected property "related_agents".'],
      [null, "The query is invalid: expected an object, found null."],
    ])("refuses %j when the call is made, before any request", (query, sentence) => {
      expect(() => clientOf(lrs).queryStatements(fromJson(JSON.stringify(query)))).toThrow(DataError);
      expect(() => clientOf(lrs).queryStatements(fromJson(JSON.stringify(query)))).toThrow(sentence);
      expect(lrs.requests).toHaveLength(0);
    });

    it("refuses options that are not valid", () => {
      expect(() => clientOf(lrs).queryStatements({}, fromJson('{"signal":5}'))).toThrow(
        "The options object is invalid at signal: expected an AbortSignal, found 5.",
      );
      expect(() => clientOf(lrs).queryStatements({}, fromJson("null"))).toThrow(DataError);
    });
  });
});

describe("the languages of a reader", () => {
  const PAGE = { "x-experience-api-consistent-through": "2026-01-15T10:30:00.000Z" };

  it("sends them as Accept-Language with falling weights, on a query and on one Statement", async () => {
    const lrs = fakeLrs(() => ({ body: { statements: [] }, headers: PAGE }));
    const client = clientOf(lrs);
    for await (const _page of client.queryStatements({ format: "canonical" }, { languages: ["fr-CA", "fr", "*"] }))
      break;
    await client.getStatement(uuid(1), { format: "canonical", languages: ["id"] }).catch(() => undefined);
    const [query, single] = lrs.requests;
    expect(query?.init.headers).toMatchObject({ "accept-language": "fr-CA, fr;q=0.9, *;q=0.8" });
    expect(single?.init.headers).toMatchObject({ "accept-language": "id" });
  });

  it("sends no header for none, and keeps a weight above zero for a long list", async () => {
    const lrs = fakeLrs(() => ({ body: { statements: [] }, headers: PAGE }));
    const client = clientOf(lrs);
    for await (const _page of client.queryStatements({}, { languages: [] })) break;
    expect(lrs.requests[0]?.init.headers).not.toHaveProperty("accept-language");
    const long = Array.from({ length: 12 }, () => "en");
    for await (const _page of client.queryStatements({}, { languages: long })) break;
    expect(lrs.requests[1]?.init.headers?.["accept-language"]).toContain(", en;q=0.1, en;q=0.1");
  });

  it("refuses what is no language before any request", async () => {
    const lrs = fakeLrs(() => ({ status: 500 }));
    const client = clientOf(lrs);
    expect(() => client.queryStatements({}, { languages: ["not a tag"] })).toThrow("expected a language tag");
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("moreStatements", () => {
  const PAGE = { "x-experience-api-consistent-through": "2026-01-15T10:30:00.000Z" };

  it("goes on from a page that a host kept, and follows the pages after it", async () => {
    const lrs = fakeLrs((url) =>
      url.searchParams.get("cursor") === "1"
        ? { body: { statements: [], more: "/xapi/statements?cursor=2" }, headers: PAGE }
        : { body: { statements: [] }, headers: PAGE },
    );
    const pages = [];
    for await (const page of clientOf(lrs).moreStatements("/xapi/statements?cursor=1")) pages.push(page);
    expect(pages).toHaveLength(2);
    expect(lrs.paths()).toStrictEqual(["/xapi/statements?cursor=1", "/xapi/statements?cursor=2"]);
  });

  it("takes the absolute address of the same origin, and either form of an answer", async () => {
    const lrs = fakeLrs(() => ({ body: { statements: [] }, headers: PAGE }));
    for await (const _page of clientOf(lrs).moreStatements(`${ENDPOINT}statements?cursor=1`)) break;
    expect(lrs.requests[0]?.init.headers).toMatchObject({ accept: "multipart/mixed, application/json" });
  });

  it("refuses an address on another origin before any request, so that the credential stays", async () => {
    const lrs = fakeLrs(() => ({ status: 500 }));
    expect(() => clientOf(lrs).moreStatements("https://other.example.org/xapi/statements")).toThrow(DataError);
    expect(() => clientOf(lrs).moreStatements("//other.example.org/xapi/statements")).toThrow(DataError);
    expect(() => clientOf(lrs).moreStatements(5 as never)).toThrow(DataError);
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("the rules of what is forwarded", () => {
  const statement = statementOf(1);
  const held = {
    ...statement,
    stored: "2026-01-15T10:30:00.000Z",
    authority: { mbox: "mailto:lrs@example.org" },
    version: "1.0.0",
  };

  it("holds a Statement to the rules of a provider unless the host says otherwise", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    await expect(clientOf(lrs).sendStatement(held)).rejects.toThrow("invalid");
    await expect(clientOf(lrs).sendStatements([held])).rejects.toThrow("invalid");
    expect(lrs.requests).toHaveLength(0);
  });

  it("sends what another LRS holds with the role of an LRS, as it is", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    expect(await clientOf(lrs).sendStatement(held, { role: "lrs" })).toBe("stored");
    expect(await clientOf(lrs).sendStatements([held], { role: "lrs" })).toStrictEqual([held.id]);
    expect(JSON.parse(String(lrs.requests[0]?.init.body))).toStrictEqual(held);
  });

  it("refuses a role that does not exist", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    await expect(clientOf(lrs).sendStatement(statement, { role: "any" as never })).rejects.toThrow("role");
  });
});
