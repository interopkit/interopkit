// biome-ignore-all lint/style/useNamingConvention: OAuth is a name of the specification, and the API names it as such.

import * as oauth from "oauth4webapi";
import {
  checkNonEmptyString,
  checkPositiveInteger,
  checkRecord,
  copyJson,
  describe,
  type JsonValue,
} from "../checks.js";
import { DataError } from "../errors.js";
import type { Signer } from "../signer/index.js";
import { checkSigner } from "../signer/internal.js";
import { privateKeyJwt } from "./assertion.js";
import type { OAuthCallOptions } from "./request.js";
import type { AuthorizationServer } from "./server.js";

/** How a client proves itself to the token endpoint (RFC 6749 section 2.3, RFC 7523 and RFC 7591 section 2). */
export type ClientAuthentication =
  | {
      /** The secret goes in the `Authorization` header (`client_secret_basic`) or in the body (`client_secret_post`). */
      readonly method: "client_secret_basic" | "client_secret_post";
      /** The secret that the server issued. */
      readonly clientSecret: string;
    }
  | {
      /** The client signs a JWT assertion (RFC 7523 section 2.2), as LTI and the Security Framework 1.1 require. */
      readonly method: "private_key_jwt";
      /** Signs the assertion; its `keyId` is the `kid` of the assertion. */
      readonly signer: Signer;
      /**
       * The seconds from `iat` to `exp` of an assertion.
       *
       * @defaultValue 300
       */
      readonly assertionLifetimeSeconds?: number;
      /**
       * Claims that every assertion carries beside `iss`, `sub`, `aud`, `jti`, `iat` and `exp`, such as the deployment that
       * LTI 1.3 Core section 6.2.1 asks a tool to name (`https://purl.imsglobal.org/spec/lti/claim/deployment_id`).
       *
       * @defaultValue none
       */
      readonly claims?: Readonly<Record<string, JsonValue>>;
    }
  | {
      /** The client is public and sends only its identifier. */
      readonly method: "none";
    };

/** A client of an authorization server: its identifier and how it authenticates. */
export interface OAuthClient {
  /** The client identifier that the server issued. */
  readonly clientId: string;
  /** How the client authenticates at the token endpoint. */
  readonly authentication: ClientAuthentication;
}

/** The seconds that an assertion of `private_key_jwt` lasts unless the client says otherwise (a few minutes is the habit of LTI). */
const DEFAULT_ASSERTION_LIFETIME_SECONDS = 300;

/** The claims that RFC 7519 section 4.1 registers: an assertion sets them itself, so the claims of a client never name one. */
const REGISTERED_CLAIMS: readonly string[] = ["iss", "sub", "aud", "exp", "nbf", "iat", "jti"];

/** Checks the claims of an assertion, as a host passes them from JavaScript: JSON, and no registered claim. */
function checkAssertionClaims(value: unknown): asserts value is Readonly<Record<string, JsonValue>> {
  checkRecord(value, "The claims of the client must be an object");
  const registered = Object.keys(value).find((name) => REGISTERED_CLAIMS.includes(name));
  if (registered !== undefined) {
    throw new DataError(
      `The claims of the client must not name ${describe(registered)}, a claim that every assertion sets itself (RFC 7519 section 4.1).`,
    );
  }
  const copy = copyJson(value, "claims");
  if ("problem" in copy) throw new DataError(`The claims of the client must be JSON: ${copy.problem}.`);
}

/**
 * Checks a client, as a host passes it from JavaScript.
 *
 * @throws `DataError` when the client has no identifier, or its authentication is not one of the four methods with what the
 * method needs.
 */
export function checkOAuthClient(value: unknown): asserts value is OAuthClient {
  checkRecord(value, "The client must be an object");
  checkNonEmptyString(value.clientId, "The clientId of the client");
  const { authentication } = value;
  checkRecord(authentication, "The authentication of the client must be an object");
  switch (authentication.method) {
    case "client_secret_basic":
    case "client_secret_post":
      checkNonEmptyString(authentication.clientSecret, "The clientSecret of the client");
      break;
    case "private_key_jwt":
      checkSigner(authentication.signer, "The signer of the client");
      if (authentication.assertionLifetimeSeconds !== undefined) {
        checkPositiveInteger(authentication.assertionLifetimeSeconds, "The assertionLifetimeSeconds of the client");
      }
      if (authentication.claims !== undefined) checkAssertionClaims(authentication.claims);
      break;
    case "none":
      break;
    default:
      throw new DataError(
        `The authentication method of the client must be client_secret_basic, client_secret_post, private_key_jwt or none, found ${describe(authentication.method)}.`,
      );
  }
}

/** Describes the client to oauth4webapi. */
export function libraryClient(client: OAuthClient): oauth.Client {
  return { client_id: client.clientId };
}

/**
 * Builds the client authentication that oauth4webapi applies to each request of the client.
 *
 * @param server - Gives the default `aud` of an assertion.
 * @param client - The client, whose authentication has been checked.
 * @param options - Gives the clock and the signal that an assertion's signer receives.
 */
export function clientAuthentication(
  server: AuthorizationServer,
  client: OAuthClient,
  options: OAuthCallOptions,
): oauth.ClientAuth {
  const { authentication } = client;
  switch (authentication.method) {
    case "client_secret_basic":
      return oauth.ClientSecretBasic(authentication.clientSecret);
    case "client_secret_post":
      return oauth.ClientSecretPost(authentication.clientSecret);
    case "private_key_jwt":
      return privateKeyJwt({
        signer: authentication.signer,
        audience: server.audience ?? server.tokenEndpoint,
        lifetimeSeconds: authentication.assertionLifetimeSeconds ?? DEFAULT_ASSERTION_LIFETIME_SECONDS,
        claims: authentication.claims ?? {},
        clock: options.clock,
        options: { signal: options.signal },
      });
    case "none":
      return oauth.None();
  }
}
