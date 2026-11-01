// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 parameters and the service description are snake_case or the specification's.

import { createServer, type Server } from "node:http";
import { type Fetch, type ServiceError, SYSTEM_CLOCK } from "@interopkit/core";
import {
  authorizationRequest,
  createTokenCache,
  exchangeCode,
  type OAuthCallOptions,
  refreshAccessToken,
  registerClient,
  revokeToken,
} from "@interopkit/core/oauth";
import { exportJWK, generateKeyPair } from "jose";
import Provider from "oidc-provider";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCredentialsClient, discoverService } from "../src/client/index.js";
import { achievementCredential } from "./fixtures.js";

// An independent authorization server, `oidc-provider`, is the counterparty: the client of this package learns its endpoints
// from a service description, registers, runs the authorization code flow with PKCE, and calls a resource server with the
// tokens that it gets. The authorization server runs behind https://as.example, which the `fetch` below maps to its port, and
// the resource server is a function behind https://badges.example that answers only to the token the server issued.

const ISSUER = "https://as.example";
const RESOURCE = "https://badges.example";
const REDIRECT_URI = "https://client.example/callback";
const SCOPES = [
  "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.readonly",
  "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.upsert",
];

let http: Server;
let port = 0;
/** The credentials that the resource server uses to ask the authorization server whether a token is active (RFC 7662). */
let introspectionAuth = "";

/** The `fetch` of the host: the authorization server is reached through its port, and the resource server is answered here. */
const through: Fetch = async (url, init) => {
  const target = new URL(url);
  if (target.origin === RESOURCE) return await resource(target, init.headers.authorization);
  return fetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, {
    method: init.method,
    headers: { ...init.headers, "x-forwarded-proto": "https", "x-forwarded-host": target.host },
    body: init.body,
    redirect: "manual",
    signal: init.signal,
  });
};

/** The resource server: the service description, and the credentials of a user whose token the authorization server says is active. */
async function resource(target: URL, authorization: string | undefined): Promise<Response> {
  if (target.pathname === "/ims/ob/v3p0/discovery") {
    return Response.json({
      openapi: "3.0.1",
      info: {
        title: "Example Provider",
        version: "1.0",
        termsOfService: `${RESOURCE}/terms`,
        "x-imssf-privacyPolicyUrl": `${RESOURCE}/privacy`,
      },
      components: {
        securitySchemes: {
          OAuth2ACG: {
            type: "oauth2",
            "x-imssf-registrationUrl": `${ISSUER}/reg`,
            flows: {
              authorizationCode: {
                authorizationUrl: `${ISSUER}/auth`,
                tokenUrl: `${ISSUER}/token`,
                refreshUrl: `${ISSUER}/token`,
                scopes: Object.fromEntries(SCOPES.map((scope) => [scope, "..."])),
              },
            },
          },
        },
      },
    });
  }
  const token = authorization?.replace(/^Bearer /u, "") ?? "";
  const answer = await through(`${ISSUER}/token/introspection`, {
    method: "POST",
    headers: { authorization: introspectionAuth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
  });
  const { active } = (await answer.json()) as { active: boolean };
  if (!active) return Response.json({ imsx_codeMajor: "failure", imsx_severity: "error" }, { status: 401 });
  return Response.json({ credential: [achievementCredential()] }, { headers: { "x-total-count": "1" } });
}

beforeAll(async () => {
  const signing = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(signing.privateKey)), alg: "RS256", use: "sig", kid: "as-key-1" };
  // The server warns that its development interactions are not for production, and they are not.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const provider = new Provider(ISSUER, {
    jwks: { keys: [jwk] },
    cookies: { keys: ["a-key-that-signs-the-cookies-of-the-test-server"] },
    scopes: ["openid", "offline_access", ...SCOPES],
    clientAuthMethods: ["client_secret_basic"],
    ttl: { Interaction: 600 },
    pkce: { required: () => true },
    issueRefreshToken: async () => true,
    findAccount: async (_context: unknown, id: string) => ({ accountId: id, claims: async () => ({ sub: id }) }),
    features: {
      devInteractions: { enabled: true },
      // `registerClient` of the OAuth module asks for the client credentials grant too, which a server must then accept.
      clientCredentials: { enabled: true },
      registration: { enabled: true },
      revocation: { enabled: true },
      introspection: { enabled: true },
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
async function browse(url: string): Promise<URL> {
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
    // A page of the development interactions: log in as any user, then consent. Each page posts to its own address.
    if (/^\/interaction\/[^/]+$/u.test(target.pathname)) {
      const consent = (await response.text()).includes('value="consent"');
      location = target.href;
      method = "POST";
      body = new URLSearchParams(
        consent ? { prompt: "consent" } : { prompt: "login", login: "alice", password: "pass" },
      ).toString();
      continue;
    }
    throw new Error(`The browser did not reach the callback: ${response.status} at ${location}.`);
  }
  throw new Error("The browser did not reach the callback.");
}

describe("the client with an independent authorization server", () => {
  it("discovers the endpoints, registers, gets tokens with PKCE, calls the API, refreshes and revokes", async () => {
    const service = await discoverService(RESOURCE, "badges", { fetch: through });
    const server = {
      tokenEndpoint: service.tokenUrl,
      authorizationEndpoint: service.authorizationUrl,
      registrationEndpoint: service.registrationUrl,
      revocationEndpoint: `${ISSUER}/token/revocation`,
      issuer: ISSUER,
    };
    const options: OAuthCallOptions = { fetch: through, timeoutMs: 10_000, clock: SYSTEM_CLOCK };
    const registered = await registerClient(
      server,
      {
        redirectUris: [REDIRECT_URI],
        clientName: "Wallet",
        clientUri: "https://client.example",
        scopes: [...service.scopes, "offline_access"],
      },
      options,
    );
    const client = registered;
    if (client.authentication.method !== "client_secret_basic") throw new Error("The server issued no secret.");
    introspectionAuth = `Basic ${btoa(`${client.clientId}:${client.authentication.clientSecret}`)}`;
    const scopes = [...service.scopes, "offline_access"];
    const pending = await authorizationRequest(server, client, { redirectUri: REDIRECT_URI, scopes });
    const callback = await browse(pending.url);
    const first = await exchangeCode(server, client, callback.href, pending, options);
    expect(first.refreshToken).toEqual(expect.any(String));

    // The token cache is the `token` of the client, and the resource server answers only for a token that is active.
    let token = first;
    const cache = createTokenCache(async () => token, { clock: SYSTEM_CLOCK });
    const api = (tokenOf: () => Promise<string>) =>
      createCredentialsClient({ api: "badges", baseUrl: RESOURCE, fetch: through, token: tokenOf });
    const listed = async (tokenOf: () => Promise<string>) => {
      const found: (string | object)[] = [];
      for await (const each of api(tokenOf).listCredentials()) found.push(each);
      return found;
    };
    expect(await listed(cache)).toHaveLength(1);
    expect(
      await listed(async () => "a-token-nobody-issued").catch((error: unknown) => (error as ServiceError).status),
    ).toBe(401);

    token = await refreshAccessToken(server, client, first.refreshToken ?? "", options);
    expect(token.accessToken).not.toBe(first.accessToken);
    expect(await listed(async () => token.accessToken)).toHaveLength(1);

    await revokeToken(server, client, token.accessToken, options);
    expect(await listed(async () => token.accessToken).catch((error: unknown) => (error as ServiceError).status)).toBe(
      401,
    );
  });
});
