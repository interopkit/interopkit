// biome-ignore-all lint/style/useNamingConvention: the names of the properties of the service description are the specification's.

import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it, vi } from "vitest";
import {
  type CredentialsClientConfig,
  createCredentialsClient,
  discoverService,
  readStatusInfo,
} from "../src/client/index.js";
import { readAnswer, seenKeyOf } from "../src/client/internal.js";
import { readCredential } from "../src/index.js";
import { BASE, fakeServer, JWS, json, text } from "./fake-server.js";
import { achievementCredential, clrCredential, PROFILE } from "./fixtures.js";

const OB_SCOPES = ["credential.readonly", "credential.upsert", "profile.readonly", "profile.update"].map(
  (scope) => `https://purl.imsglobal.org/spec/ob/v3p0/scope/${scope}`,
);

/** The service description of OB 6.3, with the addresses made absolute. */
function description(overrides: Record<string, unknown> = {}) {
  return {
    openapi: "3.0.1",
    info: {
      title: "Example Provider",
      version: "1.0",
      termsOfService: "https://provider.example.com/terms",
      "x-imssf-image": "https://provider.example.com/logo.png",
      "x-imssf-privacyPolicyUrl": "https://provider.example.com/privacy",
    },
    components: {
      securitySchemes: {
        OAuth2ACG: {
          type: "oauth2",
          "x-imssf-registrationUrl": "https://provider.example.com/registration",
          flows: {
            authorizationCode: {
              authorizationUrl: "https://provider.example.com/authorize",
              tokenUrl: "https://provider.example.com/token",
              refreshUrl: "https://provider.example.com/token",
              scopes: Object.fromEntries(OB_SCOPES.map((scope) => [scope, "..."])),
            },
          },
        },
      },
    },
    ...overrides,
  };
}

/** Runs a call and returns what it rejects with. */
async function rejection(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("The call resolved.");
}

