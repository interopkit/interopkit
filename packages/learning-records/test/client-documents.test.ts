import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import type { DocumentScope, DocumentTarget } from "../src/index.js";
import { fakeLrs, type Reply } from "./fake-lrs.js";
import { uuid } from "./full-statement.js";
import { clientOf, failureOf, fromJson } from "./lrs-client.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const AGENT = { mbox: "mailto:learner@example.org" } as const;
const ACTIVITY = "https://example.org/activities/course-1";

const STATE: DocumentTarget = { resource: "state", activityId: ACTIVITY, agent: AGENT, stateId: "bookmark" };
const AGENT_PROFILE: DocumentTarget = { resource: "agent-profile", agent: AGENT, profileId: "preferences" };
const ACTIVITY_PROFILE: DocumentTarget = { resource: "activity-profile", activityId: ACTIVITY, profileId: "syllabus" };
const AGENT_JSON = encodeURIComponent(JSON.stringify(AGENT)).replace(/%20/gu, "+");

/** The path and query that each target is sent to. */
const TARGETS = [
  {
    target: STATE,
    path: `/xapi/activities/state?activityId=${encodeURIComponent(ACTIVITY)}&agent=${AGENT_JSON}&stateId=bookmark`,
  },
  { target: AGENT_PROFILE, path: `/xapi/agents/profile?agent=${AGENT_JSON}&profileId=preferences` },
  {
    target: ACTIVITY_PROFILE,
    path: `/xapi/activities/profile?activityId=${encodeURIComponent(ACTIVITY)}&profileId=syllabus`,
  },
] as const;

const ETAG = '"7c97e5cd2b6b0b4c0f4c2f8d5a1c9e0f33a1b5d2"';
const document = (extra: Record<string, string> = {}): Reply => ({
  headers: {
    "content-type": "application/json",
    etag: ETAG,
    "last-modified": "Thu, 15 Jan 2026 10:30:00 GMT",
    ...extra,
  },
  body: '{"page":3}',
});

describe("getDocument", () => {
  it.each(TARGETS)("fetches the document of the $target.resource resource", async ({ target, path }) => {
    const lrs = fakeLrs(() => document());
    const found = await clientOf(lrs).getDocument(target);
    expect(lrs.paths()).toStrictEqual([path]);
    expect(lrs.requests[0]?.init.method).toBe("GET");
    expect(found?.contentType).toBe("application/json");
    expect(decoder.decode(found?.body)).toBe('{"page":3}');
    expect([found?.etag, found?.updated]).toStrictEqual([ETAG, "2026-01-15T10:30:00.000Z"]);
  });

  it("accepts the signal of the call", async () => {
    const lrs = fakeLrs(() => document());
    expect(await clientOf(lrs).getDocument(STATE, { signal: new AbortController().signal })).toBeDefined();
  });

  it("names the registration of a state when there is one", async () => {
    const lrs = fakeLrs(() => document());
    await clientOf(lrs).getDocument({ ...STATE, registration: uuid(5) });
    expect(new URL(lrs.requests[0]?.url ?? "").searchParams.get("registration")).toBe(uuid(5));
  });

  it("resolves undefined for 404, and rejects with a ServiceError for another status", async () => {
    expect(await clientOf(fakeLrs(() => ({ status: 404 }))).getDocument(STATE)).toBeUndefined();
    expect(await failureOf(clientOf(fakeLrs(() => ({ status: 403 }))).getDocument(STATE))).toBeInstanceOf(ServiceError);
  });

  it("reads a document of any type, and gives it application/octet-stream when the answer names none", async () => {
    const png = Uint8Array.from([137, 80, 78, 71, 0, 255]);
    const lrs = fakeLrs(() => ({
      headers: { etag: ETAG, "last-modified": "Thu, 15 Jan 2026 10:30:00 GMT" },
      body: png,
    }));
    const found = await clientOf(lrs).getDocument(STATE);
    expect(found?.contentType).toBe("application/octet-stream");
    expect(found?.body).toStrictEqual(png);
  });

  it("reads a time that is written as ISO 8601, which some LRSs send", async () => {
    const lrs = fakeLrs(() => document({ "last-modified": "2026-01-15T10:30:00.250Z" }));
    expect((await clientOf(lrs).getDocument(STATE))?.updated).toBe("2026-01-15T10:30:00.250Z");
  });

  it("refuses an answer with no ETag, or with no time that reads", async () => {
    const noTag = fakeLrs(() => ({ headers: { "last-modified": "Thu, 15 Jan 2026 10:30:00 GMT" }, body: "{}" }));
    await expect(clientOf(noTag).getDocument(STATE)).rejects.toThrow(
      "The answer has no ETag header, which the standard requires.",
    );
    for (const modified of [undefined, "", "yesterday"]) {
      const lrs = fakeLrs(() => ({
        headers: { etag: ETAG, ...(modified === undefined ? {} : { "last-modified": modified }) },
        body: "{}",
      }));
      await expect(clientOf(lrs).getDocument(STATE)).rejects.toThrow(
        /^The LRS at .* answered with data that is not valid xAPI: The answer needs a Last-Modified header with a time/u,
      );
    }
  });
});

