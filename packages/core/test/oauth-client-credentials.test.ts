// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 parameters and responses are snake_case.

import { describe, expect, it } from "vitest";
import { DataError, ServiceError } from "../src/index.js";
import { clientCredentialsToken, refreshAccessToken, revokeToken } from "../src/oauth/index.js";
import { callOptions, failureOf, fakeServer, json, NOW, SECRET_CLIENT, SERVER, TOKEN_URL } from "./oauth-fixtures.js";

const TOKEN = { access_token: "at-1", token_type: "Bearer", expires_in: 3600 };

describe("clientCredentialsToken", () => {
  it("posts the grant and the scopes as a form and reads the token", async () => {
    const server = fakeServer(() => json({ ...TOKEN, scope: "read write" }));
    const token = await clientCredentialsToken(SERVER, SECRET_CLIENT, ["read", "write"], callOptions(server.fetch));
    expect(token).toStrictEqual({ accessToken: "at-1", expiresAt: NOW + 3_600_000, scopes: ["read", "write"] });
    const [seen] = server.requests;
    expect(seen).toMatchObject({ url: TOKEN_URL, method: "POST" });
    expect(seen?.headers["content-type"]).toBe("application/x-www-form-urlencoded;charset=UTF-8");
    expect(seen?.headers.accept).toBe("application/json");
    expect([...(seen?.form ?? [])]).toStrictEqual([
      ["scope", "read write"],
      ["grant_type", "client_credentials"],
    ]);
  });

  it("sends a client secret in the Authorization header, form-encoded as the OAuth 2.0 specification says, and not in the body", async () => {
    const server = fakeServer(() => json(TOKEN));
    await clientCredentialsToken(SERVER, SECRET_CLIENT, ["read"], callOptions(server.fetch));
    // "app 1" and "k:ey/ü" encode as "app+1" and "k%3Aey%2F%C3%BC" before they are joined with a colon.
    const expected = Buffer.from("app+1:k%3Aey%2F%C3%BC").toString("base64");
    expect(server.requests[0]?.headers.authorization).toBe(`Basic ${expected}`);
    expect(server.requests[0]?.form.has("client_secret")).toBe(false);
    expect(server.requests[0]?.form.has("client_id")).toBe(false);
  });

  it("sends the secret and the id in the body for client_secret_post, and the id alone for none", async () => {
    const server = fakeServer(() => json(TOKEN));
    const post = { clientId: "c1", authentication: { method: "client_secret_post", clientSecret: "shh" } } as const;
    await clientCredentialsToken(SERVER, post, [], callOptions(server.fetch));
    await clientCredentialsToken(
      SERVER,
      { clientId: "c2", authentication: { method: "none" } },
      [],
      callOptions(server.fetch),
    );
    const [first, second] = server.requests;
    expect(first?.headers.authorization).toBeUndefined();
    expect(Object.fromEntries(first?.form ?? [])).toStrictEqual({
      grant_type: "client_credentials",
      client_id: "c1",
      client_secret: "shh",
    });
    expect(second?.headers.authorization).toBeUndefined();
    expect(Object.fromEntries(second?.form ?? [])).toStrictEqual({ grant_type: "client_credentials", client_id: "c2" });
  });

  it("gives the scopes that were asked for when the server names none, and none when it expires no token", async () => {
    const server = fakeServer(() => json({ access_token: "at-2", token_type: "bearer" }));
    const token = await clientCredentialsToken(SERVER, SECRET_CLIENT, ["a", "b"], callOptions(server.fetch));
    expect(token).toStrictEqual({ accessToken: "at-2", scopes: ["a", "b"] });
    expect(Object.hasOwn(token, "expiresAt")).toBe(false);
  });

  it("gives the scopes that the server names when they are fewer than those asked for", async () => {
    const server = fakeServer(() => json({ ...TOKEN, scope: "a" }));
    const token = await clientCredentialsToken(SERVER, SECRET_CLIENT, ["a", "b"], callOptions(server.fetch));
    expect(token.scopes).toStrictEqual(["a"]);
  });

  it("keeps the refresh token that the server issues", async () => {
    const server = fakeServer(() => json({ ...TOKEN, refresh_token: "rt-1" }));
    const token = await clientCredentialsToken(SERVER, SECRET_CLIENT, [], callOptions(server.fetch));
    expect(token).toMatchObject({ accessToken: "at-1", refreshToken: "rt-1" });
  });

  it("takes the expiry from the clock of the options", async () => {
    const server = fakeServer(() => json({ ...TOKEN, expires_in: 90.5 }));
    const clock = { now: () => 5_000 };
    const token = await clientCredentialsToken(SERVER, SECRET_CLIENT, [], callOptions(server.fetch, { clock }));
    expect(token.expiresAt).toBe(5_000 + 90_500);
  });

  describe("a server that refuses or fails", () => {
    const call = (response: () => Response | Promise<Response>) =>
      clientCredentialsToken(SERVER, SECRET_CLIENT, ["x"], callOptions(fakeServer(response).fetch));
    const what = `The token endpoint ${TOKEN_URL}`;

    it("is a ServiceError of status 400 that names the OAuth error, with the answer in body", async () => {
      const answer = { error: "invalid_scope", error_description: "No such scope." };
      const error = await failureOf(call(() => json(answer, 400)));
      expect(error).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({
        message: `${what} refused the request: invalid_scope (No such scope.).`,
        status: 400,
        body: JSON.stringify(answer),
      });
    });

    it("names the error alone when the server gives no description", async () => {
      const error = await failureOf(call(() => json({ error: "invalid_client" }, 400)));
      expect(error).toMatchObject({ message: `${what} refused the request: invalid_client.`, status: 400 });
    });

    it("is a ServiceError of status 401 for a challenge to authenticate", async () => {
      const challenge = { "www-authenticate": 'Basic realm="as", error="invalid_client"' };
      const error = await failureOf(call(() => json({ error: "invalid_client" }, 401, challenge)));
      expect(error).toMatchObject({
        message: `${what} answered 401 and challenged the client to authenticate.`,
        status: 401,
        body: '{"error":"invalid_client"}',
      });
    });

    it.each([403, 404, 500, 503])(
      "is a ServiceError of status %i with the body for any other status",
      async (status) => {
        const error = await failureOf(call(() => new Response("down", { status })));
        expect(error).toMatchObject({ message: `${what} answered ${status}.`, status, body: "down" });
      },
    );

    it("is a ServiceError for a redirect, which it does not follow", async () => {
      const error = await failureOf(
        call(() => new Response("", { status: 302, headers: { location: "http://as.example/t" } })),
      );
      expect(error).toMatchObject({ status: 302 });
      expect((error as ServiceError).message).toContain("redirect");
    });

    it("is a ServiceError for an answer that is not a token response", async () => {
      const cases: readonly [string, () => Response][] = [
        ["not JSON", () => new Response("nope", { status: 200, headers: { "content-type": "text/plain" } })],
        ["no access_token", () => json({ token_type: "bearer" })],
        ["no token_type", () => json({ access_token: "x" })],
        ["a negative expires_in", () => json({ ...TOKEN, expires_in: -1 })],
        ["a scope that is not a string", () => json({ ...TOKEN, scope: 5 })],
        ["a token type that this does not support", () => json({ access_token: "x", token_type: "mac" })],
      ];
      for (const [name, response] of cases) {
        const error = await failureOf(call(response));
        expect(error, name).toBeInstanceOf(ServiceError);
        expect((error as ServiceError).message, name).toMatch(
          new RegExp(`^${what} answered with a response that is not valid: `, "u"),
        );
        expect((error as ServiceError).status, name).toBe(200);
      }
    });

    it("is a ServiceError that does not repeat the token for a token that is not a bearer token", async () => {
      const error = await failureOf(call(() => json({ access_token: "secret-token", token_type: "DPoP" })));
      expect(error).toMatchObject({
        message: `${what} issued a dpop token, and only bearer tokens are supported.`,
        status: 200,
        body: "",
      });
      expect(JSON.stringify(error)).not.toContain("secret-token");
    });

    it("is a ServiceError of status 0 when the server does not answer", async () => {
      const error = await failureOf(
        clientCredentialsToken(
          SERVER,
          SECRET_CLIENT,
          [],
          callOptions(() => Promise.reject(new TypeError("offline"))),
        ),
      );
      expect(error).toMatchObject({ message: `${what} did not answer: offline.`, status: 0 });
    });

    it("is a ServiceError of status 0 at the deadline", async () => {
      const hanging = () => new Promise<Response>(() => undefined);
      const error = await failureOf(
        clientCredentialsToken(SERVER, SECRET_CLIENT, [], callOptions(hanging, { timeoutMs: 20 })),
      );
      expect(error).toMatchObject({ message: `${what} did not answer within 20 ms.`, status: 0 });
    });

    it("refuses an answer of more than 65,536 bytes", async () => {
      const error = await failureOf(call(() => new Response("a".repeat(70_000), { status: 200 })));
      expect(error).toMatchObject({ message: `${what} answered with more than 65536 bytes.`, status: 200 });
    });
  });

  describe("the signal of the caller", () => {
    it("rejects with its reason, and makes no request when it is aborted before the call", async () => {
      const server = fakeServer(() => json(TOKEN));
      const reason = new Error("Left the page.");
      const options = callOptions(server.fetch, { signal: AbortSignal.abort(reason) });
      expect(await failureOf(clientCredentialsToken(SERVER, SECRET_CLIENT, [], options))).toBe(reason);
      expect(server.requests).toHaveLength(0);
    });

    it("rejects with its reason when it aborts during the call", async () => {
      const controller = new AbortController();
      const reason = new Error("The wait ended.");
      const hanging = () => new Promise<Response>(() => undefined);
      const call = clientCredentialsToken(
        SERVER,
        SECRET_CLIENT,
        [],
        callOptions(hanging, { signal: controller.signal }),
      );
      controller.abort(reason);
      expect(await failureOf(call)).toBe(reason);
    });
  });

  it("refuses arguments of other types, with a message that says what to fix", async () => {
    const options = callOptions(fakeServer(() => json(TOKEN)).fetch);
    const cases: readonly [string, () => Promise<unknown>][] = [
      [
        "The authorization server must be an object, found null.",
        () => clientCredentialsToken(JSON.parse("null"), SECRET_CLIENT, [], options),
      ],
      [
        'The tokenEndpoint of the authorization server must be an absolute https URL, found "http://as.example/token".',
        () => clientCredentialsToken({ tokenEndpoint: "http://as.example/token" }, SECRET_CLIENT, [], options),
      ],
      [
        "The tokenEndpoint of the authorization server must be a string, found undefined.",
        () => clientCredentialsToken(JSON.parse("{}"), SECRET_CLIENT, [], options),
      ],
      [
        'The audience of the authorization server must be a non-empty string, found "".',
        () => clientCredentialsToken({ ...SERVER, audience: "" }, SECRET_CLIENT, [], options),
      ],
      [
        "The client must be an object, found null.",
        () => clientCredentialsToken(SERVER, JSON.parse("null"), [], options),
      ],
      [
        'The clientId of the client must be a non-empty string, found "".',
        () => clientCredentialsToken(SERVER, { clientId: "", authentication: { method: "none" } }, [], options),
      ],
      [
        "The authentication of the client must be an object, found null.",
        () => clientCredentialsToken(SERVER, JSON.parse('{"clientId":"a","authentication":null}'), [], options),
      ],
      [
        'The authentication method of the client must be client_secret_basic, client_secret_post, private_key_jwt or none, found "basic".',
        () =>
          clientCredentialsToken(
            SERVER,
            JSON.parse('{"clientId":"a","authentication":{"method":"basic"}}'),
            [],
            options,
          ),
      ],
      [
        'The clientSecret of the client must be a non-empty string, found "".',
        () =>
          clientCredentialsToken(
            SERVER,
            JSON.parse('{"clientId":"a","authentication":{"method":"client_secret_post","clientSecret":""}}'),
            [],
            options,
          ),
      ],
      [
        "The signer of the client must be an object, found undefined.",
        () =>
          clientCredentialsToken(
            SERVER,
            JSON.parse('{"clientId":"a","authentication":{"method":"private_key_jwt"}}'),
            [],
            options,
          ),
      ],
      [
        "The scopes must be an array, found null.",
        () => clientCredentialsToken(SERVER, SECRET_CLIENT, JSON.parse("null"), options),
      ],
      [
        'A scope must be a non-empty string without spaces, quotes or backslashes, found "a b".',
        () => clientCredentialsToken(SERVER, SECRET_CLIENT, ["a b"], options),
      ],
      [
        "A scope must be a non-empty string without spaces, quotes or backslashes, found 5.",
        () => clientCredentialsToken(SERVER, SECRET_CLIENT, JSON.parse("[5]"), options),
      ],
      [
        "The options of a call must be an object, found null.",
        () => clientCredentialsToken(SERVER, SECRET_CLIENT, [], JSON.parse("null")),
      ],
      [
        "The option clock must be an object, found undefined.",
        () =>
          clientCredentialsToken(
            SERVER,
            SECRET_CLIENT,
            [],
            Object.assign(JSON.parse('{"timeoutMs":10}'), { fetch: options.fetch }),
          ),
      ],
      [
        'The option fetch must be a function, found "x".',
        () => clientCredentialsToken(SERVER, SECRET_CLIENT, [], JSON.parse('{"fetch":"x","timeoutMs":10,"clock":{}}')),
      ],
    ];
    for (const [message, call] of cases) expect(await failureOf(call()), message).toStrictEqual(new DataError(message));
  });
});