/** Reads an iteration to its end. */
async function all<TValue>(iterable: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

const credential = (id: number) => ({ ...achievementCredential(), id: `https://example.edu/credentials/${id}` });

function clientOf(fetch: CredentialsClientConfig["fetch"], more: Partial<CredentialsClientConfig> = {}) {
  return createCredentialsClient({ api: "badges", baseUrl: BASE, fetch, token: async () => "tk-1", ...more });
}

describe("discoverService", () => {
  it("reads the endpoints, the scopes and the policies from the service description", async () => {
    const { fetch, requests } = fakeServer(() => json(description()));
    const found = await discoverService(BASE, "badges", { fetch });
    expect(found).toStrictEqual({
      title: "Example Provider",
      tokenUrl: "https://provider.example.com/token",
      authorizationUrl: "https://provider.example.com/authorize",
      registrationUrl: "https://provider.example.com/registration",
      scopes: OB_SCOPES,
      privacyPolicyUrl: "https://provider.example.com/privacy",
      refreshUrl: "https://provider.example.com/token",
      termsOfServiceUrl: "https://provider.example.com/terms",
      image: "https://provider.example.com/logo.png",
    });
    expect(requests).toStrictEqual([
      { url: `${BASE}/ims/ob/v3p0/discovery`, method: "GET", headers: { accept: "application/json" }, body: "" },
    ]);
  });

  it("asks the discovery endpoint of the CLR API, below the path of the base, without a credential", async () => {
    const { fetch, requests } = fakeServer(() => json(description()));
    await discoverService("https://example.org/tenant/", "clr", { fetch });
    expect(requests[0]?.url).toBe("https://example.org/tenant/ims/clr/v2p0/discovery");
    expect(requests[0]?.headers).toStrictEqual({ accept: "application/json" });
  });

  it("leaves out what the server does not give", async () => {
    const minimal = description();
    delete (minimal.info as Record<string, unknown>).termsOfService;
    delete (minimal.info as Record<string, unknown>)["x-imssf-image"];
    delete (minimal.components.securitySchemes.OAuth2ACG.flows.authorizationCode as Record<string, unknown>).refreshUrl;
    const found = await discoverService(BASE, "badges", { fetch: fakeServer(() => json(minimal)).fetch });
    expect(Object.keys(found).sort()).toStrictEqual([
      "authorizationUrl",
      "privacyPolicyUrl",
      "registrationUrl",
      "scopes",
      "title",
      "tokenUrl",
    ]);
  });

  it.each([
    ["has no authorization code flow", { components: { securitySchemes: {} } }],
    [
      "has an address that is not https",
      { info: { ...description().info, "x-imssf-privacyPolicyUrl": "provider.example.com/privacy" } },
    ],
    ["has no title", { info: { ...description().info, title: "" } }],
  ])("refuses a description that %s", async (_name, overrides) => {
    const error = await rejection(
      discoverService(BASE, "badges", { fetch: fakeServer(() => json(description(overrides))).fetch }),
    );
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain(`The service description at ${BASE}/ims/ob/v3p0/discovery`);
  });

  it("refuses an answer that is not JSON, nests too deep or is not UTF-8", async () => {
    for (const answer of [text("not json"), text("[".repeat(100)), new Response(Uint8Array.of(0xff, 0xfe))]) {
      expect(
        await rejection(discoverService(BASE, "badges", { fetch: fakeServer(() => answer.clone()).fetch })),
      ).toBeInstanceOf(DataError);
    }
  });

  it("refuses an answer that nests more levels of JSON than the readers take, before it parses it", async () => {
    const deep = text(`${"[".repeat(100)}${"]".repeat(100)}`);
    const error = await rejection(discoverService(BASE, "badges", { fetch: fakeServer(() => deep.clone()).fetch }));
    expect((error as DataError).message).toContain("nests more than 64 levels");
    const listing = await rejection(all(clientOf(fakeServer(() => deep.clone()).fetch).listCredentials()));
    expect((listing as DataError).message).toContain("nests more than 64 levels");
  });

  it("is a ServiceError for another status, a redirect, an answer that is too large and a server that does not answer", async () => {
    const statuses = [text("", 404), text("", 301, { location: "https://elsewhere.example" })];
    for (const answer of statuses) {
      const error = await rejection(discoverService(BASE, "badges", { fetch: fakeServer(() => answer.clone()).fetch }));
      expect(error).toBeInstanceOf(ServiceError);
    }
    const large = await rejection(
      discoverService(BASE, "badges", { fetch: fakeServer(() => text(" ".repeat(1_048_577))).fetch }),
    );
    expect(large).toBeInstanceOf(ServiceError);
    expect((large as ServiceError).message).toContain("1048576");
    const silent = await rejection(
      discoverService(BASE, "badges", { fetch: () => new Promise<Response>(() => undefined), timeoutMs: 20 }),
    );
    expect((silent as ServiceError).status).toBe(0);
  });

  it("rejects with the reason of a signal that aborts", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const error = await rejection(
      discoverService(BASE, "badges", {
        fetch: fakeServer(() => json(description())).fetch,
        signal: controller.signal,
      }),
    );
    expect((error as Error).message).toBe("stop");
  });

  it("refuses arguments of other types", async () => {
    const { fetch } = fakeServer(() => json(description()));
    const calls: [unknown, unknown, unknown][] = [
      [BASE, "badges", null],
      [BASE, "badges", {}],
      [BASE, "badges", { fetch: "fetch" }],
      [BASE, "badges", { fetch, timeoutMs: "1" }],
      [BASE, "badges", { fetch, more: 1 }],
      [BASE, "oauth", { fetch }],
      [BASE, 1, { fetch }],
      [null, "badges", { fetch }],
      ["http://badges.example.org", "badges", { fetch }],
      [`${BASE}/ims/ob/v3p0`, "badges", { fetch }],
      [`${BASE}?a=1`, "badges", { fetch }],
      [`https://user:pass@badges.example.org`, "badges", { fetch }],
    ];
    for (const [baseUrl, api, options] of calls) {
      const error = await rejection(discoverService(baseUrl as never, api as never, options as never));
      expect(error).toBeInstanceOf(DataError);
    }
  });
});

