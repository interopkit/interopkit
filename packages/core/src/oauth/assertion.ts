import type * as oauth from "oauth4webapi";
import type { CallOptions } from "../call-options.js";
import type { JsonValue } from "../checks.js";
import { type Clock, readClock } from "../clock.js";
import { type Signer, signCompactJws } from "../signer/index.js";
import { MILLISECONDS_PER_SECOND } from "./time.js";

/** The `client_assertion_type` of an assertion that is a JWT (RFC 7523 section 2.2). */
const JWT_BEARER_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

const encoder = new TextEncoder();

/** What `private_key_jwt` signs and when. */
export interface AssertionOptions {
  /** Signs the assertion. */
  readonly signer: Signer;
  /** The `aud` of the assertion. */
  readonly audience: string;
  /** The seconds from `iat` to `exp`. */
  readonly lifetimeSeconds: number;
  /** The claims besides the registered ones, which the client has checked. */
  readonly claims: Readonly<Record<string, JsonValue>>;
  /** Gives `iat` and `exp`. */
  readonly clock: Clock;
  /** Ends the wait for the signer. */
  readonly options: CallOptions;
}

/**
 * Builds the client authentication of `private_key_jwt` over a signer: each request gets a new assertion with the claims of
 * the client, `iss` and `sub` of the client, the audience, `iat` and `exp` from the clock, and a fresh `jti`. The `kid` is
 * the `keyId` of the signer.
 */
export function privateKeyJwt({
  signer,
  audience,
  lifetimeSeconds,
  claims: more,
  clock,
  options,
}: AssertionOptions): oauth.ClientAuth {
  return async (_server, client, body) => {
    const issuedAt = Math.floor(readClock(clock) / MILLISECONDS_PER_SECOND);
    const claims = {
      ...more,
      iss: client.client_id,
      sub: client.client_id,
      aud: audience,
      jti: crypto.randomUUID(),
      iat: issuedAt,
      exp: issuedAt + lifetimeSeconds,
    };
    const assertion = await signCompactJws({ typ: "JWT" }, encoder.encode(JSON.stringify(claims)), signer, options);
    body.set("client_id", client.client_id);
    body.set("client_assertion_type", JWT_BEARER_ASSERTION_TYPE);
    body.set("client_assertion", assertion);
  };
}