describe("refreshAccessToken", () => {
  it("posts the refresh token with the grant and reads the new token, with the refresh token only when it is sent", async () => {
    const server = fakeServer(() => json({ ...TOKEN, access_token: "at-2", scope: "read" }));
    const token = await refreshAccessToken(SERVER, SECRET_CLIENT, "rt-1", callOptions(server.fetch));
    expect(token).toStrictEqual({ accessToken: "at-2", expiresAt: NOW + 3_600_000, scopes: ["read"] });
    expect(Object.fromEntries(server.requests[0]?.form ?? [])).toStrictEqual({
      refresh_token: "rt-1",
      grant_type: "refresh_token",
    });
    const rotating = fakeServer(() => json({ ...TOKEN, refresh_token: "rt-2" }));
    expect((await refreshAccessToken(SERVER, SECRET_CLIENT, "rt-1", callOptions(rotating.fetch))).refreshToken).toBe(
      "rt-2",
    );
  });

  it("has no scopes when the server names none, since the request asks for none", async () => {
    const server = fakeServer(() => json(TOKEN));
    expect((await refreshAccessToken(SERVER, SECRET_CLIENT, "rt-1", callOptions(server.fetch))).scopes).toStrictEqual(
      [],
    );
  });

  it("is a ServiceError that names invalid_grant for a refresh token that was used", async () => {
    const server = fakeServer(() => json({ error: "invalid_grant", error_description: "Used." }, 400));
    const error = await failureOf(refreshAccessToken(SERVER, SECRET_CLIENT, "rt-1", callOptions(server.fetch)));
    expect(error).toMatchObject({
      status: 400,
      message: `The token endpoint ${TOKEN_URL} refused the request: invalid_grant (Used.).`,
    });
  });

  it("refuses a refresh token that is not a non-empty string", async () => {
    const options = callOptions(fakeServer(() => json(TOKEN)).fetch);
    expect(await failureOf(refreshAccessToken(SERVER, SECRET_CLIENT, "", options))).toStrictEqual(
      new DataError('The refresh token must be a non-empty string, found "".'),
    );
    expect(await failureOf(refreshAccessToken(SERVER, SECRET_CLIENT, JSON.parse("null"), options))).toBeInstanceOf(
      DataError,
    );
  });
});