describe("createCredentialsClient", () => {
  it("refuses a configuration that is not valid, before any request", () => {
    const base = { api: "badges", baseUrl: BASE, fetch: fakeServer(() => json({})).fetch, token: async () => "t" };
    const configs: unknown[] = [
      null,
      [],
      {},
      { ...base, api: "oauth" },
      { ...base, baseUrl: "http://badges.example.org" },
      { ...base, baseUrl: `${BASE}/ims/clr/v2p0/` },
      { ...base, baseUrl: `${BASE}#a` },
      { ...base, fetch: 1 },
      { ...base, token: "t" },
      { ...base, timeoutMs: 0 },
      { ...base, maxBytes: "1" },
      { ...base, maxTokens: 0 },
      { ...base, pageSize: 1.5 },
      { ...base, signal: {} },
      { ...base, more: 1 },
    ];
    for (const config of configs) {
      expect(() => createCredentialsClient(config as never)).toThrow(DataError);
    }
  });

  it("sends a bearer token that the host's function returns before each request", async () => {
    const tokens = ["tk-1", "tk-2"];
    const { fetch, requests } = fakeServer(() => json(PROFILE));
    const client = clientOf(fetch, { token: async () => tokens.shift() ?? "tk-3" });
    await client.getProfile();
    await client.getProfile();
    expect(requests.map((seen) => seen.headers.authorization)).toStrictEqual(["Bearer tk-1", "Bearer tk-2"]);
  });

  it("passes the signal of the call to the token function, and makes no request when it rejects or returns a bad token", async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const { fetch, requests } = fakeServer(() => json(PROFILE));
    const controller = new AbortController();
    const client = clientOf(fetch, {
      token: async (options) => {
        seen.push(options?.signal);
        return "tk-1";
      },
    });
    await client.getProfile();
    await client.getProfile({ signal: controller.signal });
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeInstanceOf(AbortSignal);
    for (const token of ["", "a b", "a\r\nX: y", 1, null]) {
      const bad = clientOf(fetch, { token: async () => token as never });
      expect(await rejection(bad.getProfile())).toBeInstanceOf(DataError);
    }
    const failing = clientOf(fetch, { token: () => Promise.reject(new Error("no token")) });
    expect((await rejection(failing.getProfile())) as Error).toHaveProperty("message", "no token");
    expect(requests).toHaveLength(2);
  });

  it("ends the wait of the call when it aborts, though the token function never answers and ignores the signal", async () => {
    const { fetch, requests } = fakeServer(() => json(PROFILE));
    const never = () => new Promise<string>(() => undefined);
    const call = new AbortController();
    const pending = rejection(clientOf(fetch, { token: never }).getProfile({ signal: call.signal }));
    call.abort(new Error("the caller stopped"));
    expect(await pending).toStrictEqual(new Error("the caller stopped"));
    const configured = new AbortController();
    const stopped = rejection(clientOf(fetch, { signal: configured.signal, token: never }).getProfile());
    configured.abort(new Error("the host stopped"));
    expect(await stopped).toStrictEqual(new Error("the host stopped"));
    expect(requests).toHaveLength(0);
  });
});