describe("putDocument", () => {
  const json = { contentType: "application/json", body: encoder.encode('{"page":4}') };

  it.each(TARGETS)(
    "replaces the document of the $target.resource resource under a precondition",
    async ({ target, path }) => {
      const lrs = fakeLrs(() => ({ status: 204 }));
      expect(await clientOf(lrs).putDocument(target, json, { precondition: { ifMatch: ETAG } })).toBe("written");
      const [request] = lrs.requests;
      expect(lrs.paths()).toStrictEqual([path]);
      expect(request?.init.method).toBe("PUT");
      expect(request?.init.headers).toMatchObject({ "content-type": "application/json", "if-match": ETAG });
      expect(request?.init.headers).not.toHaveProperty("if-none-match");
      expect(decoder.decode(request?.init.body as Uint8Array)).toBe('{"page":4}');
    },
  );

  it("creates a document with ifNoneMatch, and sends a type that is not JSON as it is", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const png = { contentType: "image/png", body: Uint8Array.from([137, 80, 78, 71, 0, 255]) };
    await clientOf(lrs).putDocument(STATE, png, { precondition: { ifNoneMatch: "*" } });
    const [request] = lrs.requests;
    expect(request?.init.headers).toMatchObject({ "content-type": "image/png", "if-none-match": "*" });
    expect(request?.init.body).toStrictEqual(png.body);
  });

  it("resolves precondition-failed for 412 and conflict for 409, and rejects for another status", async () => {
    const put = (status: number) =>
      clientOf(fakeLrs(() => ({ status }))).putDocument(STATE, json, { precondition: { ifNoneMatch: "*" } });
    expect(await put(412)).toBe("precondition-failed");
    expect(await put(409)).toBe("conflict");
    expect(await failureOf(put(500))).toBeInstanceOf(ServiceError);
  });

  it("sends a copy of the bytes, so that a change after the call changes nothing", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const body = encoder.encode("abc");
    const pending = clientOf(lrs).putDocument(
      STATE,
      { contentType: "text/plain", body },
      { precondition: { ifNoneMatch: "*" } },
    );
    body[0] = 0;
    await pending;
    expect(decoder.decode(lrs.requests[0]?.init.body as Uint8Array)).toBe("abc");
  });

  it("refuses a document that is not valid", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const put = (document: unknown) =>
      clientOf(lrs).putDocument(STATE, document as never, { precondition: { ifNoneMatch: "*" } });
    await expect(put({ contentType: "json", body: new Uint8Array() })).rejects.toThrow(
      "The document is invalid at contentType: expected an Internet media type",
    );
    await expect(put({ contentType: "text/plain", body: "text" })).rejects.toThrow(
      "The document is invalid at body: expected a Uint8Array",
    );
    await expect(put(fromJson("null"))).rejects.toThrow("The document is invalid: expected an object, found null.");
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("postDocument", () => {
  it.each(TARGETS)("merges JSON into the document of the $target.resource resource", async ({ target, path }) => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    expect(
      await clientOf(lrs).postDocument(target, { page: 5, tags: ["a"] }, { precondition: { ifMatch: ETAG } }),
    ).toBe("written");
    const [request] = lrs.requests;
    expect(lrs.paths()).toStrictEqual([path]);
    expect(request?.init.method).toBe("POST");
    expect(request?.init.headers).toMatchObject({ "content-type": "application/json", "if-match": ETAG });
    expect(JSON.parse(decoder.decode(request?.init.body as Uint8Array))).toStrictEqual({ page: 5, tags: ["a"] });
  });

  it("resolves conflict for 409, which the LRS answers when the merge keeps losing a race", async () => {
    const lrs = fakeLrs(() => ({ status: 409 }));
    expect(await clientOf(lrs).postDocument(STATE, { a: 1 }, { precondition: { ifMatch: ETAG } })).toBe("conflict");
  });

  it("refuses what is not a JSON object", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const post = (json: unknown) =>
      clientOf(lrs).postDocument(STATE, json as never, { precondition: { ifMatch: ETAG } });
    await expect(post(fromJson("[1]"))).rejects.toThrow(/^The JSON is invalid/u);
    await expect(post({ when: new Date(0) })).rejects.toThrow(DataError);
    await expect(post(fromJson("5"))).rejects.toThrow(DataError);
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("deleteDocument", () => {
  it.each(TARGETS)(
    "removes the document of the $target.resource resource under a precondition",
    async ({ target, path }) => {
      const lrs = fakeLrs(() => ({ status: 204 }));
      expect(await clientOf(lrs).deleteDocument(target, { precondition: { ifMatch: ETAG } })).toBe("written");
      const [request] = lrs.requests;
      expect(lrs.paths()).toStrictEqual([path]);
      expect(request?.init.method).toBe("DELETE");
      expect(request?.init.headers).toMatchObject({ "if-match": ETAG });
      expect(request?.init.body).toBeUndefined();
    },
  );

  it("resolves precondition-failed for 412, and rejects for 404 and 409, which it does not expect", async () => {
    const remove = (status: number) =>
      clientOf(fakeLrs(() => ({ status }))).deleteDocument(STATE, { precondition: { ifMatch: ETAG } });
    expect(await remove(412)).toBe("precondition-failed");
    expect(await failureOf(remove(404))).toBeInstanceOf(ServiceError);
    expect(await failureOf(remove(409))).toBeInstanceOf(ServiceError);
  });
});

describe("the preconditions that a version requires", () => {
  /** Whether each write needs a precondition: on 2.0.0 all of them, on 1.0.3 only a PUT to a profile. */
  const WRITES = [
    { name: "putDocument", target: STATE, "2.0.0": true, "1.0.3": false },
    { name: "putDocument", target: AGENT_PROFILE, "2.0.0": true, "1.0.3": true },
    { name: "putDocument", target: ACTIVITY_PROFILE, "2.0.0": true, "1.0.3": true },
    { name: "postDocument", target: STATE, "2.0.0": true, "1.0.3": false },
    { name: "postDocument", target: AGENT_PROFILE, "2.0.0": true, "1.0.3": false },
    { name: "postDocument", target: ACTIVITY_PROFILE, "2.0.0": true, "1.0.3": false },
    { name: "deleteDocument", target: STATE, "2.0.0": true, "1.0.3": false },
    { name: "deleteDocument", target: AGENT_PROFILE, "2.0.0": true, "1.0.3": false },
    { name: "deleteDocument", target: ACTIVITY_PROFILE, "2.0.0": true, "1.0.3": false },
  ] as const;

  /** Makes the write of a row, with the options given. */
  function write(client: ReturnType<typeof clientOf>, row: (typeof WRITES)[number], options: object) {
    if (row.name === "putDocument") {
      return client.putDocument(row.target, { contentType: "text/plain", body: encoder.encode("x") }, options);
    }
    return row.name === "postDocument"
      ? client.postDocument(row.target, { a: 1 }, options)
      : client.deleteDocument(row.target, options);
  }

  describe.each(["2.0.0", "1.0.3"] as const)("on %s", (version) => {
    it.each(WRITES)("$name to $target.resource: refuses it with no precondition, or sends it", async (row) => {
      const lrs = fakeLrs(() => ({ status: 204 }));
      const client = clientOf(lrs, { version });
      if (row[version]) {
        await expect(write(client, row, {})).rejects.toThrow(
          new RegExp(
            `^A ${row.name.replace("Document", "").toUpperCase()} to the ${row.target.resource} resource needs a precondition on xAPI ${version.replaceAll(".", "\\.")}: pass `,
            "u",
          ),
        );
        expect(lrs.requests).toHaveLength(0);
      } else {
        expect(await write(client, row, {})).toBe("written");
        expect(lrs.requests[0]?.init.headers).not.toHaveProperty("if-match");
        expect(lrs.requests[0]?.init.headers).not.toHaveProperty("if-none-match");
      }
    });
  });

  it("names the ways to give a precondition: both to write, only ifMatch to remove", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const client = clientOf(lrs);
    await expect(client.putDocument(STATE, { contentType: "text/plain", body: encoder.encode("x") })).rejects.toThrow(
      'pass { ifNoneMatch: "*" } to create it or { ifMatch: etag } to change it as the option precondition.',
    );
    await expect(client.deleteDocument(STATE)).rejects.toThrow("pass { ifMatch: etag } as the option precondition.");
  });

  it("sends a precondition that the version does not require, when the caller gives one", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    await clientOf(lrs, { version: "1.0.3" }).putDocument(
      STATE,
      { contentType: "text/plain", body: encoder.encode("x") },
      { precondition: { ifMatch: ETAG } },
    );
    expect(lrs.requests[0]?.init.headers).toMatchObject({ "if-match": ETAG });
  });

  it.each([
    [{ precondition: {} }, "expected exactly one of ifMatch and ifNoneMatch"],
    [{ precondition: { ifMatch: ETAG, ifNoneMatch: "*" } }, "expected exactly one of ifMatch and ifNoneMatch"],
    [
      { precondition: { ifNoneMatch: "x" } },
      'The options object is invalid at precondition.ifNoneMatch: expected "*", found "x".',
    ],
    [{ precondition: { ifMatch: "" } }, "expected an entity tag without line breaks"],
    [{ precondition: { ifMatch: '"a"\r\nX: 1' } }, "expected an entity tag without line breaks"],
    [
      { precondition: { ifMatch: 5 } },
      "The options object is invalid at precondition.ifMatch: expected a string, found 5.",
    ],
    [{ precondition: { unless: ETAG } }, 'unexpected property "unless"'],
    [{ precondition: "x" }, "The options object is invalid at precondition"],
    [{ since: "x" }, 'The options object is invalid: unexpected property "since".'],
  ])("refuses the options %j for a write", async (options, sentence) => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    const failure = await failureOf(
      clientOf(lrs).putDocument(
        STATE,
        { contentType: "text/plain", body: encoder.encode("x") },
        fromJson(JSON.stringify(options)),
      ),
    );
    expect(failure).toBeInstanceOf(DataError);
    expect((failure as Error).message).toContain(sentence);
    expect(lrs.requests).toHaveLength(0);
  });

  it("refuses ifNoneMatch for a removal, which has only ifMatch", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    await expect(clientOf(lrs).deleteDocument(STATE, fromJson('{"precondition":{"ifNoneMatch":"*"}}'))).rejects.toThrow(
      'The options object is invalid at precondition: missing the property "ifMatch".',
    );
  });
});

