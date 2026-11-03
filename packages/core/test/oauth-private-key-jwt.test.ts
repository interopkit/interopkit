// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 parameters and the LTI claims are snake_case.

import { compactVerify, decodeProtectedHeader, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { createCryptoKeySigner, DataError, type Signer } from "../src/index.js";
import {
  type ClientAuthentication,
  type OAuthClient,
  refreshAccessToken,
  requestClientCredentialsToken,
  revokeToken,
} from "../src/oauth/index.js";
import {
  assertionClient,
  callOptions,
  failureOf,
  fakeServer,
  json,
  NOW,
  rsaKeyPair,
  SERVER,
  TOKEN_URL,
} from "./oauth-fixtures.js";

const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const AGS_SCORE = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
const AGS_LINE_ITEM = "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem";
const SECONDS = NOW / 1000;

/** Returns the client of `assertionClient` with claims, as a host passes them from JavaScript. */
function withClaims(client: OAuthClient, claims: unknown): OAuthClient {
  const { authentication } = client;
  if (authentication.method !== "private_key_jwt") throw new Error("The client must use private_key_jwt.");
  return { ...client, authentication: { ...authentication, claims: claims as Record<string, never> } };
}

/** Reads the claims of an assertion after checking its signature against the public key. */
async function claimsOf(assertion: string, publicKey: CryptoKey): Promise<Record<string, unknown>> {
  const { payload } = await compactVerify(assertion, publicKey);
  return JSON.parse(new TextDecoder().decode(payload));
}

describe("private_key_jwt", () => {
  it("authenticates with a signed assertion in the body, and no secret and no Authorization header", async () => {
    const { client, publicKey } = await assertionClient();
    const server = fakeServer(() => json({ access_token: "at", token_type: "Bearer" }));
    await requestClientCredentialsToken(SERVER, client, ["read"], callOptions(server.fetch));
    const [seen] = server.requests;
    expect(seen?.headers.authorization).toBeUndefined();
    expect(Object.fromEntries(seen?.form ?? [])).toMatchObject({
      grant_type: "client_credentials",
      scope: "read",
      client_id: client.clientId,
      client_assertion_type: ASSERTION_TYPE,
    });
    const assertion = seen?.form.get("client_assertion") ?? "";
    expect(await claimsOf(assertion, publicKey)).toStrictEqual({
      iss: client.clientId,
      sub: client.clientId,
      aud: TOKEN_URL,
      jti: expect.any(String),
      iat: SECONDS,
      exp: SECONDS + 300,
    });
    expect(decodeProtectedHeader(assertion)).toStrictEqual({ alg: "RS256", kid: "tool-key-1", typ: "JWT" });
  });

  it("carries the claims of the client beside the registered ones, such as the LTI deployment", async () => {
    const { client, publicKey } = await assertionClient();
    const deployment = "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
    const claims = { [deployment]: "07940580-b309-415e-a37c-914d387c1150", extra: { list: [1, null, "a"] } };
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    await requestClientCredentialsToken(SERVER, withClaims(client, claims), ["read"], callOptions(server.fetch));
    expect(await claimsOf(server.requests[0]?.form.get("client_assertion") ?? "", publicKey)).toStrictEqual({
      ...claims,
      iss: client.clientId,
      sub: client.clientId,
      aud: TOKEN_URL,
      jti: expect.any(String),
      iat: SECONDS,
      exp: SECONDS + 300,
    });
  });

  it("refuses claims that name a registered claim, are not JSON or are not an object, and makes no request", async () => {
    const { client } = await assertionClient();
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    const call = (claims: unknown) =>
      failureOf(requestClientCredentialsToken(SERVER, withClaims(client, claims), [], callOptions(server.fetch)));
    for (const name of ["iss", "sub", "aud", "exp", "nbf", "iat", "jti"]) {
      expect(await call({ [name]: "x" })).toStrictEqual(
        new DataError(
          `The claims of the client must not name "${name}", a claim that every assertion sets itself (RFC 7519 section 4.1).`,
        ),
      );
    }
    expect(await call(["a"])).toStrictEqual(
      new DataError("The claims of the client must be an object, found an array."),
    );
    expect(await call(null)).toStrictEqual(new DataError("The claims of the client must be an object, found null."));
    const notJson = await call({ when: new Date(NOW) });
    expect(notJson).toBeInstanceOf(DataError);
    expect(String(notJson)).toContain("The claims of the client must be JSON");
    expect(server.requests).toHaveLength(0);
  });

  it("gives every request an assertion of its own, with a fresh jti", async () => {
    const { client, publicKey } = await assertionClient();
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    for (let call = 0; call < 3; call += 1)
      await requestClientCredentialsToken(SERVER, client, [], callOptions(server.fetch));
    const identifiers = await Promise.all(
      server.requests.map(async (seen) => (await claimsOf(seen.form.get("client_assertion") ?? "", publicKey)).jti),
    );
    expect(new Set(identifiers).size).toBe(3);
    for (const jti of identifiers)
      expect(jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it("names the server's audience when it has one, and the token endpoint when it has none", async () => {
    const { client, publicKey } = await assertionClient();
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    await requestClientCredentialsToken(
      { ...SERVER, audience: "https://as.example" },
      client,
      [],
      callOptions(server.fetch),
    );
    await requestClientCredentialsToken(SERVER, client, [], callOptions(server.fetch));
    const audiences = await Promise.all(
      server.requests.map(async (seen) => (await claimsOf(seen.form.get("client_assertion") ?? "", publicKey)).aud),
    );
    expect(audiences).toStrictEqual(["https://as.example", TOKEN_URL]);
  });

  it("lasts as long as the client says, counted from the clock of the options", async () => {
    const { client, publicKey } = await assertionClient({ assertionLifetimeSeconds: 45 });
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    // A time with milliseconds: iat is the whole second below it.
    const clock = { now: () => NOW + 999 };
    await requestClientCredentialsToken(SERVER, client, [], callOptions(server.fetch, { clock }));
    const claims = await claimsOf(server.requests[0]?.form.get("client_assertion") ?? "", publicKey);
    expect(claims).toMatchObject({ iat: SECONDS, exp: SECONDS + 45 });
  });

  it("omits the kid when the signer has no key id", async () => {
    const { client } = await assertionClient({ keyId: undefined });
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    await requestClientCredentialsToken(SERVER, client, [], callOptions(server.fetch));
    expect(decodeProtectedHeader(server.requests[0]?.form.get("client_assertion") ?? "")).toStrictEqual({
      alg: "RS256",
      typ: "JWT",
    });
  });

  it("signs with the algorithm of the signer", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const client = {
      clientId: "c1",
      authentication: {
        method: "private_key_jwt",
        signer: createCryptoKeySigner(pair.privateKey, { algorithm: "ES256", keyId: "ec-1" }),
      },
    } as const;
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    await requestClientCredentialsToken(SERVER, client, [], callOptions(server.fetch));
    const assertion = server.requests[0]?.form.get("client_assertion") ?? "";
    expect(decodeProtectedHeader(assertion)).toMatchObject({ alg: "ES256", kid: "ec-1" });
    await expect(compactVerify(assertion, pair.publicKey)).resolves.toBeDefined();
  });

  it("authenticates the refresh and the revocation too", async () => {
    const { client, publicKey } = await assertionClient();
    const server = fakeServer((seen) =>
      seen.url === SERVER.revocationEndpoint
        ? new Response("", { status: 200 })
        : json({ access_token: "at", token_type: "bearer" }),
    );
    await refreshAccessToken(SERVER, client, "rt", callOptions(server.fetch));
    await revokeToken(SERVER, client, "at", callOptions(server.fetch));
    for (const seen of server.requests) {
      expect((await claimsOf(seen.form.get("client_assertion") ?? "", publicKey)).iss).toBe(client.clientId);
    }
  });

  it("gives the signer the signal of the call", async () => {
    const pair = await rsaKeyPair();
    const real = createCryptoKeySigner(pair.privateKey, { algorithm: "RS256" });
    const seen: (AbortSignal | undefined)[] = [];
    const signer: Signer = {
      algorithm: "RS256",
      sign: (data, options) => {
        seen.push(options?.signal);
        return real.sign(data, options);
      },
    };
    const controller = new AbortController();
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    await requestClientCredentialsToken(
      SERVER,
      { clientId: "c1", authentication: { method: "private_key_jwt", signer } },
      [],
      callOptions(server.fetch, { signal: controller.signal }),
    );
    expect(seen).toStrictEqual([controller.signal]);
  });

  it("makes no request, and rejects with the error, when the signer fails or signs in the wrong form", async () => {
    const server = fakeServer(() => json({ access_token: "at", token_type: "bearer" }));
    const down = new Error("The KMS is down.");
    const failing: Signer = { algorithm: "RS256", sign: () => Promise.reject(down) };
    const der: Signer = { algorithm: "ES256", sign: async () => new Uint8Array(71) };
    const call = (signer: Signer) =>
      requestClientCredentialsToken(
        SERVER,
        { clientId: "c1", authentication: { method: "private_key_jwt", signer } },
        [],
        callOptions(server.fetch),
      );
    expect(await failureOf(call(failing))).toBe(down);
    expect(await failureOf(call(der))).toBeInstanceOf(DataError);
    expect(server.requests).toHaveLength(0);
  });

  it("refuses a signer or a lifetime of other types", async () => {
    const options = callOptions(fakeServer(() => json({ access_token: "at", token_type: "bearer" })).fetch);
    const sign = async () => new Uint8Array(1);
    const algorithms = "RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512, ES256K, EdDSA";
    const cases: readonly [string, ClientAuthentication][] = [
      [
        `The signer of the client must name one of the algorithms ${algorithms}, found "HS256".`,
        { method: "private_key_jwt", signer: { algorithm: "HS256", sign } },
      ],
      [
        "The function sign of the signer of the client must be a function, found undefined.",
        { method: "private_key_jwt", signer: JSON.parse('{"algorithm":"RS256"}') },
      ],
      [
        "The assertionLifetimeSeconds of the client must be a positive integer, found 0.",
        { method: "private_key_jwt", signer: { algorithm: "RS256", sign }, assertionLifetimeSeconds: 0 },
      ],
      [
        'The assertionLifetimeSeconds of the client must be a positive integer, found "300".',
        {
          method: "private_key_jwt",
          signer: { algorithm: "RS256", sign },
          assertionLifetimeSeconds: JSON.parse('"300"'),
        },
      ],
    ];
    for (const [message, authentication] of cases) {
      const error = await failureOf(
        requestClientCredentialsToken(SERVER, { clientId: "c1", authentication }, [], options),
      );
      expect(error, message).toStrictEqual(new DataError(message));
    }
  });
});

describe("a token request in the shape that LTI requires", () => {
  // The LTI Security Framework 1.1 section 4.1 and 4.1.1: a tool gets a token with the client credentials grant and a JWT
  // assertion signed with RS256, `iss` and `sub` its client id, `aud` the token URL, `jti` unique, and a lifetime of
  // at most an hour.
  it("is accepted by a platform that checks it as the specification says, and gives the scopes it granted", async () => {
    const { client, publicKey } = await assertionClient();
    const scopes = [AGS_SCORE, AGS_LINE_ITEM];
    const seenIdentifiers = new Set<unknown>();
    const platform = fakeServer(async (seen) => {
      expect(seen.url).toBe(TOKEN_URL);
      expect(seen.method).toBe("POST");
      expect(seen.headers["content-type"]).toMatch(/^application\/x-www-form-urlencoded/u);
      expect(seen.form.get("grant_type")).toBe("client_credentials");
      expect(seen.form.get("client_assertion_type")).toBe(ASSERTION_TYPE);
      expect(seen.form.get("scope")).toBe(`${AGS_SCORE} ${AGS_LINE_ITEM}`);
      const assertion = seen.form.get("client_assertion") ?? "";
      const { payload, protectedHeader } = await jwtVerify(assertion, publicKey, {
        algorithms: ["RS256"],
        issuer: client.clientId,
        subject: client.clientId,
        audience: TOKEN_URL,
        clockTolerance: 0,
        currentDate: new Date(NOW),
        requiredClaims: ["exp", "iat", "jti"],
      });
      expect(protectedHeader.kid).toBe("tool-key-1");
      expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBeLessThanOrEqual(3600);
      expect(seenIdentifiers.has(payload.jti)).toBe(false);
      seenIdentifiers.add(payload.jti);
      return json({
        access_token: "ya29.token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: `${AGS_SCORE} ${AGS_LINE_ITEM}`,
      });
    });
    const token = await requestClientCredentialsToken(SERVER, client, scopes, callOptions(platform.fetch));
    expect(token).toStrictEqual({ accessToken: "ya29.token", expiresAt: NOW + 3_600_000, scopes });
    await requestClientCredentialsToken(SERVER, client, scopes, callOptions(platform.fetch));
    expect(seenIdentifiers.size).toBe(2);
  });

  it("is refused by a platform that names the invalid assertion, as a ServiceError that carries the refusal", async () => {
    const { client } = await assertionClient();
    const platform = fakeServer(() =>
      json({ error: "invalid_client", error_description: "The assertion does not verify." }, 400),
    );
    const error = await failureOf(
      requestClientCredentialsToken(SERVER, client, [AGS_SCORE], callOptions(platform.fetch)),
    );
    expect(error).toMatchObject({
      status: 400,
      message: `The token endpoint ${TOKEN_URL} refused the request: invalid_client (The assertion does not verify.).`,
    });
  });
});