describe("listCredentials", () => {
  it("lists the credentials and the compact JWS of every page, with the limit, the offset and the token", async () => {
    const pages = [
      { credential: [credential(1), credential(2)], compactJwsString: [JWS] },
      { credential: [credential(3)] },
    ];
    const { fetch, requests } = fakeServer(({ url }) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return json(offset === 0 ? pages[0] : pages[1], 200, { "x-total-count": "4" });
    });
    const client = clientOf(fetch, { pageSize: 3 });
    const listed = await all(client.listCredentials());
    expect(listed).toStrictEqual([credential(1), credential(2), JWS, credential(3)]);
    expect(requests.map((seen) => seen.url)).toStrictEqual([
      `${BASE}/ims/ob/v3p0/credentials?limit=3&offset=0`,
      `${BASE}/ims/ob/v3p0/credentials?limit=3&offset=3`,
    ]);
    expect(requests[0]?.headers).toStrictEqual({ accept: "application/json", authorization: "Bearer tk-1" });
    expect(requests[0]?.method).toBe("GET");
  });

  it("asks the CLR API for ClrCredentials", async () => {
    const { fetch, requests } = fakeServer(() =>
      json({ credential: [clrCredential()] }, 200, { "x-total-count": "1" }),
    );
    const client = createCredentialsClient({ api: "clr", baseUrl: BASE, fetch, token: async () => "t" });
    expect(await all(client.listCredentials())).toStrictEqual([clrCredential()]);
    expect(requests[0]?.url).toBe(`${BASE}/ims/clr/v2p0/credentials?limit=100&offset=0`);
  });

  it("asks only for the credentials issued since a time, with the time percent-encoded", async () => {
    const { fetch, requests } = fakeServer(() => json({ credential: [credential(1)] }, 200, { "x-total-count": "1" }));
    await all(clientOf(fetch).listCredentials({ since: "2024-06-13T18:46:03+02:00" }));
    expect(requests[0]?.url).toBe(
      `${BASE}/ims/ob/v3p0/credentials?limit=100&offset=0&since=2024-06-13T18%3A46%3A03%2B02%3A00`,
    );
  });

  it("stops where the server says that no page follows: the total, the Link header, or a short page", async () => {
    const page = (headers: Record<string, string>, count: number) =>
      fakeServer(({ url }) => {
        const offset = Number(new URL(url).searchParams.get("offset"));
        const items = Array.from({ length: count }, (_, at) => credential(offset + at + 1));
        return json({ credential: offset >= 4 ? [] : items }, 200, headers);
      });
    // The total: two pages of two, and the third request is not made.
    const byTotal = page({ "x-total-count": "4" }, 2);
    expect(await all(clientOf(byTotal.fetch, { pageSize: 2 }).listCredentials())).toHaveLength(4);
    expect(byTotal.requests).toHaveLength(2);
    // The Link header: a `next` relation continues, and a header without one stops.
    const linked = page({ link: `<${BASE}/next>; rel="next", <${BASE}/last>; rel="last"` }, 2);
    expect(await all(clientOf(linked.fetch, { pageSize: 2 }).listCredentials())).toHaveLength(4);
    expect(linked.requests).toHaveLength(3);
    const lastPage = page({ link: `<${BASE}/first>; rel=first` }, 2);
    expect(await all(clientOf(lastPage.fetch, { pageSize: 2 }).listCredentials())).toHaveLength(2);
    // Neither header: a page shorter than the limit is the last, and a full page asks for the next.
    const short = page({}, 1);
    expect(await all(clientOf(short.fetch, { pageSize: 2 }).listCredentials())).toHaveLength(1);
    const full = page({}, 2);
    expect(await all(clientOf(full.fetch, { pageSize: 2 }).listCredentials())).toHaveLength(4);
    expect(full.requests).toHaveLength(3);
  });

  it("gives a credential once when pages repeat it, and stops at a page it has seen whole", async () => {
    // A server that ignores the offset would be asked for ever without the rule that ends the iteration, so it gives up.
    let calls = 0;
    const repeating = fakeServer(() => {
      calls += 1;
      if (calls > 20) return json({}, 500);
      return json({ credential: [credential(1), credential(2)], compactJwsString: [JWS] }, 200, {
        link: `<${BASE}/next>; rel="next"`,
      });
    });
    expect(await all(clientOf(repeating.fetch).listCredentials())).toStrictEqual([credential(1), credential(2), JWS]);
    expect(repeating.requests).toHaveLength(2);
    let call = 0;
    const overlapping = fakeServer(() => {
      call += 1;
      const items = call === 1 ? [credential(1), credential(2)] : call === 2 ? [credential(2), credential(3)] : [];
      return json({ credential: items }, 200, { link: `<${BASE}/next>; rel="next"` });
    });
    expect(
      (await all(clientOf(overlapping.fetch).listCredentials())).map((each) => (each as { id: string }).id),
    ).toStrictEqual([
      "https://example.edu/credentials/1",
      "https://example.edu/credentials/2",
      "https://example.edu/credentials/3",
    ]);
  });

  it("keeps a key of the same size for each credential that it has given, whatever the size of the credential", async () => {
    const long = `${JWS.slice(0, JWS.lastIndexOf("."))}.${"A".repeat(100_000)}`;
    const read = (index: number, more: object = {}) =>
      readCredential({ ...credential(index), ...more }, { kind: "AchievementCredential" });
    const keys = await Promise.all([JWS, long, read(1), read(2)].map(seenKeyOf));
    expect(keys.map((key) => key.length)).toStrictEqual([32, 32, 32, 32]);
    expect(new Set(keys).size).toBe(4);
    expect(await seenKeyOf(read(1))).toBe(await seenKeyOf(read(1, { name: "Another name" })));
  });

  it("refuses a page of more credentials than the request asked for, before it reads any of them", async () => {
    const three = fakeServer(() => json({ credential: [credential(1), credential(2)], compactJwsString: [JWS] }));
    const error = await rejection(all(clientOf(three.fetch, { pageSize: 2 }).listCredentials()));
    expect((error as DataError).message).toContain(
      "answered with 3 credentials, more than the 2 that the request asked for",
    );
    const invalid = fakeServer(() => json({ credential: [{}, {}, {}] }));
    expect(
      (await rejection(all(clientOf(invalid.fetch, { pageSize: 2 }).listCredentials()))) as DataError,
    ).toHaveProperty("message", expect.stringContaining("more than the 2"));
  });

  it("refuses a page and a profile with more tokens of JSON than maxTokens before it parses them", async () => {
    const hostile = `[${"[],".repeat(400_000)}[]]`;
    const refusal = "more than 1000000 tokens of JSON, above the limit of the option maxTokens";
    const parse = vi.spyOn(JSON, "parse");
    try {
      const page = fakeServer(() => text(`{"credential":${hostile}}`));
      expect(((await rejection(all(clientOf(page.fetch).listCredentials()))) as DataError).message).toContain(refusal);
      const profile = fakeServer(() => text(`{"name":${hostile}}`));
      expect(((await rejection(clientOf(profile.fetch).getProfile())) as DataError).message).toContain(refusal);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("reads a long credential and a long profile that stay within the limits of tokens and bytes: no limit of characters", async () => {
    const big = "x".repeat(2_000_000);
    const credentials = fakeServer(() => json({ credential: [{ ...credential(1), name: big }] }));
    const [read] = await all(clientOf(credentials.fetch).listCredentials());
    expect(read).toMatchObject({ name: big });
    const profile = fakeServer(() => json({ ...PROFILE, name: big }));
    expect(await clientOf(profile.fetch).getProfile()).toMatchObject({ name: big });
    const signed = fakeServer(() => json({ compactJwsString: [`a.${big}.c`] }));
    expect(await all(clientOf(signed.fetch).listCredentials())).toStrictEqual([`a.${big}.c`]);
    const limited = fakeServer(() => json({ ...PROFILE, name: big }));
    expect(await rejection(clientOf(limited.fetch, { maxBytes: 1_000_000 }).getProfile())).toBeInstanceOf(ServiceError);
  });

  it("gives nothing for an empty page", async () => {
    expect(await all(clientOf(fakeServer(() => json({})).fetch).listCredentials())).toStrictEqual([]);
  });

  it("reads every credential of a page, and says whose answer was wrong", async () => {
    const wrong = fakeServer(() => json({ credential: [{ ...credential(1), type: ["VerifiableCredential"] }] }));
    const error = await rejection(all(clientOf(wrong.fetch).listCredentials()));
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toMatch(
      /^The Open Badges API at https:\/\/badges\.example\.org\/ims\/ob\/v3p0\/credentials\?limit=100&offset=0 answered with data that is not valid Open Badges: /u,
    );
    for (const answer of [
      text("not json"),
      text("[".repeat(100)),
      json([]),
      json({ credential: "x" }),
      new Response(Uint8Array.of(0xff)),
    ]) {
      expect(await rejection(all(clientOf(fakeServer(() => answer.clone()).fetch).listCredentials()))).toBeInstanceOf(
        DataError,
      );
    }
  });

  it("is a ServiceError for a refusal, with the status, the headers and the body that readStatusInfo reads", async () => {
    const status = { imsx_codeMajor: "failure", imsx_severity: "error", imsx_description: "slow down" };
    const { fetch } = fakeServer(() => json(status, 429, { "retry-after": "120" }));
    const error = await rejection(all(clientOf(fetch).listCredentials()));
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).status).toBe(429);
    expect(readStatusInfo(error as ServiceError)).toStrictEqual({ info: status, retryAfterSeconds: 120 });
  });

  it("refuses options that are not valid before any request", async () => {
    const { fetch, requests } = fakeServer(() => json({}));
    const client = clientOf(fetch);
    for (const options of [null, 1, [], { since: "2024-06-13" }, { since: 1 }, { signal: {} }, { limit: 5 }]) {
      expect(() => client.listCredentials(options as never)).toThrow(DataError);
    }
    expect(requests).toHaveLength(0);
  });

  it("ends the iteration with the reason of a signal that aborts", async () => {
    const controller = new AbortController();
    const { fetch } = fakeServer(() => {
      controller.abort(new Error("stop"));
      return json({ credential: [credential(1)] }, 200, { link: `<${BASE}/next>; rel="next"` });
    });
    const error = await rejection(all(clientOf(fetch).listCredentials({ signal: controller.signal })));
    expect((error as Error).message).toBe("stop");
  });

  it("stops asking for pages when the host stops reading", async () => {
    const { fetch, requests } = fakeServer(() =>
      json({ credential: [credential(1)] }, 200, { link: `<${BASE}/next>; rel="next"` }),
    );
    for await (const _ of clientOf(fetch).listCredentials()) break;
    expect(requests).toHaveLength(1);
  });
});

