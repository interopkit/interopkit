import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { type Access, handleLrsRequest, type LrsOptions } from "../src/store/index.js";
import { statementOf } from "./lrs-client.js";
import { ALLOW_ALL, AUTHORITY, jsonOf, memory, optionsOf, requestOf, textOf } from "./memory-lrs.js";

const VERSION = "x-experience-api-version";
const BASIC = `Basic ${btoa("user:pass")}`;

/** Calls the handler with the stores of a fresh memory. */
async function ask(method: string, path: string, init = {}, changes: Partial<LrsOptions> = {}) {
  const store = memory();
  const response = await handleLrsRequest(requestOf(method, path, init), optionsOf(store, changes));
  return { response, store };
}

describe("handleLrsRequest: the routes", () => {
  it("answers 404 for a path that is no resource, below the base path or outside it", async () => {
    for (const path of ["/nothing", "/statements/", "/statements/x", "/xapi"]) {
      const { response } = await ask("GET", path);
      expect(response.status).toBe(404);
    }
    const outside = requestOf("GET", "/statements");
    const lrs = memory();
    expect(
      (await handleLrsRequest({ ...outside, url: "https://lrs.example.org/other/statements" }, optionsOf(lrs))).status,
    ).toBe(404);
    expect(
      (await handleLrsRequest({ ...outside, url: "https://lrs.example.org/xapistatements" }, optionsOf(lrs))).status,
    ).toBe(404);
  });

  it("serves the resources below the base path of the options, /xapi by default", async () => {
    const lrs = memory();
    const at = async (url: string, basePath?: string) =>
      (
        await handleLrsRequest(
          { ...requestOf("GET", "/statements"), url },
          optionsOf(lrs, basePath === undefined ? {} : { basePath }),
        )
      ).status;
    expect(await at("https://lrs.example.org/xapi/statements")).toBe(200);
    expect(await at("https://lrs.example.org/statements", "")).toBe(200);
    expect(await at("https://lrs.example.org/a/b/statements", "/a/b")).toBe(200);
    expect(await at("https://lrs.example.org/xapi/statements", "/a/b")).toBe(404);
  });

  it("serves a base path outside ASCII as the URL of a request writes it, whether it is given encoded or not", async () => {
    const lrs = memory();
    const at = async (url: string, basePath: string) =>
      (await handleLrsRequest({ ...requestOf("GET", "/statements"), url }, optionsOf(lrs, { basePath }))).status;
    for (const basePath of ["/café", "/caf%C3%A9"]) {
      expect(await at("https://lrs.example.org/café/statements", basePath)).toBe(200);
      expect(await at("https://lrs.example.org/caf%C3%A9/statements", basePath)).toBe(200);
    }
    await handleLrsRequest(
      requestOf("POST", "/statements", {
        headers: { "content-type": "application/json" },
        body: JSON.stringify([statementOf(1), statementOf(2)]),
      }),
      optionsOf(lrs),
    );
    const page = await handleLrsRequest(
      { ...requestOf("GET", "/statements"), url: "https://lrs.example.org/café/statements?limit=1" },
      optionsOf(lrs, { basePath: "/café" }),
    );
    expect((jsonOf(page) as { more: string }).more).toMatch(/^\/caf%C3%A9\/statements\?limit=1&cursor=/u);
  });

  it("answers 405 with the methods of the resource in Allow for another method", async () => {
    for (const method of ["DELETE", "PATCH", "OPTIONS", "get"]) {
      const { response } = await ask(method, "/statements");
      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe("GET, HEAD, PUT, POST");
      expect(jsonOf(response)).toStrictEqual({
        message: `The method ${method} is not allowed here: use GET, HEAD, PUT, POST.`,
      });
    }
  });
});

