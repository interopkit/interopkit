// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 parameters and responses are snake_case.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DataError, ServiceError } from "../src/index.js";
import { authorizationRequest, exchangeCode, type PendingAuthorization } from "../src/oauth/index.js";
import { callOptions, failureOf, fakeServer, json, NOW, SECRET_CLIENT, SERVER, TOKEN_URL } from "./oauth-fixtures.js";

const REDIRECT_URI = "https://client.example/callback?tenant=a";
const RESPONSE = { access_token: "at-1", token_type: "Bearer", expires_in: 600, refresh_token: "rt-1" };
/** RFC 7636 section 4.1: the verifier is 43 to 128 characters from the unreserved set. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/u;

/** The S256 challenge of a verifier (RFC 7636 section 4.2), which node:crypto computes independently. */
const challengeOf = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/** Starts a flow, and returns what it gives with the parameters of its address. */
async function start(scopes: readonly string[] = ["read", "write"]) {
  const pending = await authorizationRequest(SERVER, SECRET_CLIENT, { redirectUri: REDIRECT_URI, scopes });
  return { pending, query: new URL(pending.url).searchParams };
}

/** The address that the server sends the browser back to. */
const callback = (parameters: Record<string, string>): string =>
  `${REDIRECT_URI.split("?")[0]}?${new URLSearchParams(parameters)}`;

describe("authorizationRequest", () => {
  it("builds the address of the authorization endpoint with the parameters of the code flow and PKCE S256", async () => {
    const { pending, query } = await start();
    expect(new URL(pending.url).origin + new URL(pending.url).pathname).toBe(SERVER.authorizationEndpoint);
    expect(Object.fromEntries(query)).toStrictEqual({
      response_type: "code",
      client_id: "app 1",
      redirect_uri: REDIRECT_URI,
      scope: "read write",
      state: pending.state,
      code_challenge: challengeOf(pending.codeVerifier),
      code_challenge_method: "S256",
    });
    expect(pending.redirectUri).toBe(REDIRECT_URI);
  });

  it("makes a verifier that RFC 7636 allows, and a new state and verifier for every request", async () => {
    const flows = await Promise.all(Array.from({ length: 20 }, () => start()));
    for (const { pending } of flows) {
      expect(pending.codeVerifier).toMatch(VERIFIER);
      expect(pending.state.length).toBeGreaterThanOrEqual(16);
    }
    expect(new Set(flows.map(({ pending }) => pending.state)).size).toBe(20);
    expect(new Set(flows.map(({ pending }) => pending.codeVerifier)).size).toBe(20);
  });

  it("keeps the query that the endpoint has, and leaves the scope out when none is asked for", async () => {
    const server = { ...SERVER, authorizationEndpoint: "https://as.example/authorize?tenant=a" };
    const pending = await authorizationRequest(server, SECRET_CLIENT, { redirectUri: REDIRECT_URI, scopes: [] });
    const query = new URL(pending.url).searchParams;
    expect(query.get("tenant")).toBe("a");
    expect(query.has("scope")).toBe(false);
  });

  it("refuses arguments of other types", async () => {
    const cases: readonly [string, () => Promise<unknown>][] = [
      [
        "The authorization server must have a authorizationEndpoint for this call, found none.",
        () =>
          authorizationRequest({ tokenEndpoint: TOKEN_URL }, SECRET_CLIENT, { redirectUri: REDIRECT_URI, scopes: [] }),
      ],
      [
        "The authorization request must be an object, found null.",
        () => authorizationRequest(SERVER, SECRET_CLIENT, JSON.parse("null")),
      ],
      [
        'The redirectUri of the authorization request must be an absolute URL, found "/callback".',
        () => authorizationRequest(SERVER, SECRET_CLIENT, { redirectUri: "/callback", scopes: [] }),
      ],
      [
        "The redirectUri of the authorization request must be an absolute URL, found undefined.",
        () => authorizationRequest(SERVER, SECRET_CLIENT, JSON.parse('{"scopes":[]}')),
      ],
      [
        "The scopes must be an array, found undefined.",
        () => authorizationRequest(SERVER, SECRET_CLIENT, JSON.parse('{"redirectUri":"https://c.example/cb"}')),
      ],
      [
        "The client must be an object, found null.",
        () => authorizationRequest(SERVER, JSON.parse("null"), { redirectUri: REDIRECT_URI, scopes: [] }),
      ],
    ];
    for (const [message, call] of cases) expect(await failureOf(call()), message).toStrictEqual(new DataError(message));
  });
});