describe("upsertCredential", () => {
  it.each([
    [201, "created"],
    [200, "replaced"],
  ] as const)("says that a status of %s means %s", async (status, outcome) => {
    const { fetch, requests } = fakeServer(() => json(credential(1), status));
    expect(await clientOf(fetch).upsertCredential(credential(1))).toBe(outcome);
    expect(requests[0]).toStrictEqual({
      url: `${BASE}/ims/ob/v3p0/credentials`,
      method: "POST",
      headers: {
        accept: "application/vc+ld+json, application/json",
        authorization: "Bearer tk-1",
        "content-type": "application/json",
      },
      body: JSON.stringify(credential(1)),
    });
  });

  it("says that the server holds the credential already when it answers 304", async () => {
    const { fetch } = fakeServer(() => new Response(null, { status: 304 }));
    expect(await clientOf(fetch).upsertCredential(credential(1))).toBe("unchanged");
  });

  it("sends a compact JWS as text and answers a JWS", async () => {
    const { fetch, requests } = fakeServer(() => text(JWS, 201));
    expect(await clientOf(fetch).upsertCredential(JWS)).toBe("created");
    expect(requests[0]?.headers).toStrictEqual({
      accept: "text/plain",
      authorization: "Bearer tk-1",
      "content-type": "text/plain",
    });
    expect(requests[0]?.body).toBe(JWS);
  });

  it("posts a CLR to the CLR API and refuses a credential of the other kind", async () => {
    const { fetch, requests } = fakeServer(() => json(clrCredential(), 201));
    const clr = createCredentialsClient({ api: "clr", baseUrl: BASE, fetch, token: async () => "t" });
    expect(await clr.upsertCredential(clrCredential())).toBe("created");
    expect(requests[0]?.url).toBe(`${BASE}/ims/clr/v2p0/credentials`);
    expect(await rejection(clr.upsertCredential(credential(1)))).toBeInstanceOf(DataError);
    expect(await rejection(clientOf(fetch).upsertCredential(clrCredential()))).toBeInstanceOf(DataError);
    expect(requests).toHaveLength(1);
  });

  it("refuses a credential that is not valid before any request", async () => {
    const { fetch, requests } = fakeServer(() => json({}, 201));
    const client = clientOf(fetch);
    let deep: Record<string, unknown> = {};
    for (let level = 0; level < 100; level += 1) deep = { deep };
    for (const bad of [
      null,
      1,
      [],
      {},
      "text",
      "a.b",
      { ...credential(1), id: 1 },
      { ...credential(1), deep },
      { ...credential(1), count: 1n },
    ]) {
      expect(await rejection(client.upsertCredential(bad as never))).toBeInstanceOf(DataError);
    }
    expect(await rejection(client.upsertCredential(credential(1), null as never))).toBeInstanceOf(DataError);
    expect(requests).toHaveLength(0);
  });

  it("is a ServiceError for another status", async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      const { fetch } = fakeServer(() => json({ imsx_codeMajor: "failure", imsx_severity: "error" }, status));
      const error = await rejection(clientOf(fetch).upsertCredential(credential(1)));
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).status).toBe(status);
    }
    const redirect = fakeServer(() => text("", 302, { location: "https://elsewhere.example/" }));
    expect(((await rejection(clientOf(redirect.fetch).upsertCredential(credential(1)))) as ServiceError).status).toBe(
      302,
    );
  });
});