describe("handleLrsRequest: the version header", () => {
  it.each([
    ["2.0.0", "2.0.0"],
    ["2.0", "2.0.0"],
    ["2.0.1", "2.0.0"],
    ["2.0.12", "2.0.0"],
    ["1.0.3", "1.0.3"],
    ["1.0", "1.0.3"],
    ["1.0.0", "1.0.3"],
    ["1.0.9", "1.0.3"],
  ])(
    "serves a request that names the version %s on the route of %s, and names that route in the answer",
    async (version, route) => {
      const { response } = await ask("GET", "/statements", { headers: { [VERSION]: version } });
      expect(response.status).toBe(200);
      expect(response.headers[VERSION]).toBe(route);
    },
  );

  it.each(["0.95", "0.9", "1.1.0", "1.1", "2.1.0", "2.1", "3.0.0", "2", "1", "2.0.0.1", "2.0.x", "1.0.x", "", "abc"])(
    "refuses a request that names the version %j with 400",
    async (version) => {
      const { response, store } = await ask("GET", "/statements", { headers: { [VERSION]: version } });
      expect(response.status).toBe(400);
      expect(jsonOf(response)).toStrictEqual({
        message: `The header X-Experience-API-Version must be 2.0 or 2.0.x, or 1.0 or 1.0.x, found ${JSON.stringify(version)}.`,
      });
      expect(store.calls).toStrictEqual([]);
    },
  );

  it.each([
    [["2.0.0"], "1.0.3", "2.0 or 2.0.x", "2.0.0"],
    [["1.0.3"], "2.0.0", "1.0 or 1.0.x", "1.0.3"],
  ] as const)(
    "serves only the versions of the option versions %j, and refuses a request of %s",
    async (versions, refused, names, named) => {
      const lrs = memory();
      const options = optionsOf(lrs, { versions });
      const response = await handleLrsRequest(
        requestOf("GET", "/statements", { headers: { [VERSION]: refused } }),
        options,
      );
      expect(response.status).toBe(400);
      expect(jsonOf(response)).toStrictEqual({
        message: `The header X-Experience-API-Version must be ${names}, found ${JSON.stringify(refused)}.`,
      });
      expect(response.headers[VERSION]).toBe(named);
      const about = await handleLrsRequest(requestOf("GET", "/about", { headers: { [VERSION]: refused } }), options);
      expect(jsonOf(about)).toStrictEqual({ version: versions });
      expect(about.headers[VERSION]).toBe(named);
    },
  );

  it("refuses a request that names no version with 400", async () => {
    const request = requestOf("GET", "/statements");
    const { [VERSION]: _version, ...headers } = request.headers;
    const response = await handleLrsRequest({ ...request, headers }, optionsOf(memory()));
    expect(response.status).toBe(400);
    expect(textOf(response)).toContain("found none.");
  });

  it("names the version of the route in every answer, whatever its status, and the latest it serves when a request names none it serves", async () => {
    const lrs = memory();
    const options = optionsOf(lrs, {
      access: async () => ({ allowed: false, reason: "unauthenticated", message: "no" }),
    });
    const answers = [
      await handleLrsRequest(requestOf("GET", "/statements"), optionsOf(lrs)),
      await handleLrsRequest(requestOf("PUT", "/statements", { query: { statementId: "x" } }), optionsOf(lrs)),
      await handleLrsRequest(requestOf("GET", "/statements"), options),
      await handleLrsRequest(requestOf("GET", "/nothing"), options),
      await handleLrsRequest(requestOf("DELETE", "/statements"), options),
      await handleLrsRequest(requestOf("GET", "/statements", { headers: { [VERSION]: "2.1.0" } }), options),
      await handleLrsRequest(requestOf("GET", "/statements", { headers: { [VERSION]: "1.0.1" } }), options),
      await handleLrsRequest(requestOf("GET", "/nothing", { headers: { [VERSION]: "1.0" } }), options),
    ];
    expect(answers.map(({ status }) => status)).toStrictEqual([200, 400, 401, 404, 405, 400, 401, 404]);
    expect(answers.map((answer) => answer.headers[VERSION])).toStrictEqual([
      "2.0.0",
      "2.0.0",
      "2.0.0",
      "2.0.0",
      "2.0.0",
      "2.0.0",
      "1.0.3",
      "1.0.3",
    ]);
  });
});

