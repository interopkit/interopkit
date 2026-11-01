// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 parameters and the metadata of a client are snake_case.

import { createServer, type Server } from "node:http";
import { exportJWK, generateKeyPair } from "jose";
import Provider from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type Fetch, SYSTEM_CLOCK, signerFromCryptoKey } from "../src/index.js";
import {
  authorizationRequest,
  clientCredentialsToken,
  exchangeCode,
  type OAuthCallOptions,
  type OAuthClient,
  refreshAccessToken,
  registerClient,
  revokeToken,
} from "../src/oauth/index.js";
import { failureOf } from "./oauth-fixtures.js";

// An independent authorization server, `oidc-provider`, is the counterparty: it checks the requests of this module as a real
// server does, and the answers that it gives are the ones that a real client reads. It runs behind the address
// https://as.example, which the `fetch` below maps to its local port.

const ISSUER = "https://as.example";
const REDIRECT_URI = "https://client.example/callback";
const SERVER = {
  tokenEndpoint: `${ISSUER}/token`,
  authorizationEndpoint: `${ISSUER}/auth`,
  registrationEndpoint: `${ISSUER}/reg`,
  revocationEndpoint: `${ISSUER}/token/revocation`,
  issuer: ISSUER,
};
const METADATA = {
  redirectUris: [REDIRECT_URI],
  clientName: "Counterparty test",
  clientUri: "https://client.example",
  scopes: ["read", "write"],
} as const;

let http: Server;
let port = 0;
let publicKey: JsonWebKey;
let toolKey: CryptoKeyPair;

/** The `fetch` of the host: it sends a request for https://as.example to the local server, with the headers a proxy adds. */
const through: Fetch = (url, init) => {
  const target = new URL(url);
  return fetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, {
    method: init.method,
    headers: { ...init.headers, "x-forwarded-proto": "https", "x-forwarded-host": target.host },
    body: init.body,
    redirect: "manual",
    signal: init.signal,
  });
};

const options = (): OAuthCallOptions => ({ fetch: through, timeoutMs: 10_000, clock: SYSTEM_CLOCK });

beforeAll(async () => {
  toolKey = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicKey = await crypto.subtle.exportKey("jwk", toolKey.publicKey);
  const signing = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(signing.privateKey)), alg: "RS256", use: "sig", kid: "as-key-1" };
  // The server warns that its development interactions are not for production, and they are not.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const provider = new Provider(ISSUER, {
    clients: [
      {
        client_id: "tool-1",
        token_endpoint_auth_method: "private_key_jwt",
        grant_types: ["client_credentials"],
        response_types: [],
        redirect_uris: [],
        scope: "read write",
        jwks: { keys: [{ ...publicKey, alg: "RS256", use: "sig", kid: "tool-key-1" }] },
      },
    ],
    jwks: { keys: [jwk] },
    cookies: { keys: ["a-key-that-signs-the-cookies-of-the-test-server"] },
    scopes: ["openid", "offline_access", "read", "write"],
    clientAuthMethods: ["client_secret_basic", "client_secret_post", "private_key_jwt", "none"],
    ttl: { Interaction: 600 },
    pkce: { required: () => true },
    issueRefreshToken: async () => true,
    findAccount: async (_context: unknown, id: string) => ({ accountId: id, claims: async () => ({ sub: id }) }),
    features: {
      devInteractions: { enabled: true },
      clientCredentials: { enabled: true },
      registration: { enabled: true },
      registrationManagement: { enabled: true },
      revocation: { enabled: true },
    },
  });
  provider.proxy = true;
  http = createServer(provider.callback());
  await new Promise<void>((done) => http.listen(0, "127.0.0.1", done));
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  port = address.port;
});

afterAll(async () => {
  await new Promise<void>((done) => {
    http.close(() => done());
    http.closeAllConnections();
  });
  vi.restoreAllMocks();
});