describe("the profile", () => {
  it("is fetched, and undefined when the server holds none", async () => {
    const found = fakeServer(() => json({ ...PROFILE, name: "Example University" }));
    expect(await clientOf(found.fetch).getProfile()).toStrictEqual({ ...PROFILE, name: "Example University" });
    expect(found.requests[0]).toStrictEqual({
      url: `${BASE}/ims/ob/v3p0/profile`,
      method: "GET",
      headers: { accept: "application/json", authorization: "Bearer tk-1" },
      body: "",
    });
    expect(await clientOf(fakeServer(() => json({}, 404)).fetch).getProfile()).toBeUndefined();
  });

  it("is replaced with the whole profile, and the answer is the profile that the server holds", async () => {
    const { fetch, requests } = fakeServer(() => json({ ...PROFILE, name: "Held" }));
    expect(await clientOf(fetch).putProfile({ ...PROFILE, name: "Sent" })).toStrictEqual({ ...PROFILE, name: "Held" });
    expect(requests[0]).toStrictEqual({
      url: `${BASE}/ims/ob/v3p0/profile`,
      method: "PUT",
      headers: { accept: "application/json", authorization: "Bearer tk-1", "content-type": "application/json" },
      body: JSON.stringify({ ...PROFILE, name: "Sent" }),
    });
  });

  it("is a ServiceError when the server accepts the profile and has not applied it, or answers another status", async () => {
    for (const status of [202, 304, 400, 404]) {
      const { fetch } = fakeServer(() =>
        status === 304
          ? new Response(null, { status })
          : json({ imsx_codeMajor: "success", imsx_severity: "status" }, status),
      );
      const error = await rejection(clientOf(fetch).putProfile(PROFILE));
      expect((error as ServiceError).status).toBe(status);
    }
  });

  it("refuses a profile that is not JSON before any request", async () => {
    const { fetch, requests } = fakeServer(() => json(PROFILE));
    expect(await rejection(clientOf(fetch).putProfile({ ...PROFILE, count: 1n } as never))).toBeInstanceOf(DataError);
    expect(requests).toHaveLength(0);
  });

  it("refuses a profile that is not valid before any request, and an answer that is not a profile", async () => {
    const { fetch, requests } = fakeServer(() => json({ id: 1 }));
    const client = clientOf(fetch);
    for (const bad of [null, 1, {}, { ...PROFILE, id: 1 }]) {
      expect(await rejection(client.putProfile(bad as never))).toBeInstanceOf(DataError);
    }
    expect(requests).toHaveLength(0);
    expect(await rejection(client.getProfile())).toBeInstanceOf(DataError);
    expect(await rejection(client.putProfile(PROFILE))).toBeInstanceOf(DataError);
  });
});