describe("handleLrsRequest: how a refusal is written", () => {
  const refusal = async (accept?: string) => {
    const { accept: _default, ...headers } = requestOf("GET", "/nothing").headers;
    const request = {
      ...requestOf("GET", "/nothing"),
      headers: accept === undefined ? headers : { ...headers, accept },
    };
    return handleLrsRequest(request, optionsOf(memory()));
  };

  it("writes plain text when Accept names none, accepts everything, or prefers the types alike", async () => {
    for (const accept of [undefined, "*/*", "application/json, text/plain, */*", "text/plain, application/json"]) {
      const response = await refusal(accept);
      expect(response.headers["content-type"]).toBe("text/plain;charset=UTF-8");
      expect(textOf(response)).toBe("The LRS has no such resource.");
    }
  });

  it("writes JSON when Accept prefers it", async () => {
    for (const accept of ["application/json", "text/*;q=0.1, application/json", "application/json, text/plain;q=0.5"]) {
      const response = await refusal(accept);
      expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
      expect(jsonOf(response)).toStrictEqual({ message: "The LRS has no such resource." });
    }
  });

  it("writes plain text or HTML when Accept prefers them", async () => {
    const text = await refusal("text/plain");
    expect(text.headers["content-type"]).toBe("text/plain;charset=UTF-8");
    expect(textOf(text)).toBe("The LRS has no such resource.");
    const html = await refusal("text/html, application/json;q=0.5");
    expect(html.headers["content-type"]).toBe("text/html;charset=UTF-8");
    expect(textOf(html)).toBe("<!doctype html><title>404</title><p>The LRS has no such resource.</p>");
  });

  it("escapes what an HTML refusal says of the request", async () => {
    const { response } = await ask("PATCH", "/statements", { headers: { accept: "text/html" } });
    expect(textOf(response)).toBe(
      "<!doctype html><title>405</title><p>The method PATCH is not allowed here: use GET, HEAD, PUT, POST.</p>",
    );
    const lrs = memory();
    const hostile = await handleLrsRequest(
      requestOf("GET", "/statements", { headers: { accept: "text/html", [VERSION]: "<script>\"&'" } }),
      optionsOf(lrs),
    );
    expect(textOf(hostile)).toContain("&#60;script&#62;");
    expect(textOf(hostile)).not.toContain("<script>");
  });
});