/** What the user does in a browser: the pages of the development interactions, with the cookies that the server sets. */
async function browse(url: string, answer: "continue" | "deny"): Promise<URL> {
  const cookies = new Map<string, string>();
  let method = "GET";
  let body: string | undefined;
  let location = url;
  for (let step = 0; step < 12; step += 1) {
    const target = new URL(location, ISSUER);
    if (`${target.origin}${target.pathname}` === REDIRECT_URI) return target;
    const headers: Record<string, string> = {
      cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    };
    if (body !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
    const response = await through(target.href, {
      method: method as "GET" | "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ""] = line.split(";");
      const at = pair.indexOf("=");
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const next = response.headers.get("location");
    if (next !== null) {
      location = next;
      method = "GET";
      body = undefined;
      continue;
    }
    // A page of the development interactions: log in as any user, then continue or abort. Each page posts to its own address.
    if (/^\/interaction\/[^/]+$/u.test(target.pathname)) {
      const consent = (await response.text()).includes('value="consent"');
      if (consent && answer === "deny") {
        location = `${target.origin}${target.pathname}/abort`;
        continue;
      }
      location = target.href;
      method = "POST";
      body = new URLSearchParams(
        consent ? { prompt: "consent" } : { prompt: "login", login: "alice", password: "pass" },
      ).toString();
      continue;
    }
    throw new Error(
      `The browser did not reach the callback: ${response.status} at ${location}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  throw new Error("The browser did not reach the callback.");
}

/** Registers a client at the server. */
const register = (tokenEndpointAuthMethod?: "client_secret_basic" | "client_secret_post" | "none") =>
  registerClient(
    SERVER,
    { ...METADATA, ...(tokenEndpointAuthMethod === undefined ? {} : { tokenEndpointAuthMethod }) },
    options(),
  );

describe("registration at an independent authorization server", () => {
  it("registers a client that gets a secret, and the client works at the token endpoint", async () => {
    const client = await register();
    expect(client).toMatchObject({
      authentication: { method: "client_secret_basic", clientSecret: expect.any(String) },
    });
    expect(client.registrationAccessToken).toEqual(expect.any(String));
    const token = await clientCredentialsToken(SERVER, client, ["read"], options());
    expect(token).toMatchObject({ accessToken: expect.any(String), scopes: ["read"] });
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it("registers for client_secret_post, and for none", async () => {
    const post = await register("client_secret_post");
    expect(post.authentication).toMatchObject({ method: "client_secret_post" });
    expect((await clientCredentialsToken(SERVER, post, ["write"], options())).scopes).toStrictEqual(["write"]);
    const none = await register("none");
    expect(none.authentication).toStrictEqual({ method: "none" });
  });

  it("is refused for metadata that the server does not accept", async () => {
    const error = await failureOf(
      registerClient(SERVER, { ...METADATA, scopes: ["scope-that-is-not-offered"] }, options()),
    );
    expect(error).toMatchObject({ status: 400, message: expect.stringContaining("invalid_client_metadata") });
  });
});

describe("client credentials at an independent authorization server", () => {
  it("authenticates with a private_key_jwt assertion of the shape that LTI requires, and each assertion is new", async () => {
    const client: OAuthClient = {
      clientId: "tool-1",
      authentication: {
        method: "private_key_jwt",
        signer: signerFromCryptoKey(toolKey.privateKey, { algorithm: "RS256", keyId: "tool-key-1" }),
      },
    };
    const first = await clientCredentialsToken(SERVER, client, ["read", "write"], options());
    const second = await clientCredentialsToken(SERVER, client, ["read"], options());
    expect(first).toMatchObject({ accessToken: expect.any(String), scopes: ["read", "write"] });
    expect(second.accessToken).not.toBe(first.accessToken);
  });

  it("is refused for a secret that is wrong, as a challenge from the server", async () => {
    const registered = await register();
    const wrong: OAuthClient = {
      clientId: registered.clientId,
      authentication: { method: "client_secret_basic", clientSecret: "not-the-secret" },
    };
    const error = await failureOf(clientCredentialsToken(SERVER, wrong, ["read"], options()));
    expect(error).toMatchObject({ status: 401, body: expect.stringContaining("invalid_client") });
  });

  it("is refused for an assertion that the client's key did not sign", async () => {
    const other = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    const forger: OAuthClient = {
      clientId: "tool-1",
      authentication: {
        method: "private_key_jwt",
        signer: signerFromCryptoKey((other as CryptoKeyPair).privateKey, { algorithm: "RS256", keyId: "tool-key-1" }),
      },
    };
    const error = await failureOf(clientCredentialsToken(SERVER, forger, ["read"], options()));
    expect(error).toMatchObject({ status: 401, message: expect.stringMatching(/invalid_client|challenged/u) });
  });
});

describe("the authorization code flow at an independent authorization server", () => {
  /** Runs the flow to the callback as a user who continues, and returns the pending request and the callback. */
  async function authorize(client: OAuthClient, scopes: readonly string[] = ["read", "write"]) {
    const pending = await authorizationRequest(SERVER, client, { redirectUri: REDIRECT_URI, scopes });
    return { pending, callback: await browse(pending.url, "continue") };
  }

  it("exchanges the code of a confidential client, refreshes the token, and revokes it", async () => {
    const client = await register();
    const { pending, callback } = await authorize(client);
    expect(callback.searchParams.get("iss")).toBe(ISSUER);
    const token = await exchangeCode(SERVER, client, callback.href, pending, options());
    expect(token).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      scopes: ["read", "write"],
    });
    const refreshed = await refreshAccessToken(SERVER, client, token.refreshToken ?? "", options());
    expect(refreshed.accessToken).not.toBe(token.accessToken);
    const next = refreshed.refreshToken ?? token.refreshToken ?? "";
    await revokeToken(SERVER, client, next, options());
    // Revoking again is safe, and the revoked token no longer works.
    await expect(revokeToken(SERVER, client, next, options())).resolves.toBeUndefined();
    const error = await failureOf(refreshAccessToken(SERVER, client, next, options()));
    expect(error).toMatchObject({ status: 400, message: expect.stringContaining("invalid_grant") });
  });

  it("exchanges the code of a public client with PKCE alone", async () => {
    const client = await register("none");
    const { pending, callback } = await authorize(client);
    const token = await exchangeCode(SERVER, client, callback.href, pending, options());
    expect(token).toMatchObject({ accessToken: expect.any(String), scopes: ["read", "write"] });
  });

  it("refuses a code that is used twice", async () => {
    const client = await register();
    const { pending, callback } = await authorize(client);
    await exchangeCode(SERVER, client, callback.href, pending, options());
    const error = await failureOf(exchangeCode(SERVER, client, callback.href, pending, options()));
    expect(error).toMatchObject({ status: 400, message: expect.stringContaining("invalid_grant") });
  });

  it("carries the refusal of a user who denies the request", async () => {
    const client = await register();
    const pending = await authorizationRequest(SERVER, client, { redirectUri: REDIRECT_URI, scopes: ["read"] });
    const callback = await browse(pending.url, "deny");
    const error = await failureOf(exchangeCode(SERVER, client, callback.href, pending, options()));
    expect(error).toMatchObject({ status: 400, message: expect.stringContaining("access_denied") });
  });

  it("refuses the iss of another server, and the state of another request", async () => {
    const client = await register();
    const { pending, callback } = await authorize(client);
    const mixedUp = await failureOf(
      exchangeCode({ ...SERVER, issuer: "https://other.example" }, client, callback.href, pending, options()),
    );
    expect(mixedUp).toMatchObject({ message: expect.stringContaining('unexpected "iss"') });
    const other = await authorizationRequest(SERVER, client, { redirectUri: REDIRECT_URI, scopes: ["read"] });
    const swapped = await failureOf(exchangeCode(SERVER, client, callback.href, other, options()));
    expect(swapped).toMatchObject({ message: expect.stringContaining('unexpected "state"') });
  });

  it("does not check the iss when the server names no issuer", async () => {
    const client = await register();
    const { pending, callback } = await authorize(client);
    const { issuer: _issuer, ...withoutIssuer } = SERVER;
    await expect(exchangeCode(withoutIssuer, client, callback.href, pending, options())).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });
});
