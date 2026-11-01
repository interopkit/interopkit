// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 client metadata are snake_case.

import { describe, expect, it } from "vitest";
import { DataError, ServiceError } from "../src/index.js";
import { type ClientMetadata, clientCredentialsToken, registerClient } from "../src/oauth/index.js";
import { callOptions, failureOf, fakeServer, json, NOW, SERVER, TOKEN_URL } from "./oauth-fixtures.js";

const METADATA: ClientMetadata = {
  redirectUris: ["https://app.example/callback", "http://localhost:8080/callback"],
  clientName: "Example app",
  clientUri: "https://app.example",
  scopes: ["https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.readonly", "offline_access"],
};
const REGISTERED = { client_id: "client-1", client_secret: "shh", client_secret_expires_at: 0 };
const WHAT = `The registration endpoint ${SERVER.registrationEndpoint}`;

describe("registerClient", () => {
  it("posts the metadata as JSON in the names of RFC 7591, and asks for the grants that this module carries out", async () => {
    const server = fakeServer(() => json(REGISTERED, 201));
    await registerClient(SERVER, METADATA, callOptions(server.fetch));
    const [seen] = server.requests;
    expect(seen).toMatchObject({ url: SERVER.registrationEndpoint, method: "POST" });
    expect(seen?.headers["content-type"]).toBe("application/json");
    expect(seen?.headers.accept).toBe("application/json");
    expect(JSON.parse(seen?.body ?? "")).toStrictEqual({
      redirect_uris: ["https://app.example/callback", "http://localhost:8080/callback"],
      client_name: "Example app",
      client_uri: "https://app.example",
      scope: "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.readonly offline_access",
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["authorization_code", "refresh_token", "client_credentials"],
      response_types: ["code"],
    });
  });

  it("sends the optional metadata that is given, and the authentication method that is asked for", async () => {
    const server = fakeServer(() => json({ client_id: "client-1" }, 201));
    await registerClient(
      SERVER,
      {
        ...METADATA,
        logoUri: "https://app.example/logo.png",
        tosUri: "https://app.example/terms",
        policyUri: "https://app.example/privacy",
        softwareId: "4bc9d44b-0e8e-4c4e-8f5d-2d5a3f6b7c11",
        softwareVersion: "1.4.0",
        tokenEndpointAuthMethod: "none",
      },
      callOptions(server.fetch),
    );
    // A public client has no credentials to give for the client credentials grant.
    expect(JSON.parse(server.requests[0]?.body ?? "").grant_types).toStrictEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(JSON.parse(server.requests[0]?.body ?? "")).toMatchObject({
      logo_uri: "https://app.example/logo.png",
      tos_uri: "https://app.example/terms",
      policy_uri: "https://app.example/privacy",
      software_id: "4bc9d44b-0e8e-4c4e-8f5d-2d5a3f6b7c11",
      software_version: "1.4.0",
      token_endpoint_auth_method: "none",
    });
  });

  it("reads the client that the server registered, with the token that manages it", async () => {
    const server = fakeServer(() =>
      json(
        { ...REGISTERED, registration_access_token: "rat-1", token_endpoint_auth_method: "client_secret_basic" },
        201,
      ),
    );
    expect(await registerClient(SERVER, METADATA, callOptions(server.fetch))).toStrictEqual({
      clientId: "client-1",
      authentication: { method: "client_secret_basic", clientSecret: "shh" },
      registrationAccessToken: "rat-1",
    });
  });

  it("counts the expiry of the secret in milliseconds, and leaves it out when the secret does not expire", async () => {
    const expiring = fakeServer(() => json({ ...REGISTERED, client_secret_expires_at: 1_800_000_000 }, 201));
    expect((await registerClient(SERVER, METADATA, callOptions(expiring.fetch))).clientSecretExpiresAt).toBe(
      1_800_000_000_000,
    );
    const forever = fakeServer(() => json(REGISTERED, 201));
    expect(
      Object.hasOwn(await registerClient(SERVER, METADATA, callOptions(forever.fetch)), "clientSecretExpiresAt"),
    ).toBe(false);
  });

  it("follows the method that the server chose, and registers a public client when the server gave no secret for none", async () => {
    const post = fakeServer(() => json({ ...REGISTERED, token_endpoint_auth_method: "client_secret_post" }, 201));
    expect((await registerClient(SERVER, METADATA, callOptions(post.fetch))).authentication).toStrictEqual({
      method: "client_secret_post",
      clientSecret: "shh",
    });
    const none = fakeServer(() => json({ client_id: "public-1" }, 201));
    const client = await registerClient(
      SERVER,
      { ...METADATA, tokenEndpointAuthMethod: "none" },
      callOptions(none.fetch),
    );
    expect(client).toStrictEqual({ clientId: "public-1", authentication: { method: "none" } });
  });

  it("gives a client that the other calls take as it is", async () => {
    const registry = fakeServer(() => json(REGISTERED, 201));
    const client = await registerClient(SERVER, METADATA, callOptions(registry.fetch));
    const tokens = fakeServer(() => json({ access_token: "at", token_type: "bearer", expires_in: 60 }));
    const token = await clientCredentialsToken(SERVER, client, ["offline_access"], callOptions(tokens.fetch));
    expect(token.expiresAt).toBe(NOW + 60_000);
    // The server decodes the form encoding of RFC 6749 section 2.3.1 to the id and the secret that it issued.
    const [id = "", secret = ""] = Buffer.from(
      (tokens.requests[0]?.headers.authorization ?? "").slice("Basic ".length),
      "base64",
    )
      .toString()
      .split(":")
      .map((part) => decodeURIComponent(part.replaceAll("+", " ")));
    expect({ id, secret }).toStrictEqual({ id: "client-1", secret: "shh" });
  });

  it("is a ServiceError that names the error when the server refuses the metadata", async () => {
    const server = fakeServer(() => json({ error: "invalid_redirect_uri", error_description: "Not allowed." }, 400));
    const error = await failureOf(registerClient(SERVER, METADATA, callOptions(server.fetch)));
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      message: `${WHAT} refused the request: invalid_redirect_uri (Not allowed.).`,
      status: 400,
      body: '{"error":"invalid_redirect_uri","error_description":"Not allowed."}',
    });
  });

  it("is a ServiceError for a server that answers 403 or 200, or without a client id", async () => {
    const forbidden = await failureOf(
      registerClient(SERVER, METADATA, callOptions(fakeServer(() => new Response("no", { status: 403 })).fetch)),
    );
    expect(forbidden).toMatchObject({ message: `${WHAT} answered 403.`, status: 403, body: "no" });
    const wrongStatus = await failureOf(
      registerClient(SERVER, METADATA, callOptions(fakeServer(() => json(REGISTERED, 200)).fetch)),
    );
    expect(wrongStatus).toMatchObject({ status: 200 });
    expect((wrongStatus as ServiceError).message).toContain("answered with a response that is not valid");
    const noId = await failureOf(
      registerClient(SERVER, METADATA, callOptions(fakeServer(() => json({ client_secret: "x" }, 201)).fetch)),
    );
    expect(noId).toBeInstanceOf(ServiceError);
  });

  it("is a ServiceError, and does not repeat the secret, for a method that this cannot use or a secret that is missing", async () => {
    const jwt = await failureOf(
      registerClient(
        SERVER,
        METADATA,
        callOptions(
          fakeServer(() => json({ ...REGISTERED, token_endpoint_auth_method: "private_key_jwt" }, 201)).fetch,
        ),
      ),
    );
    expect(jwt).toMatchObject({
      message: `${WHAT} registered the client for "private_key_jwt" without a secret that this can use.`,
      status: 201,
      body: "",
    });
    const noSecret = await failureOf(
      registerClient(SERVER, METADATA, callOptions(fakeServer(() => json({ client_id: "c" }, 201)).fetch)),
    );
    expect(noSecret).toMatchObject({
      message: `${WHAT} registered the client for "client_secret_basic" without a secret that this can use.`,
      status: 201,
    });
    expect(JSON.stringify(jwt)).not.toContain("shh");
  });

  it("refuses a server with no registration endpoint, and metadata of other types", async () => {
    const options = callOptions(fakeServer(() => json(REGISTERED, 201)).fetch);
    const cases: readonly [string, () => Promise<unknown>][] = [
      [
        "The authorization server must have a registrationEndpoint for this call, found none.",
        () => registerClient({ tokenEndpoint: TOKEN_URL }, METADATA, options),
      ],
      ["The client metadata must be an object, found null.", () => registerClient(SERVER, JSON.parse("null"), options)],
      [
        "The redirectUris of the client metadata must be an array, found undefined.",
        () => registerClient(SERVER, JSON.parse("{}"), options),
      ],
      [
        "The redirectUris of the client metadata must have at least one URI.",
        () => registerClient(SERVER, { ...METADATA, redirectUris: [] }, options),
      ],
      [
        'A redirect URI of the client metadata must be an absolute URL, found "/callback".',
        () => registerClient(SERVER, { ...METADATA, redirectUris: ["/callback"] }, options),
      ],
      [
        "A redirect URI of the client metadata must be an absolute URL, found 5.",
        () => registerClient(SERVER, { ...METADATA, redirectUris: JSON.parse("[5]") }, options),
      ],
      [
        'The clientName of the client metadata must be a non-empty string, found "".',
        () => registerClient(SERVER, { ...METADATA, clientName: "" }, options),
      ],
      [
        'The clientUri of the client metadata must be an absolute https URL, found "http://app.example".',
        () => registerClient(SERVER, { ...METADATA, clientUri: "http://app.example" }, options),
      ],
      [
        "The scopes must be an array, found null.",
        () => registerClient(SERVER, { ...METADATA, scopes: JSON.parse("null") }, options),
      ],
      [
        'The logoUri of the client metadata must be an absolute https URL, found "http://app.example/logo.png".',
        () => registerClient(SERVER, { ...METADATA, logoUri: "http://app.example/logo.png" }, options),
      ],
      [
        'The softwareId of the client metadata must be a non-empty string, found "".',
        () => registerClient(SERVER, { ...METADATA, softwareId: "" }, options),
      ],
      [
        'The tokenEndpointAuthMethod of the client metadata must be client_secret_basic, client_secret_post, none, found "private_key_jwt".',
        () =>
          registerClient(SERVER, { ...METADATA, tokenEndpointAuthMethod: JSON.parse('"private_key_jwt"') }, options),
      ],
      [
        "The tokenEndpointAuthMethod of the client metadata must be client_secret_basic, client_secret_post, none, found 5.",
        () => registerClient(SERVER, { ...METADATA, tokenEndpointAuthMethod: JSON.parse("5") }, options),
      ],
    ];
    for (const [message, call] of cases) expect(await failureOf(call()), message).toStrictEqual(new DataError(message));
  });
});
