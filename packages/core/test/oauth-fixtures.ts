// biome-ignore-all lint/style/useNamingConvention: the names of the OAuth 2.0 parameters and responses are snake_case.

import { type Clock, createCryptoKeySigner, type Fetch } from "../src/index.js";
import type { AuthorizationServer, OAuthCallOptions, OAuthClient } from "../src/oauth/index.js";

/** The time of every test that needs one: a whole second, which `iat` shows exactly. */
export const NOW = 1_700_000_000_000;
const CLOCK: Clock = { now: () => NOW };

export const TOKEN_URL = "https://as.example/token";
export const SERVER: AuthorizationServer = {
  tokenEndpoint: TOKEN_URL,
  authorizationEndpoint: "https://as.example/authorize",
  registrationEndpoint: "https://as.example/register",
  revocationEndpoint: "https://as.example/revoke",
};

/** A client with a secret, whose id and secret hold characters that form encoding changes. */
export const SECRET_CLIENT: OAuthClient = {
  clientId: "app 1",
  authentication: { method: "client_secret_basic", clientSecret: "k:ey/ü" },
};

/** A request that a fake server saw. */
export interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** The body read as a form, which is empty when the request is not one. */
  readonly form: URLSearchParams;
}

/** A `fetch` that answers each request with `handler` and records it. */
export function fakeServer(handler: (seen: Seen) => Response | Promise<Response>): {
  readonly fetch: Fetch;
  readonly requests: Seen[];
} {
  const requests: Seen[] = [];
  const fetch: Fetch = async (url, init) => {
    const body = typeof init.body === "string" ? init.body : "";
    const seen: Seen = {
      url,
      method: init.method,
      headers: init.headers,
      body,
      form: init.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")
        ? new URLSearchParams(body)
        : new URLSearchParams(),
    };
    requests.push(seen);
    return handler(seen);
  };
  return { fetch, requests };
}

/** An answer with a JSON body, as a token endpoint gives it. */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8", "cache-control": "no-store", ...headers },
  });
}

/** The options of a call, with a deadline that no test reaches unless it means to. */
export function callOptions(fetch: Fetch, more: Partial<OAuthCallOptions> = {}): OAuthCallOptions {
  return { fetch, timeoutMs: 5_000, clock: CLOCK, ...more };
}

let rsa: Promise<CryptoKeyPair> | undefined;

/** An RSA key pair for RS256, made once. */
export function rsaKeyPair(): Promise<CryptoKeyPair> {
  rsa ??= crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: "SHA-256" },
    false,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
  return rsa;
}

/** A client that authenticates with `private_key_jwt` and a signer over the RSA key. */
export async function assertionClient(
  more: { readonly keyId?: string; readonly assertionLifetimeSeconds?: number } = {},
): Promise<{ readonly client: OAuthClient; readonly publicKey: CryptoKey }> {
  const pair = await rsaKeyPair();
  const keyId = "keyId" in more ? more.keyId : "tool-key-1";
  const signer = createCryptoKeySigner(pair.privateKey, {
    algorithm: "RS256",
    ...(keyId === undefined ? {} : { keyId }),
  });
  return {
    client: {
      clientId: "962fa4d8-bcbf-49a0-94b2-2de05ad274af",
      authentication: {
        method: "private_key_jwt",
        signer,
        ...(more.assertionLifetimeSeconds === undefined
          ? {}
          : { assertionLifetimeSeconds: more.assertionLifetimeSeconds }),
      },
    },
    publicKey: pair.publicKey,
  };
}

/** Runs a call and returns what it rejects with. */
export async function failureOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("The call resolved.");
}