describe("a target that is not valid", () => {
  const lrs = fakeLrs(() => ({ status: 204 }));
  const options = { precondition: { ifMatch: ETAG } };

  it.each([
    [
      { resource: "state", activityId: ACTIVITY, agent: AGENT },
      'The target is invalid: missing the property "stateId".',
    ],
    [{ resource: "state", activityId: ACTIVITY, agent: AGENT, stateId: "" }, "The target is invalid at stateId"],
    [{ resource: "state", activityId: "course", agent: AGENT, stateId: "s" }, "The target is invalid at activityId"],
    [{ resource: "state", activityId: ACTIVITY, agent: { name: "x" }, stateId: "s" }, "The target is invalid at agent"],
    [
      { resource: "state", activityId: ACTIVITY, agent: { objectType: "Group", member: [] }, stateId: "s" },
      "The target is invalid at agent",
    ],
    [
      { resource: "state", activityId: ACTIVITY, agent: AGENT, stateId: "s", registration: "x" },
      "The target is invalid at registration",
    ],
    [{ resource: "agent-profile", agent: AGENT }, 'The target is invalid: missing the property "profileId".'],
    [
      { resource: "agent-profile", agent: AGENT, profileId: "p", activityId: ACTIVITY },
      'unexpected property "activityId"',
    ],
    [{ resource: "activity-profile", profileId: "p" }, 'The target is invalid: missing the property "activityId".'],
    [
      { resource: "profile", profileId: "p" },
      'The target is invalid at resource: expected "state", "agent-profile" or "activity-profile", found "profile".',
    ],
    [{}, "The target is invalid at resource"],
    [null, "The target is invalid: expected an object, found null."],
    [[], "The target is invalid: expected an object, found an array."],
  ])("refuses the target %j on every call that takes one", async (target, sentence) => {
    const client = clientOf(lrs);
    const given = fromJson<DocumentTarget>(JSON.stringify(target));
    const calls = [
      client.getDocument(given),
      client.putDocument(given, { contentType: "text/plain", body: encoder.encode("x") }, options),
      client.postDocument(given, { a: 1 }, options),
      client.deleteDocument(given, options),
    ];
    for (const call of calls) {
      const failure = await failureOf(call);
      expect(failure).toBeInstanceOf(DataError);
      expect((failure as Error).message).toContain(sentence);
    }
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("listDocumentIds", () => {
  const SCOPES: readonly { scope: DocumentScope; path: string }[] = [
    {
      scope: { resource: "state", activityId: ACTIVITY, agent: AGENT },
      path: `/xapi/activities/state?activityId=${encodeURIComponent(ACTIVITY)}&agent=${AGENT_JSON}`,
    },
    {
      scope: { resource: "state", activityId: ACTIVITY, agent: AGENT, registration: uuid(4) },
      path: `/xapi/activities/state?activityId=${encodeURIComponent(ACTIVITY)}&agent=${AGENT_JSON}&registration=${uuid(4)}`,
    },
    { scope: { resource: "agent-profile", agent: AGENT }, path: `/xapi/agents/profile?agent=${AGENT_JSON}` },
    {
      scope: { resource: "activity-profile", activityId: ACTIVITY },
      path: `/xapi/activities/profile?activityId=${encodeURIComponent(ACTIVITY)}`,
    },
  ];

  it.each(SCOPES)("lists the ids of $scope.resource", async ({ scope, path }) => {
    const lrs = fakeLrs(() => ({ body: ["a", "b"] }));
    expect(await clientOf(lrs).listDocumentIds(scope)).toStrictEqual(["a", "b"]);
    expect(lrs.paths()).toStrictEqual([path]);
  });

  it("asks for the ids changed after a time", async () => {
    const lrs = fakeLrs(() => ({ body: [] }));
    expect(
      await clientOf(lrs).listDocumentIds(SCOPES[2]?.scope as DocumentScope, { since: "2026-01-01T00:00:00.000Z" }),
    ).toStrictEqual([]);
    expect(new URL(lrs.requests[0]?.url ?? "").searchParams.get("since")).toBe("2026-01-01T00:00:00.000Z");
  });

  it("refuses an answer that is no list of text, and a scope or a time that is not valid", async () => {
    const scope = SCOPES[0]?.scope as DocumentScope;
    await expect(clientOf(fakeLrs(() => ({ body: [1] }))).listDocumentIds(scope)).rejects.toThrow(
      "The answer is invalid at [0]",
    );
    await expect(clientOf(fakeLrs(() => ({ body: {} }))).listDocumentIds(scope)).rejects.toThrow(
      "The answer is invalid",
    );
    const lrs = fakeLrs(() => ({ body: [] }));
    await expect(clientOf(lrs).listDocumentIds({ resource: "state", activityId: ACTIVITY } as never)).rejects.toThrow(
      'The scope is invalid: missing the property "agent".',
    );
    await expect(clientOf(lrs).listDocumentIds(scope, { since: "x" })).rejects.toThrow(
      "The options object is invalid at since",
    );
    await expect(clientOf(lrs).listDocumentIds({ ...scope, stateId: "s" } as never)).rejects.toThrow(
      'unexpected property "stateId"',
    );
    expect(lrs.requests).toHaveLength(0);
  });
});

describe("deleteStates", () => {
  it("removes every state of an Agent in an Activity, without a precondition, on both versions", async () => {
    for (const version of ["2.0.0", "1.0.3"] as const) {
      const lrs = fakeLrs(() => ({ status: 204 }));
      await clientOf(lrs, { version }).deleteStates({
        resource: "state",
        activityId: ACTIVITY,
        agent: AGENT,
        registration: uuid(2),
      });
      const [request] = lrs.requests;
      expect(lrs.paths()).toStrictEqual([
        `/xapi/activities/state?activityId=${encodeURIComponent(ACTIVITY)}&agent=${AGENT_JSON}&registration=${uuid(2)}`,
      ]);
      expect(request?.init.method).toBe("DELETE");
      expect(request?.init.headers).not.toHaveProperty("if-match");
    }
  });

  it("accepts the signal of the call", async () => {
    const lrs = fakeLrs(() => ({ status: 204 }));
    await clientOf(lrs).deleteStates(
      { resource: "state", activityId: ACTIVITY, agent: AGENT },
      { signal: new AbortController().signal },
    );
    expect(lrs.requests).toHaveLength(1);
  });

  it("rejects with a ServiceError for another status, and refuses a scope that is not a state's", async () => {
    expect(
      await failureOf(
        clientOf(fakeLrs(() => ({ status: 404 }))).deleteStates({
          resource: "state",
          activityId: ACTIVITY,
          agent: AGENT,
        }),
      ),
    ).toBeInstanceOf(ServiceError);
    await expect(
      clientOf(fakeLrs(() => ({ status: 204 }))).deleteStates({ resource: "agent-profile", agent: AGENT } as never),
    ).rejects.toThrow("The scope is invalid at resource");
  });
});