describe("every call", () => {
  it("is a ServiceError of status 0 when the server does not answer within timeoutMs", async () => {
    const client = clientOf(() => new Promise<Response>(() => undefined), { timeoutMs: 20 });
    expect(((await rejection(client.getProfile())) as ServiceError).status).toBe(0);
    expect(((await rejection(client.upsertCredential(credential(1)))) as ServiceError).status).toBe(0);
  });

  it("is a ServiceError that names the limit when an answer has more bytes than maxBytes", async () => {
    const client = clientOf(fakeServer(() => json({ ...PROFILE, name: "x".repeat(200) })).fetch, { maxBytes: 100 });
    const error = await rejection(client.getProfile());
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).message).toContain("100 bytes");
  });

  it("is a DataError that names the limit when an answer has more tokens of JSON than maxTokens, counted before it is parsed", async () => {
    const hostile = clientOf(fakeServer(() => text(`[${"[],".repeat(400_000)}[]]`)).fetch);
    const error = await rejection(hostile.getProfile());
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message).toContain(
      "more than 1000000 tokens of JSON, above the limit of the option maxTokens",
    );
    const unfinished = clientOf(fakeServer(() => text("[1,2,3,4,5,6,7,8,9,10,11,12,")).fetch, { maxTokens: 10 });
    expect(((await rejection(unfinished.getProfile())) as DataError).message).toContain("more than 10 tokens of JSON");
    const exact = clientOf(fakeServer(() => json(PROFILE)).fetch, { maxTokens: 1000 });
    expect(await exact.getProfile()).toStrictEqual(PROFILE);
  });

  it("does not parse the body of a refusal that has more tokens than a status can have", () => {
    const body = `[${"[],".repeat(400_000)}[]]`;
    const parse = vi.spyOn(JSON, "parse");
    try {
      expect(readStatusInfo(new ServiceError("refused", 400, body))).toStrictEqual({});
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });

  it("rejects with the reason of the signal of the configuration or of the call", async () => {
    const { fetch, requests } = fakeServer(() => json(PROFILE));
    const configured = new AbortController();
    configured.abort(new Error("configured"));
    expect(((await rejection(clientOf(fetch, { signal: configured.signal }).getProfile())) as Error).message).toBe(
      "configured",
    );
    const called = new AbortController();
    called.abort(new Error("called"));
    expect(((await rejection(clientOf(fetch).getProfile({ signal: called.signal }))) as Error).message).toBe("called");
    expect(await rejection(clientOf(fetch).getProfile({ signal: {} } as never))).toBeInstanceOf(DataError);
    expect(requests).toHaveLength(0);
  });

  it("asks for the credentials of the base when it has a path or a trailing slash", async () => {
    const { fetch, requests } = fakeServer(() => json(PROFILE));
    await clientOf(fetch, { baseUrl: "https://example.org/tenant//" }).getProfile();
    expect(requests[0]?.url).toBe("https://example.org/tenant/ims/ob/v3p0/profile");
  });
});

