import type { Signer } from "@interopkit/core";
import {
  checkRemoteUrl,
  describe,
  httpsUrlSchema,
  isRecord,
  looseRecord,
  nonEmptyStringSchema,
  parseWith,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { LtiError } from "../errors.js";
import { APPROVED_ALGORITHMS, type JwsAlgorithm } from "../protocol/index.js";
import { checkLtiSigner } from "../protocol/internal.js";

/** The host's record of one platform that the tool trusts, as the platform's administrator and the tool agreed on it. */
export interface PlatformRegistration {
  /** The issuer identifier of the platform: the `iss` of its tokens, an `https` URL without query or fragment. */
  readonly issuer: string;
  /** The OAuth 2.0 client identifier that the platform gave the tool. */
  readonly clientId: string;
  /** The deployments of the tool at the platform that it accepts: the `deployment_id` of a launch must be one of them. */
  readonly deploymentIds: readonly string[];
  /** The OpenID Connect authentication endpoint of the platform, to which the tool redirects the browser. */
  readonly authenticationUrl: string;
  /** The URL of the platform's JSON Web Key Set, which holds the keys that sign its tokens. */
  readonly jwksUrl: string;
  /** The OAuth 2.0 token endpoint of the platform, where the tool requests access tokens for its services. */
  readonly accessTokenUrl: string;
  /**
   * The `aud` of the client assertion, for a platform that wants a value other than its token endpoint (LTI 1.3 Core section
   * 6.2.1 has the audience be the authorization server's token URL, and some platforms name themselves instead).
   *
   * @defaultValue `accessTokenUrl`
   */
  readonly audience?: string | undefined;
  /** The tool's launch URL, which the platform knows as a redirect URI. The authorization response is posted to it. */
  readonly redirectUri: string;
  /**
   * Signs the tool's client assertions and Deep Linking responses, with one of `APPROVED_ALGORITHMS` and a `keyId` that is the
   * `kid` of the tool's public key in the key set that the platform reads. A key in a KMS or an HSM works.
   */
  readonly signer: Signer;
  /**
   * The algorithms that the tool accepts on the platform's tokens.
   *
   * @defaultValue `APPROVED_ALGORITHMS`
   */
  readonly algorithms?: readonly JwsAlgorithm[] | undefined;
  /**
   * The audiences besides the client identifier that an `id_token` of the platform may name (Security Framework section
   * 5.1.3). Any other member of `aud` is refused.
   *
   * @defaultValue none
   */
  readonly trustedAudiences?: readonly string[] | undefined;
  /**
   * The origins, such as `https://lms.example.edu`, that the URLs of the platform's services may have. When given, a service
   * URL of a launch on another origin is refused, and one on a listed origin passes even when `checkRemoteUrl` would refuse it,
   * as for a platform on a private network.
   *
   * @defaultValue any origin that `checkRemoteUrl` of `@interopkit/core/checks` accepts
   */
  readonly serviceOrigins?: readonly string[] | undefined;
}

/** An `https` origin as `URL` writes it: a scheme, a host and a port that is not the default, with no path. */
const originSchema = v.pipe(
  httpsUrlSchema,
  v.check(
    (text) => new URL(text).origin === text,
    (issue) => `expected an https origin such as "https://lms.example.edu", found ${issue.received}`,
  ),
);

const registrationSchema = looseRecord({
  issuer: v.pipe(
    httpsUrlSchema,
    v.check(
      (issuer) => new URL(issuer).search === "" && new URL(issuer).hash === "",
      (issue) => `expected an issuer without a query or a fragment, found ${issue.received}`,
    ),
  ),
  clientId: nonEmptyStringSchema,
  deploymentIds: v.pipe(v.array(nonEmptyStringSchema), v.minLength(1)),
  authenticationUrl: httpsUrlSchema,
  jwksUrl: httpsUrlSchema,
  accessTokenUrl: httpsUrlSchema,
  audience: v.optional(nonEmptyStringSchema),
  redirectUri: httpsUrlSchema,
  algorithms: v.optional(v.pipe(v.array(v.picklist(APPROVED_ALGORITHMS)), v.minLength(1))),
  trustedAudiences: v.optional(v.array(nonEmptyStringSchema)),
  serviceOrigins: v.optional(v.pipe(v.array(originSchema), v.minLength(1))),
});

/**
 * Checks a registration that the host's lookup returned.
 *
 * @throws `DataError` when it is not a registration: a field is missing or of the wrong type, a URL is not `https`, the
 * issuer has a query or a fragment, an algorithm is not approved, a service origin is not an `https` origin, or the signer has
 * no approved algorithm, no function `sign` or no `keyId`.
 */
export function checkPlatformRegistration(value: unknown): asserts value is PlatformRegistration {
  parseWith(registrationSchema, value, "The registration");
  checkLtiSigner(isRecord(value) ? value.signer : undefined, "The signer of the registration");
}

/**
 * Checks that a service URL of a launch may receive the tool's bearer token: on one of the registration's `serviceOrigins`
 * when it has them, else an `https` URL that names a public host.
 *
 * @param url - The URL, from a claim of the launch.
 * @param registration - The registration of the platform that sent the launch.
 * @param label - Names the URL in the error message, such as `The line item of the launch`.
 * @throws `LtiError` (`service-origin-refused`) when it may not.
 */
export function checkServiceUrl(url: string, registration: PlatformRegistration, label: string): void {
  const { serviceOrigins } = registration;
  if (serviceOrigins !== undefined) {
    if (!serviceOrigins.includes(new URL(url).origin)) {
      throw new LtiError(
        `${label} must be on one of the service origins of the registration, ${serviceOrigins.join(", ")}, found ${describe(url)}.`,
        "service-origin-refused",
      );
    }
    return;
  }
  try {
    checkRemoteUrl(url, label);
  } catch (error) {
    throw new LtiError(
      `${error instanceof Error ? error.message : String(error)} A platform on a private network names its origins in the serviceOrigins of the registration.`,
      "service-origin-refused",
    );
  }
}
