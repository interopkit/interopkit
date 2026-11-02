import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import { describe, expect, it } from "vitest";
import { readEntity } from "../src/index.js";
import { type CredentialsProviderOptions, handleCredentialsRequest } from "../src/provider/index.js";
import {
  achievementCredential,
  achievementCredentialV1p1,
  clrCredential,
  endorsementCredential,
  PROFILE,
} from "./fixtures.js";
import {
  type Asked,
  bearerAuthorize,
  description,
  jsonOf,
  memoryStores,
  minorOf,
  ORIGIN,
  ROOTS,
  request,
  SCOPES,
  serving,
} from "./provider-fixture.js";

const OB = ROOTS.badges;
const CLR = ROOTS.clr;
const JSON_TYPE = "application/json";

/** The body of a credential as a request carries it. */
const json = (value: unknown) => JSON.stringify(value);

/** A credential of the test with another id, and a `validFrom` that the test chooses. */
const numbered = (index: number, validFrom = "2024-06-13T10:00:00Z") => ({
  ...achievementCredential(),
  id: `https://example.edu/credentials/${index}`,
  validFrom,
});

/** Writes a payload as a compact JWS with a signature that no one checks, as a store sees it before any verification. */
function unsignedJws(payload: unknown): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES256", typ: "JWT" })}.${part(payload)}.c2ln`;
}

/** Sends one request to a provider of an API over the stores of the options. */
const handle = (
  options: CredentialsProviderOptions,
  method: string,
  path: string,
  init?: Parameters<typeof request>[2],
) => handleCredentialsRequest(request(method, path, init), options);

/** The ports that the test saw called, by name. */
const ports = (asked: readonly Asked[]) => asked.map(({ port }) => port);

describe("the endpoints of the provider", () => {
  it("answers the five operations of OB 6.2 and 6.3 below the path of each API", async () => {
    for (const api of ["badges", "clr"] as const) {
      const { options } = serving(api);
      const root = ROOTS[api];
      expect((await handle(options, "GET", `${root}/credentials`)).status).toBe(200);
      expect((await handle(options, "GET", `${root}/profile`)).status).toBe(404);
      expect((await handle(options, "PUT", `${root}/profile`, { body: json(PROFILE), type: JSON_TYPE })).status).toBe(
        200,
      );
      const credential = api === "badges" ? achievementCredential() : clrCredential();
      expect(
        (await handle(options, "POST", `${root}/credentials`, { body: json(credential), type: JSON_TYPE })).status,
      ).toBe(201);
      expect((await handle(options, "GET", `${root}/discovery`, { token: null })).status).toBe(200);
    }
  });

  it("answers 404 not_found with the severity status for a path that is no endpoint, as OB B.3.6 pairs them", async () => {
    const { options, asked } = serving();
    for (const path of [`${OB}/credential`, `${OB}/credentials/`, `${CLR}/credentials`, "/credentials", `${OB}`]) {
      const response = await handle(options, "GET", path);
      expect(response.status, path).toBe(404);
      expect(minorOf(response)).toBe("not_found");
      expect(readEntity("imsx_StatusInfo", jsonOf(response)).imsx_severity).toBe("status");
    }
    expect(asked).toStrictEqual([]);
  });

  it("answers 405 not_allowed with the methods of the endpoint in Allow", async () => {
    const { options, asked } = serving();
    const cases = [
      ["DELETE", `${OB}/credentials`, "GET, POST"],
      ["PUT", `${OB}/credentials`, "GET, POST"],
      ["POST", `${OB}/profile`, "GET, PUT"],
      ["POST", `${OB}/discovery`, "GET"],
      ["HEAD", `${OB}/discovery`, "GET"],
    ] as const;
    for (const [method, path, allow] of cases) {
      const response = await handle(options, method, path);
      expect(response.status, `${method} ${path}`).toBe(405);
      expect(response.headers.allow).toBe(allow);
      expect(minorOf(response)).toBe("not_allowed");
    }
    expect(asked).toStrictEqual([]);
  });

  it("serves below the base path where the host mounts it, and nowhere else", async () => {
    const { options } = serving("badges", { basePath: "/tenant/a" });
    expect((await handle(options, "GET", `/tenant/a${OB}/credentials`)).status).toBe(200);
    expect((await handle(options, "GET", `${OB}/credentials`)).status).toBe(404);
    expect((await handle(options, "GET", `/tenant/b${OB}/credentials`)).status).toBe(404);
  });
});