describe("readStatusInfo", () => {
  const status = { imsx_codeMajor: "failure", imsx_severity: "error", imsx_description: "no" };

  it("reads the status in the body and the seconds of Retry-After", () => {
    const error = new ServiceError("refused", 503, JSON.stringify(status), { headers: { "retry-after": " 30 " } });
    expect(readStatusInfo(error)).toStrictEqual({ info: status, retryAfterSeconds: 30 });
  });

  it("leaves out what the answer does not give: a body that is not a status, and a date for Retry-After", () => {
    const html = new ServiceError("refused", 502, "<html>Bad gateway</html>", {
      headers: { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
    });
    expect(readStatusInfo(html)).toStrictEqual({});
    expect(readStatusInfo(new ServiceError("refused", 400, JSON.stringify({ imsx_codeMajor: 1 })))).toStrictEqual({});
    expect(
      readStatusInfo(new ServiceError("refused", 400, "", { headers: { "retry-after": "1".repeat(16) } })),
    ).toStrictEqual({});
  });

  it("refuses what is not a ServiceError", () => {
    for (const error of [null, new Error("x"), "x", {}]) {
      expect(() => readStatusInfo(error as never)).toThrow(DataError);
    }
  });
});

describe("the wrapper of the readers of an answer", () => {
  it("names the answer that was wrong, whatever a reader throws", () => {
    const settings = { api: "clr" } as never;
    expect(() =>
      readAnswer(settings, "The CLR API at a", () => {
        throw new DataError("bad");
      }),
    ).toThrow("The CLR API at a answered with data that is not valid CLR: bad");
    expect(() =>
      readAnswer(settings, "The CLR API at a", () => {
        throw "plain text";
      }),
    ).toThrow("The CLR API at a answered with data that is not valid CLR: plain text");
    expect(readAnswer(settings, "x", () => 5)).toBe(5);
  });
});