describe("handleLrsRequest: access", () => {
  const request = () => requestOf("GET", "/statements", { headers: { authorization: BASIC } });

  it("asks access about the request and gives it the signal", async () => {
    const controller = new AbortController();
    const seen: unknown[] = [];
    const lrs = memory();
    await handleLrsRequest(
      request(),
      optionsOf(lrs, {
        access: async (asked, call) => {
          seen.push(asked.headers.authorization, call?.signal);
          return ALLOW_ALL;
        },
        signal: controller.signal,
      }),
    );
    expect(seen).toStrictEqual([BASIC, controller.signal]);
  });

  it("refuses with the status of the reason of access and its message, and calls no store", async () => {
    const decisions: [Access, number, string][] = [
      [
        { allowed: false, reason: "unauthenticated", message: "Log in.", challenge: 'Basic realm="xAPI"' },
        401,
        "Log in.",
      ],
      [{ allowed: false, reason: "forbidden", message: "Not yours." }, 403, "Not yours."],
      [
        { allowed: false, reason: "too-many-requests", message: "Slow down.", retryAfterSeconds: 30 },
        429,
        "Slow down.",
      ],
    ];
    for (const [decision, status, message] of decisions) {
      const lrs = memory();
      const response = await handleLrsRequest(request(), optionsOf(lrs, { access: async () => decision }));
      expect(response.status).toBe(status);
      expect(jsonOf(response)).toStrictEqual({ message });
      expect(lrs.calls).toStrictEqual([]);
    }
  });

  it("refuses with the status of the reason, and its sentence when access gives no message", async () => {
    for (const [reason, status, message] of [
      ["unauthenticated", 401, "The request is not authenticated."],
      ["forbidden", 403, "The request is not allowed."],
      ["too-many-requests", 429, "The client sends too many requests: retry later."],
    ] as const) {
      const response = await handleLrsRequest(
        request(),
        optionsOf(memory(), { access: async () => ({ allowed: false, reason }) }),
      );
      expect([response.status, jsonOf(response)]).toStrictEqual([status, { message }]);
    }
  });

  it("sends WWW-Authenticate with a 401 that has a challenge and Retry-After with a 429 that has a delay", async () => {
    const ask401 = (challenge?: string) =>
      handleLrsRequest(
        request(),
        optionsOf(memory(), {
          access: async () => ({
            allowed: false,
            reason: "unauthenticated",
            message: "Log in.",
            ...(challenge && { challenge }),
          }),
        }),
      );
    expect((await ask401('Bearer realm="x"')).headers["www-authenticate"]).toBe('Bearer realm="x"');
    expect((await ask401()).headers).not.toHaveProperty("www-authenticate");
    const ask429 = (retryAfterSeconds?: number) =>
      handleLrsRequest(
        request(),
        optionsOf(memory(), {
          access: async () => ({
            allowed: false,
            reason: "too-many-requests",
            message: "Slow.",
            ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
          }),
        }),
      );
    expect((await ask429(0)).headers["retry-after"]).toBe("0");
    expect((await ask429(90)).headers["retry-after"]).toBe("90");
    expect((await ask429()).headers).not.toHaveProperty("retry-after");
  });

  it("refuses with 403 a request for an action that the credentials do not allow", async () => {
    const readOnly: Access = { allowed: true, authority: AUTHORITY, actions: ["statements.read"] };
    const lrs = memory();
    const options = optionsOf(lrs, { access: async () => readOnly });
    expect((await handleLrsRequest(request(), options)).status).toBe(200);
    expect((await handleLrsRequest({ ...request(), method: "HEAD" }, options)).status).toBe(200);
    const write = await handleLrsRequest(
      requestOf("POST", "/statements", { body: "[]", headers: { "content-type": "application/json" } }),
      options,
    );
    expect(write.status).toBe(403);
    expect(jsonOf(write)).toStrictEqual({ message: "The credentials do not allow statements.write." });
    const none = optionsOf(lrs, { access: async () => ({ allowed: true, authority: AUTHORITY, actions: [] }) });
    expect((await handleLrsRequest(request(), none)).status).toBe(403);
  });

  it("takes an anonymous Group of two Agents as the authority, and refuses one of another size or an Agent with no identifier", async () => {
    const asAuthority = (authority: unknown) =>
      handleLrsRequest(
        request(),
        optionsOf(memory(), {
          access: async () => ({ allowed: true, authority, actions: ["statements.read"] }) as Access,
        }),
      );
    const oauth = {
      objectType: "Group",
      member: [
        { account: { homePage: "https://lms.example.org", name: "consumer" } },
        { mbox: "mailto:user@example.org" },
      ],
    };
    expect((await asAuthority(oauth)).status).toBe(200);
    expect((await asAuthority({ mbox: "mailto:a@example.org" })).status).toBe(200);
    await expect(asAuthority({ objectType: "Group" })).rejects.toThrow(
      "expected an Agent or Group with one identifier, or an anonymous Group of two Agents",
    );
    await expect(asAuthority({ objectType: "Group", member: [{ mbox: "mailto:a@example.org" }] })).rejects.toThrow(
      "or an anonymous Group of two Agents",
    );
    await expect(asAuthority({ name: "Nobody" })).rejects.toBeInstanceOf(DataError);
    await expect(asAuthority({ mbox: "mailto:a@example.org", openid: "https://example.org/a" })).rejects.toBeInstanceOf(
      DataError,
    );
  });

  it("answers 500 without a word of the cause when access rejects", async () => {
    const lrs = memory();
    const response = await handleLrsRequest(
      request(),
      optionsOf(lrs, { access: () => Promise.reject(new Error("the password store at db-7 is down")) }),
    );
    expect(response.status).toBe(500);
    expect(textOf(response)).not.toContain("db-7");
    expect(lrs.calls).toStrictEqual([]);
  });

  it("throws a DataError when access answers with something other than a decision", async () => {
    for (const decision of [
      undefined,
      null,
      {},
      { allowed: true },
      { allowed: true, authority: {}, actions: [] },
      { allowed: true, authority: AUTHORITY, actions: ["x"] },
      { allowed: true, authority: AUTHORITY, actions: [], principal: "" },
      { allowed: true, authority: AUTHORITY, actions: [], principal: 7 },
      { allowed: false, reason: "not-found", message: "x" },
      { allowed: false, reason: "unauthenticated", message: 7 },
    ] as unknown[]) {
      const asking = handleLrsRequest(request(), optionsOf(memory(), { access: async () => decision as Access }));
      await expect(asking).rejects.toBeInstanceOf(DataError);
    }
  });

  it("rejects with the reason of the signal when it aborts while access is asked", async () => {
    const controller = new AbortController();
    const asking = handleLrsRequest(
      request(),
      optionsOf(memory(), { access: () => new Promise<Access>(() => {}), signal: controller.signal }),
    );
    controller.abort(new Error("gave up"));
    await expect(asking).rejects.toStrictEqual(new Error("gave up"));
  });
});