describe("exchangeCode", () => {
  /** A server that checks the token request as RFC 6749 section 4.1.3 and RFC 7636 section 4.6 say. */
  const authorizationServer = (pending: PendingAuthorization, extra: Record<string, unknown> = {}) =>
    fakeServer((seen) => {
      expect(seen.url).toBe(TOKEN_URL);
      expect(seen.headers.authorization).toMatch(/^Basic /u);
      expect(seen.form.get("grant_type")).toBe("authorization_code");
      expect(seen.form.get("code")).toBe("code-1");
      expect(seen.form.get("redirect_uri")).toBe(REDIRECT_URI);
      const verifier = seen.form.get("code_verifier") ?? "";
      expect(verifier).toBe(pending.codeVerifier);
      expect(challengeOf(verifier)).toBe(new URL(pending.url).searchParams.get("code_challenge"));
      return json({ ...RESPONSE, ...extra });
    });

  it("checks the callback and exchanges the code, with the redirect URI and the verifier of the request", async () => {
    const { pending } = await start();
    const server = authorizationServer(pending);
    const token = await exchangeCode(
      SERVER,
      SECRET_CLIENT,
      callback({ code: "code-1", state: pending.state }),
      pending,
      callOptions(server.fetch),
    );
    expect(token).toStrictEqual({
      accessToken: "at-1",
      expiresAt: NOW + 600_000,
      refreshToken: "rt-1",
      scopes: ["read", "write"],
    });
    expect(server.requests).toHaveLength(1);
  });

  it("gives the scopes that the server names, and the scopes of the request when it names none", async () => {
    const { pending } = await start(["a", "b"]);
    const named = authorizationServer(pending, { scope: "a" });
    const callbackUrl = callback({ code: "code-1", state: pending.state });
    expect(
      (await exchangeCode(SERVER, SECRET_CLIENT, callbackUrl, pending, callOptions(named.fetch))).scopes,
    ).toStrictEqual(["a"]);
    const unnamed = authorizationServer(pending);
    expect(
      (await exchangeCode(SERVER, SECRET_CLIENT, callbackUrl, pending, callOptions(unnamed.fetch))).scopes,
    ).toStrictEqual(["a", "b"]);
  });

  it("refuses a callback with another state or none, before any request, as one that does not answer the request", async () => {
    const { pending } = await start();
    const server = authorizationServer(pending);
    const wrong = await failureOf(
      exchangeCode(
        SERVER,
        SECRET_CLIENT,
        callback({ code: "code-1", state: "other" }),
        pending,
        callOptions(server.fetch),
      ),
    );
    expect(wrong).toStrictEqual(
      new DataError(
        'The callback does not answer the authorization request: unexpected "state" response parameter value.',
      ),
    );
    const missing = await failureOf(
      exchangeCode(SERVER, SECRET_CLIENT, callback({ code: "code-1" }), pending, callOptions(server.fetch)),
    );
    expect(missing).toStrictEqual(
      new DataError('The callback does not answer the authorization request: response parameter "state" missing.'),
    );
    expect(server.requests).toHaveLength(0);
  });

  it("refuses a callback with no code, before any request", async () => {
    const { pending } = await start();
    const server = authorizationServer(pending);
    const missing: readonly Record<string, string>[] = [{ state: pending.state }, { state: pending.state, code: "" }];
    for (const parameters of missing) {
      const error = await failureOf(
        exchangeCode(SERVER, SECRET_CLIENT, callback(parameters), pending, callOptions(server.fetch)),
      );
      expect(error).toStrictEqual(
        new DataError("The callback does not answer the authorization request: it has no code."),
      );
    }
    expect(server.requests).toHaveLength(0);
  });

  it("refuses the tokens of an implicit or hybrid response in the callback", async () => {
    const { pending } = await start();
    const server = authorizationServer(pending);
    for (const parameter of ["id_token", "token"]) {
      const url = callback({ code: "code-1", state: pending.state, [parameter]: "x" });
      const error = await failureOf(exchangeCode(SERVER, SECRET_CLIENT, url, pending, callOptions(server.fetch)));
      expect(error).toStrictEqual(
        new DataError(
          "The callback does not answer the authorization request: implicit and hybrid flows are not supported.",
        ),
      );
    }
    expect(server.requests).toHaveLength(0);
  });

  it("is a ServiceError of status 400 that carries the refusal that the callback reports", async () => {
    const { pending } = await start();
    const server = authorizationServer(pending);
    const url = callback({ error: "access_denied", error_description: "The user said no.", state: pending.state });
    const error = await failureOf(exchangeCode(SERVER, SECRET_CLIENT, url, pending, callOptions(server.fetch)));
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      message: "The authorization server refused the authorization: access_denied (The user said no.).",
      status: 400,
      body: '{"error":"access_denied","error_description":"The user said no."}',
    });
    expect(server.requests).toHaveLength(0);
  });

  it("reads a refusal that has no description, and does not trust a refusal with the wrong state", async () => {
    const { pending } = await start();
    const server = authorizationServer(pending);
    const denied = await failureOf(
      exchangeCode(
        SERVER,
        SECRET_CLIENT,
        callback({ error: "access_denied", state: pending.state }),
        pending,
        callOptions(server.fetch),
      ),
    );
    expect(denied).toMatchObject({
      message: "The authorization server refused the authorization: access_denied.",
      body: '{"error":"access_denied"}',
    });
    const forged = await failureOf(
      exchangeCode(
        SERVER,
        SECRET_CLIENT,
        callback({ error: "access_denied", state: "other" }),
        pending,
        callOptions(server.fetch),
      ),
    );
    expect(forged).toBeInstanceOf(DataError);
  });

  describe("the issuer of the callback (RFC 9207)", () => {
    const issuer = "https://as.example";

    it("accepts an iss that equals the issuer of the server", async () => {
      const { pending } = await start();
      const server = authorizationServer(pending);
      const url = callback({ code: "code-1", state: pending.state, iss: issuer });
      await expect(
        exchangeCode({ ...SERVER, issuer }, SECRET_CLIENT, url, pending, callOptions(server.fetch)),
      ).resolves.toMatchObject({ accessToken: "at-1" });
    });

    it("refuses an iss that is another issuer, which is how a mix-up between servers shows", async () => {
      const { pending } = await start();
      const server = authorizationServer(pending);
      const url = callback({ code: "code-1", state: pending.state, iss: "https://evil.example" });
      const error = await failureOf(
        exchangeCode({ ...SERVER, issuer }, SECRET_CLIENT, url, pending, callOptions(server.fetch)),
      );
      expect(error).toStrictEqual(
        new DataError(
          'The callback does not answer the authorization request: unexpected "iss" (issuer) response parameter value.',
        ),
      );
      expect(server.requests).toHaveLength(0);
    });

    it("accepts a callback without an iss, and leaves an iss unchecked when the server names no issuer", async () => {
      const { pending } = await start();
      const server = authorizationServer(pending);
      await exchangeCode(
        { ...SERVER, issuer },
        SECRET_CLIENT,
        callback({ code: "code-1", state: pending.state }),
        pending,
        callOptions(server.fetch),
      );
      const url = callback({ code: "code-1", state: pending.state, iss: "https://anything.example" });
      await exchangeCode(SERVER, SECRET_CLIENT, url, pending, callOptions(server.fetch));
      expect(server.requests).toHaveLength(2);
    });
  });

  it("is a ServiceError that names invalid_grant for a code that the server refuses", async () => {
    const { pending } = await start();
    const server = fakeServer(() => json({ error: "invalid_grant", error_description: "The code was used." }, 400));
    const url = callback({ code: "code-1", state: pending.state });
    const error = await failureOf(exchangeCode(SERVER, SECRET_CLIENT, url, pending, callOptions(server.fetch)));
    expect(error).toMatchObject({
      status: 400,
      message: `The token endpoint ${TOKEN_URL} refused the request: invalid_grant (The code was used.).`,
    });
  });

  it("does not read an OpenID Connect token response, which carries an id_token", async () => {
    const { pending } = await start();
    const server = fakeServer(() => json({ ...RESPONSE, id_token: "a.b.c" }));
    const url = callback({ code: "code-1", state: pending.state });
    const error = await failureOf(exchangeCode(SERVER, SECRET_CLIENT, url, pending, callOptions(server.fetch)));
    expect(error).toBeInstanceOf(ServiceError);
    expect((error as ServiceError).message).toMatch(
      /^The token endpoint .* answered with a response that is not valid: /u,
    );
  });

  it("refuses a callback or a pending authorization of other types", async () => {
    const { pending } = await start();
    const options = callOptions(authorizationServer(pending).fetch);
    const good = callback({ code: "code-1", state: pending.state });
    const cases: readonly [string, () => Promise<unknown>][] = [
      [
        'The callback URL must be an absolute URL, found "/callback?code=1".',
        () => exchangeCode(SERVER, SECRET_CLIENT, "/callback?code=1", pending, options),
      ],
      [
        "The callback URL must be an absolute URL, found null.",
        () => exchangeCode(SERVER, SECRET_CLIENT, JSON.parse("null"), pending, options),
      ],
      [
        "The pending authorization must be an object, found null.",
        () => exchangeCode(SERVER, SECRET_CLIENT, good, JSON.parse("null"), options),
      ],
      [
        'The state of the pending authorization must be a non-empty string, found "".',
        () => exchangeCode(SERVER, SECRET_CLIENT, good, { ...pending, state: "" }, options),
      ],
      [
        "The codeVerifier of the pending authorization must be a non-empty string, found undefined.",
        () =>
          exchangeCode(
            SERVER,
            SECRET_CLIENT,
            good,
            JSON.parse(JSON.stringify({ ...pending, codeVerifier: undefined })),
            options,
          ),
      ],
      [
        'The url of the pending authorization must be an absolute URL, found "x".',
        () => exchangeCode(SERVER, SECRET_CLIENT, good, { ...pending, url: "x" }, options),
      ],
      [
        "The redirectUri of the pending authorization must be an absolute URL, found 5.",
        () =>
          exchangeCode(
            SERVER,
            SECRET_CLIENT,
            good,
            JSON.parse(JSON.stringify({ ...pending, redirectUri: 5 })),
            options,
          ),
      ],
    ];
    for (const [message, call] of cases) expect(await failureOf(call()), message).toStrictEqual(new DataError(message));
  });
});