describe("the scopes of the operations", () => {
  it("asks authorize for the scope that the tables of scopes of Open Badges and CLR give each operation", async () => {
    for (const api of ["badges", "clr"] as const) {
      const { options, asked } = serving(api);
      const root = ROOTS[api];
      const credential = api === "badges" ? achievementCredential() : clrCredential();
      await handle(options, "GET", `${root}/credentials`);
      await handle(options, "POST", `${root}/credentials`, { body: json(credential), type: JSON_TYPE });
      await handle(options, "GET", `${root}/profile`);
      await handle(options, "PUT", `${root}/profile`, { body: json(PROFILE), type: JSON_TYPE });
      expect(asked.filter(({ port }) => port === "authorize").map(({ argument }) => argument)).toStrictEqual([
        SCOPES[api].getCredentials,
        SCOPES[api].upsertCredential,
        SCOPES[api].getProfile,
        SCOPES[api].putProfile,
      ]);
    }
  });

  it("serves the service description without asking authorize, since OB 6.3 says it MUST NOT be protected", async () => {
    const { options, asked } = serving();
    const response = await handle(options, "GET", `${OB}/discovery`, { token: null });
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual(description());
    expect(asked).toStrictEqual([]);
  });

  it("answers 401 with the challenge of a bearer token for a request without a token, and asks no store", async () => {
    const { options, asked } = serving();
    for (const token of [null, "token-unknown"]) {
      const response = await handle(options, "GET", `${OB}/credentials`, { token });
      expect(response.status).toBe(401);
      expect(response.headers["www-authenticate"]).toBe("Bearer");
      expect(minorOf(response)).toBe("unauthorizedrequest");
    }
    expect(ports(asked)).toStrictEqual(["authorize", "authorize"]);
  });

  it("answers 403 insufficient_scope, naming the scope, for a token without it, as RFC 6750 says, and changes nothing", async () => {
    const { options, asked, held } = serving();
    const response = await handle(options, "POST", `${OB}/credentials`, {
      body: json(achievementCredential()),
      type: JSON_TYPE,
      token: "token-read",
    });
    expect(response.status).toBe(403);
    expect(response.headers["www-authenticate"]).toBe(
      `Bearer error="insufficient_scope", scope="${SCOPES.badges.upsertCredential}"`,
    );
    expect(minorOf(response)).toBe("forbidden");
    expect(ports(asked)).toStrictEqual(["authorize"]);
    expect(held.credentials.size).toBe(0);
    const scoped = await handle(options, "PUT", `${OB}/profile`, {
      body: json(PROFILE),
      type: JSON_TYPE,
      token: "token-read",
    });
    expect(scoped.status).toBe(403);
    expect(held.profiles.size).toBe(0);
  });

  it("does not let the scope of one API reach the other", async () => {
    const { options } = serving("clr", {
      authorize: async (_request, scope) =>
        scope === SCOPES.badges.getCredentials
          ? { allowed: true, owner: "learner-1" }
          : { allowed: false, status: 403 },
    });
    expect((await handle(options, "GET", `${CLR}/credentials`)).status).toBe(403);
  });

  it("answers 429 server_busy with Retry-After when authorize refuses one request too many, and without it when no delay is given", async () => {
    const busy = (retryAfterSeconds?: number) =>
      serving("badges", {
        authorize: async () => ({
          allowed: false,
          status: 429,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
        }),
      }).options;
    const timed = await handle(busy(120), "GET", `${OB}/credentials`);
    expect(timed.status).toBe(429);
    expect(timed.headers["retry-after"]).toBe("120");
    expect(minorOf(timed)).toBe("server_busy");
    expect((await handle(busy(), "GET", `${OB}/credentials`)).headers["retry-after"]).toBeUndefined();
  });

  it("answers a refusal with the reason and the challenge that authorize gives", async () => {
    const refusing = (decision: object) => serving("badges", { authorize: async () => decision as never }).options;
    const expired = await handle(
      refusing({
        allowed: false,
        status: 401,
        reason: "The token expired.",
        challenge: 'Bearer error="invalid_token"',
      }),
      "GET",
      `${OB}/credentials`,
    );
    expect(expired.headers["www-authenticate"]).toBe('Bearer error="invalid_token"');
    expect(JSON.parse(String(expired.body))).toMatchObject({ imsx_description: "The token expired." });
    const plain = await handle(refusing({ allowed: false, status: 401 }), "GET", `${OB}/credentials`);
    expect(plain.headers["www-authenticate"]).toBe("Bearer");
    const denied = await handle(
      refusing({ allowed: false, status: 403, reason: "Not yours." }),
      "GET",
      `${OB}/profile`,
    );
    expect(JSON.parse(String(denied.body))).toMatchObject({ imsx_description: "Not yours." });
    expect(denied.headers["www-authenticate"]).toContain("insufficient_scope");
  });

  it("gives each user only their own credentials and profile, as authorize names the owner", async () => {
    const { options } = serving();
    await handle(options, "POST", `${OB}/credentials`, { body: json(achievementCredential()), type: JSON_TYPE });
    const mine = jsonOf(await handle(options, "GET", `${OB}/credentials`));
    const theirs = jsonOf(await handle(options, "GET", `${OB}/credentials`, { token: "token-other" }));
    expect(mine).toStrictEqual({ credential: [achievementCredential()], compactJwsString: [] });
    expect(theirs).toStrictEqual({ credential: [], compactJwsString: [] });
  });
});