describe("handleLrsRequest: the size of a request", () => {
  it("refuses a body above limits.maxBodyBytes with 413 before any store is called", async () => {
    const lrs = memory();
    const body = JSON.stringify(statementOf(1));
    const options = optionsOf(lrs, { limits: { maxBodyBytes: body.length } });
    const post = (payload: string) =>
      handleLrsRequest(
        requestOf("POST", "/statements", { body: payload, headers: { "content-type": "application/json" } }),
        options,
      );
    expect((await post(body)).status).toBe(200);
    lrs.calls.length = 0;
    const refused = await post(`${body} `);
    expect(refused.status).toBe(413);
    expect(jsonOf(refused)).toStrictEqual({
      message: `The body has ${body.length + 1} bytes, above the limit of ${body.length} bytes.`,
    });
    expect(lrs.calls).toStrictEqual([]);
  });

  it("refuses 10 MiB and one more byte by default", async () => {
    const lrs = memory();
    const big = new Uint8Array(10_485_761);
    const response = await handleLrsRequest(
      requestOf("POST", "/statements", { body: big, headers: { "content-type": "application/json" } }),
      optionsOf(lrs),
    );
    expect(response.status).toBe(413);
  });
});

describe("handleLrsRequest: HEAD", () => {
  it("answers as GET does, with the same status and headers and no body", async () => {
    const lrs = memory();
    await handleLrsRequest(
      requestOf("POST", "/statements", {
        body: JSON.stringify(statementOf(1)),
        headers: { "content-type": "application/json" },
      }),
      optionsOf(lrs),
    );
    const get = await handleLrsRequest(requestOf("GET", "/statements"), optionsOf(lrs));
    const head = await handleLrsRequest(requestOf("HEAD", "/statements"), optionsOf(lrs));
    expect(get.body).not.toBe("");
    expect(head.body).toBe("");
    expect(head.status).toBe(get.status);
    expect(head.headers).toStrictEqual(get.headers);
  });

  it("answers a refusal without a body too, with the status and headers of the refusal", async () => {
    const lrs = memory();
    const head = await handleLrsRequest(requestOf("HEAD", "/statements", { query: { nothing: "1" } }), optionsOf(lrs));
    expect([head.status, head.body]).toStrictEqual([400, ""]);
    expect(head.headers["content-type"]).toBe("application/json;charset=UTF-8");
  });
});