describe("revokeToken", () => {
  it("posts the token to the revocation endpoint and resolves when the server answers 200", async () => {
    const server = fakeServer(() => new Response("", { status: 200 }));
    await expect(revokeToken(SERVER, SECRET_CLIENT, "at-1", callOptions(server.fetch))).resolves.toBeUndefined();
    expect(server.requests[0]).toMatchObject({ url: SERVER.revocationEndpoint, method: "POST" });
    expect(Object.fromEntries(server.requests[0]?.form ?? [])).toStrictEqual({ token: "at-1" });
    expect(server.requests[0]?.headers.authorization).toMatch(/^Basic /u);
  });

  it("is safe to repeat: a token that is already revoked gives the same answer", async () => {
    const server = fakeServer(() => new Response("", { status: 200 }));
    await revokeToken(SERVER, SECRET_CLIENT, "at-1", callOptions(server.fetch));
    await expect(revokeToken(SERVER, SECRET_CLIENT, "at-1", callOptions(server.fetch))).resolves.toBeUndefined();
  });

  it("is a ServiceError that names unsupported_token_type", async () => {
    const server = fakeServer(() => json({ error: "unsupported_token_type" }, 400));
    const error = await failureOf(revokeToken(SERVER, SECRET_CLIENT, "at-1", callOptions(server.fetch)));
    expect(error).toMatchObject({
      message: `The revocation endpoint ${SERVER.revocationEndpoint} refused the request: unsupported_token_type.`,
      status: 400,
    });
  });

  it("refuses a server with no revocation endpoint, and a token that is not a non-empty string", async () => {
    const options = callOptions(fakeServer(() => new Response("")).fetch);
    expect(await failureOf(revokeToken({ tokenEndpoint: TOKEN_URL }, SECRET_CLIENT, "at", options))).toStrictEqual(
      new DataError("The authorization server must have a revocationEndpoint for this call, found none."),
    );
    expect(await failureOf(revokeToken(SERVER, SECRET_CLIENT, "", options))).toStrictEqual(
      new DataError('The token must be a non-empty string, found "".'),
    );
  });
});