describe("the list of credentials", () => {
  /** A provider whose store holds five credentials of the owner, the second and the fourth as compact JWS. */
  async function holdingFive(count = true) {
    const stores = memoryStores({ count });
    const options = { ...serving().options, credentials: stores.credentials };
    for (let index = 1; index <= 5; index += 1) {
      const credential = numbered(index);
      const body = index % 2 === 0 ? unsignedJws(credential) : json(credential);
      await handle(options, "POST", `${OB}/credentials`, { body, type: index % 2 === 0 ? "text/plain" : JSON_TYPE });
    }
    return { options, asked: stores.asked };
  }

  it("answers a page with the objects in credential and the JWS in compactJwsString, as GetOpenBadgeCredentialsResponse holds them", async () => {
    const { options } = await holdingFive();
    const response = await handle(options, "GET", `${OB}/credentials?limit=2&offset=2`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(jsonOf(response)).toStrictEqual({ credential: [numbered(3)], compactJwsString: [unsignedJws(numbered(4))] });
    expect(readEntity("GetOpenBadgeCredentialsResponse", jsonOf(response)).compactJwsString).toHaveLength(1);
  });

  it("sends X-Total-Count and a Link with first, prev, next and last, as OB 6.4 asks", async () => {
    const { options } = await holdingFive();
    const response = await handle(options, "GET", `${OB}/credentials?limit=2&offset=2`);
    const at = (offset: number) => `<${ORIGIN}${OB}/credentials?limit=2&offset=${offset}>`;
    expect(response.headers["x-total-count"]).toBe("5");
    expect(response.headers.link).toBe(
      `${at(0)}; rel="first", ${at(0)}; rel="prev", ${at(4)}; rel="next", ${at(4)}; rel="last"`,
    );
  });

  it("omits X-Total-Count when the store cannot count, as OB 6.4 says, and gives next while a page is full", async () => {
    const { options } = await holdingFive(false);
    const full = await handle(options, "GET", `${OB}/credentials?limit=2&offset=0`);
    expect(full.headers["x-total-count"]).toBeUndefined();
    expect(full.headers.link).toBe(
      `<${ORIGIN}${OB}/credentials?limit=2&offset=0>; rel="first", <${ORIGIN}${OB}/credentials?limit=2&offset=2>; rel="next"`,
    );
    const last = await handle(options, "GET", `${OB}/credentials?limit=2&offset=4`);
    expect(last.headers.link).toBe(
      `<${ORIGIN}${OB}/credentials?limit=2&offset=0>; rel="first", <${ORIGIN}${OB}/credentials?limit=2&offset=2>; rel="prev"`,
    );
  });

  it("asks the store for 100 credentials unless the limit says otherwise, and lowers a limit above the largest page", async () => {
    const { options, asked } = await holdingFive();
    await handle(options, "GET", `${OB}/credentials`);
    await handle({ ...options, maxPageSize: 3 }, "GET", `${OB}/credentials?limit=50`);
    await handle({ ...options, pageSize: 7 }, "GET", `${OB}/credentials`);
    const pages = asked
      .filter(({ port }) => port === "list")
      .map(({ argument }) => (argument as { page: unknown }).page);
    expect(pages).toStrictEqual([
      { limit: 100, offset: 0 },
      { limit: 3, offset: 0 },
      { limit: 7, offset: 0 },
    ]);
  });

  it("passes since to the store, and keeps it in the links of the pages", async () => {
    const { options, asked } = await holdingFive();
    const since = "2024-01-01T00:00:00Z";
    const response = await handle(options, "GET", `${OB}/credentials?since=${encodeURIComponent(since)}&limit=2`);
    expect(asked.at(-1)?.argument).toStrictEqual({ owner: "learner-1", page: { limit: 2, offset: 0, since } });
    expect(response.headers.link).toContain(`since=2024-01-01T00%3A00%3A00Z&limit=2&offset=2>; rel="next"`);
  });

  it("answers 400 invalid_query_parameter for a limit, an offset or a since that the request table of getCredentials does not allow", async () => {
    const { options, asked } = await holdingFive();
    const before = asked.length;
    const queries = [
      "limit=0",
      "limit=x",
      "offset=-1",
      "offset=1.5",
      "since=yesterday",
      "since=2024-06-13T10:00:00",
      "limit=1&limit=2",
    ];
    for (const query of queries) {
      const response = await handle(options, "GET", `${OB}/credentials?${query}`);
      expect(response.status, query).toBe(400);
      expect(minorOf(response), query).toBe("invalid_query_parameter");
    }
    expect(ports(asked.slice(before)).filter((port) => port === "list")).toStrictEqual([]);
  });

  it("answers an empty list with empty lists and a total of 0", async () => {
    const { options } = serving();
    const response = await handle(options, "GET", `${OB}/credentials`);
    expect(jsonOf(response)).toStrictEqual({ credential: [], compactJwsString: [] });
    expect(response.headers["x-total-count"]).toBe("0");
  });
});

describe("the upsert of a credential", () => {
  it("creates a credential sent as JSON with 201, and answers with the credential of the request in its media type", async () => {
    const types = [
      ["application/json", "application/json"],
      ["application/vc+ld+json", "application/vc+ld+json"],
      ["Application/JSON; charset=utf-8", "application/json"],
    ] as const;
    for (const [type, echoed] of types) {
      const { options, held } = serving();
      const body = json(achievementCredential());
      const response = await handle(options, "POST", `${OB}/credentials`, { body, type });
      expect(response).toStrictEqual({
        status: 201,
        headers: { "content-type": echoed },
        body,
      } satisfies HttpResponse);
      expect(held.credentials.get("learner-1")?.[0]?.received).toStrictEqual(achievementCredential());
    }
  });

  it("creates a credential sent as a compact JWS in text/plain, and passes the store the JWS and the credential it carries", async () => {
    const { options, held } = serving();
    const jws = unsignedJws(numbered(9));
    const response = await handle(options, "POST", `${OB}/credentials`, { body: jws, type: "text/plain" });
    expect(response).toStrictEqual({ status: 201, headers: { "content-type": "text/plain" }, body: jws });
    const [stored] = held.credentials.get("learner-1") ?? [];
    expect(stored?.received).toBe(jws);
    expect(stored?.credential).toMatchObject({ id: "https://example.edu/credentials/9" });
  });

  it("reads the credential of a JWS in the vc claim form of VC-JWT 1.1, with the claims that fill it", async () => {
    const { options, held } = serving();
    const { id, ...credential } = achievementCredentialV1p1();
    const jws = unsignedJws({ vc: credential, jti: id, iss: "https://example.edu/issuers/1", nbf: 1_718_272_800 });
    expect((await handle(options, "POST", `${OB}/credentials`, { body: jws, type: "text/plain" })).status).toBe(201);
    expect(held.credentials.get("learner-1")?.[0]?.credential).toMatchObject({
      id,
      issuanceDate: "2024-06-13T10:00:00Z",
    });
  });

  it("answers 200 for a newer credential that replaces an equal one, and 304 with no body for one that does not, as OB 10 decides", async () => {
    const { options, held } = serving();
    const post = (credential: unknown) =>
      handle(options, "POST", `${OB}/credentials`, { body: json(credential), type: JSON_TYPE });
    expect((await post(numbered(1))).status).toBe(201);
    const newer = numbered(1, "2025-01-01T00:00:00Z");
    expect((await post(newer)).status).toBe(200);
    expect(await post(numbered(1))).toStrictEqual({ status: 304, headers: {}, body: "" });
    expect(held.credentials.get("learner-1")?.map(({ received }) => received)).toStrictEqual([newer]);
  });

  it("takes the CLR of the CLR API and refuses another kind with 422 invalid_data, on each API", async () => {
    const cases = [
      ["badges", clrCredential()],
      ["badges", endorsementCredential()],
      ["clr", achievementCredential()],
      ["clr", endorsementCredential()],
    ] as const;
    for (const [api, credential] of cases) {
      const { options, held } = serving(api);
      const response = await handle(options, "POST", `${ROOTS[api]}/credentials`, {
        body: json(credential),
        type: JSON_TYPE,
      });
      expect(response.status, `${api} ${String(credential.type)}`).toBe(422);
      expect(minorOf(response)).toBe("invalid_data");
      expect(held.credentials.size).toBe(0);
    }
    const jws = unsignedJws(endorsementCredential());
    expect(
      (await handle(serving().options, "POST", `${OB}/credentials`, { body: jws, type: "text/plain" })).status,
    ).toBe(422);
  });

  it("answers 422 invalid_data, naming the path, for JSON that is not a credential", async () => {
    const { options, held } = serving();
    const { issuer: _issuer, ...noIssuer } = achievementCredential();
    for (const body of [json(noIssuer), "[]", "5", json({ ...achievementCredential(), validFrom: "yesterday" })]) {
      const response = await handle(options, "POST", `${OB}/credentials`, { body, type: JSON_TYPE });
      expect(response.status, body).toBe(422);
      expect(minorOf(response)).toBe("invalid_data");
    }
    const missing = await handle(options, "POST", `${OB}/credentials`, { body: json(noIssuer), type: JSON_TYPE });
    expect(readEntity("imsx_StatusInfo", jsonOf(missing)).imsx_description).toContain("issuer");
    expect(held.credentials.size).toBe(0);
  });

  it("answers 400 for a body that is not what its media type says, and 422 for a JWS whose payload is no credential", async () => {
    const { options, held } = serving();
    const unreadable = [
      ["{", JSON_TYPE],
      ["not a jws", "text/plain"],
      [`${unsignedJws(achievementCredential())}\n`, "text/plain"],
      [new Uint8Array([0xff, 0xfe]), JSON_TYPE],
    ] as const;
    for (const [body, type] of unreadable) {
      const response = await handle(options, "POST", `${OB}/credentials`, { body, type });
      expect(response.status, String(body)).toBe(400);
    }
    for (const payload of [[1], { type: ["VerifiableCredential"] }]) {
      const response = await handle(options, "POST", `${OB}/credentials`, {
        body: unsignedJws(payload),
        type: "text/plain",
      });
      expect(response.status).toBe(422);
    }
    expect(held.credentials.size).toBe(0);
  });

  it("answers 415 for a body of another media type, or of none", async () => {
    const { options, asked } = serving();
    for (const type of ["application/xml", "application/jwt", "", undefined]) {
      const response = await handle(options, "POST", `${OB}/credentials`, {
        body: json(achievementCredential()),
        ...(type === undefined ? {} : { type }),
      });
      expect(response.status, String(type)).toBe(415);
    }
    expect(ports(asked).filter((port) => port === "upsert")).toStrictEqual([]);
  });
});

describe("the limits of a body", () => {
  it("answers 413 for a body above maxBodyBytes before it is read, and asks no store", async () => {
    const { options, asked } = serving("badges", { maxBodyBytes: 100 });
    for (const [method, path] of [
      ["POST", `${OB}/credentials`],
      ["PUT", `${OB}/profile`],
    ] as const) {
      const response = await handle(options, method, path, { body: "x".repeat(101), type: JSON_TYPE });
      expect(response.status).toBe(413);
    }
    expect(ports(asked).filter((port) => port !== "authorize")).toStrictEqual([]);
  });

  it("refuses JSON over the token limit or the depth limit before it parses it", async () => {
    const { options } = serving("badges", { maxTokens: 50 });
    const many = await handle(options, "POST", `${OB}/credentials`, {
      body: json(achievementCredential()),
      type: JSON_TYPE,
    });
    expect(many.status).toBe(400);
    expect(readEntity("imsx_StatusInfo", jsonOf(many)).imsx_description).toContain("50 tokens");
    const deep = await handle(serving().options, "POST", `${OB}/credentials`, {
      body: `${"[".repeat(100)}${"]".repeat(100)}`,
      type: JSON_TYPE,
    });
    expect(deep.status).toBe(400);
    const payload = await handle(options, "POST", `${OB}/credentials`, {
      body: unsignedJws(achievementCredential()),
      type: "text/plain",
    });
    expect(payload.status).toBe(422);
    expect(readEntity("imsx_StatusInfo", jsonOf(payload)).imsx_description).toContain("50 tokens");
  });
});

describe("the profile", () => {
  it("answers the profile that the store holds, and 404 not_found when it holds none", async () => {
    const { options, held } = serving();
    const none = await handle(options, "GET", `${OB}/profile`);
    expect(none.status).toBe(404);
    expect(minorOf(none)).toBe("not_found");
    held.profiles.set("learner-1", PROFILE);
    const found = await handle(options, "GET", `${OB}/profile`);
    expect(found.status).toBe(200);
    expect(jsonOf(found)).toStrictEqual(PROFILE);
  });

  it("replaces the whole profile with the profile of the request, and answers what the store returns", async () => {
    const pending = { ...PROFILE, name: "Before" };
    const { options, held } = serving("badges", {
      profiles: { get: async () => undefined, put: async () => pending },
    });
    const profile = { ...PROFILE, name: "Example University" };
    const response = await handle(options, "PUT", `${OB}/profile`, { body: json(profile), type: JSON_TYPE });
    expect(response.status).toBe(200);
    expect(jsonOf(response)).toStrictEqual(pending);
    expect(held.profiles.size).toBe(0);
  });

  it("refuses a profile that is not one with 422, a body that is not JSON with 400, and another media type with 415", async () => {
    const { options, held } = serving();
    const put = (body: string, type?: string) =>
      handle(options, "PUT", `${OB}/profile`, { body, ...(type === undefined ? {} : { type }) });
    expect((await put(json({ id: "https://example.edu/issuers/1" }), JSON_TYPE)).status).toBe(422);
    expect((await put("[]", JSON_TYPE)).status).toBe(422);
    expect((await put("{", JSON_TYPE)).status).toBe(400);
    expect((await put(json(PROFILE), "text/plain")).status).toBe(415);
    expect((await put(json(PROFILE), "application/vc+ld+json")).status).toBe(415);
    expect(held.profiles.size).toBe(0);
  });
});

describe("the ports", () => {
  const failing = () => Promise.reject(new Error("The database is down at db.internal:5432."));

  it("answers 500 internal_server_error with nothing of the cause when a port rejects or throws", async () => {
    const throwing = () => {
      throw new Error("db.internal");
    };
    const cases: [string, string, Partial<CredentialsProviderOptions>, { body?: string; type?: string }][] = [
      ["GET", `${OB}/credentials`, { credentials: { list: failing, upsert: failing } }, {}],
      [
        "POST",
        `${OB}/credentials`,
        { credentials: { list: failing, upsert: throwing } },
        { body: json(achievementCredential()), type: JSON_TYPE },
      ],
      ["GET", `${OB}/profile`, { profiles: { get: failing, put: failing } }, {}],
      ["PUT", `${OB}/profile`, { profiles: { get: failing, put: failing } }, { body: json(PROFILE), type: JSON_TYPE }],
      ["GET", `${OB}/credentials`, { authorize: failing }, {}],
      ["GET", `${OB}/profile`, { authorize: throwing }, {}],
    ];
    for (const [method, path, extra, init] of cases) {
      const response = await handle(serving("badges", extra).options, method, path, init);
      expect(response.status, `${method} ${path}`).toBe(500);
      expect(minorOf(response)).toBe("internal_server_error");
      expect(String(response.body)).not.toContain("db.internal");
    }
  });

  it("throws a DataError for a port that answers something other than its contract", async () => {
    const answering = (value: unknown) => async () => JSON.parse(JSON.stringify(value)) as never;
    const credentials = (list: unknown, upsert: unknown = "created") => ({
      credentials: { list: answering(list), upsert: answering(upsert) },
    });
    const cases: [string, string, Partial<CredentialsProviderOptions>, string][] = [
      ["GET", `${OB}/credentials`, credentials({ credentials: [5] }), "The answer of CredentialStore.list"],
      ["GET", `${OB}/credentials`, credentials({ credentials: ["not a jws"] }), "The answer of CredentialStore.list"],
      ["GET", `${OB}/credentials`, credentials({ credentials: [], total: -1 }), "The answer of CredentialStore.list"],
      ["GET", `${OB}/credentials?limit=1`, credentials({ credentials: [{}, {}] }), "for a limit of 1"],
      ["POST", `${OB}/credentials`, credentials({ credentials: [] }, "stored"), "The answer of CredentialStore.upsert"],
      [
        "GET",
        `${OB}/profile`,
        { profiles: { get: answering("x"), put: answering({}) } },
        "The answer of ProfileStore.get",
      ],
      [
        "PUT",
        `${OB}/profile`,
        { profiles: { get: answering(undefined), put: answering(null) } },
        "The answer of ProfileStore.put",
      ],
      ["GET", `${OB}/profile`, { authorize: answering({ allowed: true }) }, "The decision of authorize"],
      ["GET", `${OB}/profile`, { authorize: answering({ allowed: false, status: 500 }) }, "The decision of authorize"],
    ];
    for (const [method, path, extra, message] of cases) {
      const body =
        method === "GET" ? {} : { body: json(method === "PUT" ? PROFILE : achievementCredential()), type: JSON_TYPE };
      await expect(handle(serving("badges", extra).options, method, path, body), message).rejects.toThrow(
        expect.objectContaining({ name: "DataError", message: expect.stringContaining(message) }),
      );
    }
  });

  it("passes its signal to every port, and rejects with its reason when it aborts while a port hangs", async () => {
    const controller = new AbortController();
    const asked: Asked[] = [];
    const hanging = new Promise<never>(() => undefined);
    const { options } = serving("badges", {
      signal: controller.signal,
      authorize: bearerAuthorize(asked),
      credentials: { list: () => hanging, upsert: () => hanging },
    });
    const pending = handle(options, "GET", `${OB}/credentials`);
    await expect.poll(() => asked.length).toBe(1);
    expect(asked[0]?.signal).toBe(controller.signal);
    controller.abort(new Error("The client went away."));
    await expect(pending).rejects.toThrow("The client went away.");
    await expect(handle(options, "GET", `${OB}/profile`)).rejects.toThrow("The client went away.");
  });

  it("calls a store again for the same request, and a repeat of an upsert keeps the one credential", async () => {
    const { options, held, asked } = serving();
    const body = json(achievementCredential());
    const first = await handle(options, "POST", `${OB}/credentials`, { body, type: JSON_TYPE });
    const second = await handle(options, "POST", `${OB}/credentials`, { body, type: JSON_TYPE });
    expect([first.status, second.status]).toStrictEqual([201, 304]);
    expect(ports(asked).filter((port) => port === "upsert")).toHaveLength(2);
    expect(held.credentials.get("learner-1")).toHaveLength(1);
  });
});

describe("the arguments", () => {
  it("throws a DataError for a request that is not an HttpRequest", async () => {
    await expect(handleCredentialsRequest(JSON.parse("null"), serving().options)).rejects.toThrow(DataError);
    const textBody = { method: "GET", url: `${ORIGIN}${OB}/discovery`, headers: {}, body: "x" };
    await expect(handleCredentialsRequest(JSON.parse(JSON.stringify(textBody)), serving().options)).rejects.toThrow(
      DataError,
    );
  });

  it("names the option of another type, as JavaScript passes it", async () => {
    const { options } = serving();
    const cases: [unknown, string][] = [
      [null, "The provider options"],
      [{ ...options, api: "ob" }, "api"],
      [{ ...options, credentials: { list: () => undefined } }, "credentials"],
      [{ ...options, profiles: null }, "profiles"],
      [{ ...options, authorize: "yes" }, "authorize"],
      [{ ...options, serviceDescription: "https://example.org/sdd" }, "serviceDescription"],
      [{ ...options, basePath: "/tenant/" }, "basePath"],
      [{ ...options, pageSize: "100" }, "pageSize"],
      [{ ...options, maxPageSize: 0 }, "maxPageSize"],
      [{ ...options, maxBodyBytes: 1.5 }, "maxBodyBytes"],
      [{ ...options, maxTokens: -1 }, "maxTokens"],
      [{ ...options, verify: [] }, "verify"],
      [{ ...options, verify: { keys: {}, clock: { now: () => 0 } } }, "keys"],
      [{ ...options, signal: "abort" }, "signal"],
      [{ ...options, cache: true }, "cache"],
    ];
    for (const [value, named] of cases) {
      await expect(
        handleCredentialsRequest(request("GET", `${OB}/credentials`), value as never),
        named,
      ).rejects.toThrow(expect.objectContaining({ name: "DataError", message: expect.stringContaining(named) }));
    }
  });

  it("throws a DataError when the service description lacks what a client needs, as it serves it", async () => {
    const without = (change: (value: Record<string, unknown>) => void) => {
      const value = description();
      change(value);
      return serving("badges", { serviceDescription: value as never }).options;
    };
    const flow = (value: Record<string, unknown>) =>
      (
        value.components as {
          securitySchemes: { OAuth2ACG: { flows: { authorizationCode: Record<string, unknown> } } };
        }
      ).securitySchemes.OAuth2ACG.flows.authorizationCode;
    const cases: [CredentialsProviderOptions, string][] = [
      [serving("badges", { serviceDescription: description("clr") as never }).options, SCOPES.badges.getCredentials],
      [without((value) => delete (value.info as Record<string, unknown>).title), "title"],
      [without((value) => Object.assign(flow(value), { tokenUrl: "http://provider.example.com/token" })), "tokenUrl"],
      [without((value) => delete value.components), "components"],
    ];
    for (const [options, named] of cases) {
      await expect(handle(options, "GET", `${OB}/discovery`)).rejects.toThrow(
        expect.objectContaining({ name: "DataError", message: expect.stringContaining(named) }),
      );
    }
  });
});