describe("handleLrsRequest: the options", () => {
  const lrs = memory();
  const valid = optionsOf(lrs);
  const run = (options: unknown) => handleLrsRequest(requestOf("GET", "/statements"), options as LrsOptions);

  it("takes the clock of the system when the options name none", async () => {
    const { clock: _none, ...withoutClock } = valid;
    expect((await run(withoutClock)).status).toBe(200);
  });

  it("throws a DataError that names the option for options that are not valid", async () => {
    const cases: [unknown, string][] = [
      [null, "The configuration of the LRS is invalid: expected an object, found null."],
      [[], "The configuration of the LRS is invalid: expected an object, found an array."],
      [{ ...valid, statements: {} }, "The configuration of the LRS is invalid at statements"],
      [
        { ...valid, activities: undefined },
        "The configuration of the LRS is invalid at activities: expected an object with the functions get and observe, found undefined.",
      ],
      [
        { ...valid, access: "yes" },
        'The configuration of the LRS is invalid at access: expected a function, found "yes".',
      ],
      [{ ...valid, clock: {} }, "The configuration of the LRS is invalid at clock"],
      [
        { ...valid, basePath: "xapi" },
        'The configuration of the LRS is invalid at basePath: expected "" or a path that starts with / and does not end with /, found "xapi".',
      ],
      [{ ...valid, basePath: "/xapi/" }, "The configuration of the LRS is invalid at basePath"],
      [
        { ...valid, basePath: "/xapi/.." },
        'The configuration of the LRS is invalid at basePath: expected "" or a path that starts with / and does not end with /, found "/".',
      ],
      [{ ...valid, basePath: "/xapi/." }, "The configuration of the LRS is invalid at basePath"],
      [{ ...valid, newId: 5 }, "The configuration of the LRS is invalid at newId: expected a function, found 5."],
      [{ ...valid, accept: "x" }, "The configuration of the LRS is invalid at accept"],
      [{ ...valid, acceptStatus: 401 }, "The configuration of the LRS is invalid at acceptStatus"],
      [{ ...valid, acceptStatus: "403" }, "The configuration of the LRS is invalid at acceptStatus"],
      [{ ...valid, trustCertificate: "x" }, "The configuration of the LRS is invalid at trustCertificate"],
      [
        { ...valid, keepSubmittedAuthority: "yes" },
        'The configuration of the LRS is invalid at keepSubmittedAuthority: expected true or false, found "yes".',
      ],
      [
        { ...valid, limits: { maxBatch: 0 } },
        "The configuration of the LRS is invalid at limits.maxBatch: expected a value of at least 1, found 0.",
      ],
      [
        { ...valid, limits: { maxBatches: 5 } },
        'The configuration of the LRS is invalid at limits: unexpected property "maxBatches".',
      ],
      [
        { ...valid, signal: {} },
        "The configuration of the LRS is invalid at signal: expected an AbortSignal, found an object.",
      ],
      [
        { ...valid, versions: [] },
        'The configuration of the LRS is invalid at versions: expected a list of "2.0.0" and "1.0.3", with each once and at least one, found an array.',
      ],
      [{ ...valid, versions: ["2.0.0", "2.0.0"] }, "The configuration of the LRS is invalid at versions"],
      [{ ...valid, versions: ["2.1.0"] }, "The configuration of the LRS is invalid at versions"],
      [{ ...valid, versions: "2.0.0" }, "The configuration of the LRS is invalid at versions"],
      [{ ...valid, version: "2.0.0" }, 'The configuration of the LRS is invalid: unexpected property "version".'],
    ];
    for (const [options, sentence] of cases) {
      await expect(run(options)).rejects.toBeInstanceOf(DataError);
      await expect(run(options)).rejects.toThrow(sentence);
    }
  });

  it("throws a DataError for a request that is not a request", async () => {
    for (const value of [
      null,
      {},
      { method: "GET", url: "x", headers: {}, body: new Uint8Array() },
      { method: "GET", url: "https://a.b/", headers: {}, body: "text" },
    ]) {
      await expect(handleLrsRequest(value as never, valid)).rejects.toBeInstanceOf(DataError);
    }
  });

  it("accepts every option once, and the limits one by one", async () => {
    const limits = {
      maxBodyBytes: 1,
      maxBatch: 1,
      pageSize: 1,
      maxPageSize: 1,
      maxParts: 1,
      maxPartBytes: 1,
      maxDepth: 1,
    };
    const full = {
      ...valid,
      basePath: "/xapi",
      accept: async () => [],
      acceptStatus: 403,
      trustCertificate: async () => true,
      keepSubmittedAuthority: true,
      limits,
      signal: new AbortController().signal,
    };
    expect((await run(full)).status).toBe(200);
  });
});
