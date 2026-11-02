import { type CallOptions, DEFAULT_TIMEOUT_MS, type Fetch, requestService } from "@interopkit/core";
import { guardSchema, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { CREDENTIAL_APIS, type CredentialApi } from "../model/index.js";
import { usableDescriptionSchema } from "../read/internal.js";
import { apiRoot } from "./config.js";
import { jsonOf, textOf } from "./request.js";

/**
 * The most bytes of a service description. The one that the specifications print is a profiled OpenAPI file with every
 * schema of the API, a few hundred kilobytes at most; this is the limit of the package's other fetches.
 */
const DISCOVERY_MAX_BYTES = 1_048_576;

/** What a client needs of a resource server to register with its authorization server and ask for tokens. */
export interface ServiceDescription {
  /** The name of the resource server (`info.title`). */
  readonly title: string;
  /** The token endpoint (`tokenUrl` of the authorization code flow). */
  readonly tokenUrl: string;
  /** The authorization endpoint (`authorizationUrl` of the authorization code flow). */
  readonly authorizationUrl: string;
  /** The endpoint of dynamic client registration (`x-imssf-registrationUrl`). */
  readonly registrationUrl: string;
  /** The scopes that the server offers: the keys of `scopes` of the authorization code flow. */
  readonly scopes: readonly string[];
  /** The privacy policy of the resource server (`x-imssf-privacyPolicyUrl`). */
  readonly privacyPolicyUrl: string;
  /**
   * The refresh endpoint (`refreshUrl`), which the specifications' examples set to the token endpoint.
   *
   * @defaultValue none
   */
  readonly refreshUrl?: string;
  /**
   * The terms of service of the resource server (`info.termsOfService`).
   *
   * @defaultValue none
   */
  readonly termsOfServiceUrl?: string;
  /**
   * An image of the resource server, as a URL or a data URI (`x-imssf-image`).
   *
   * @defaultValue none
   */
  readonly image?: string;
}

/** What `discoverService` needs besides the address. */
export interface DiscoverOptions extends CallOptions {
  /** The `fetch` that makes the request: the global one, or a replacement. */
  readonly fetch: Fetch;
  /**
   * The most time in milliseconds that the request may take.
   *
   * @defaultValue 10,000
   */
  readonly timeoutMs?: number;
}

const optionsSchema = strictRecord({
  fetch: guardSchema((value): value is Fetch => typeof value === "function", "a function"),
  timeoutMs: v.optional(positiveIntegerSchema),
  signal: v.optional(guardSchema((value): value is AbortSignal => value instanceof AbortSignal, "an AbortSignal")),
});

/**
 * Fetches the service description of an Open Badges or CLR resource server and reads what a client needs to register: the
 * endpoints of the authorization code flow, the scopes, and the policies.
 *
 * @remarks
 * The request is `GET {baseUrl}/ims/ob/v3p0/discovery` or `GET {baseUrl}/ims/clr/v2p0/discovery`, which the specifications
 * do not protect (OB 6.3). It goes through `requestService` of `@interopkit/core`: it follows no redirect, ends at `timeoutMs`
 * and reads at most 1,048,576 bytes. The answer is JSON of at most 64 levels; every address in it must be an absolute `https`
 * URL, and the server must offer the authorization code flow (`OAuth2ACG`). Pass `tokenUrl`, `authorizationUrl` and
 * `registrationUrl` to the OAuth clients of `@interopkit/core/oauth`. The client does not cache the answer; the host may keep
 * it as long as `Cache-Control` and `Expires` of the answer allow. The specifications name no property for the revocation
 * endpoint, so the host supplies it.
 *
 * @param baseUrl - The address of the resource server before the path of the API, such as `https://badges.example.org`.
 * @param api - The API whose service description to fetch.
 * @param options - The `fetch`, the time it may take, and a `signal` that ends the wait.
 * @returns What the client needs of the service description.
 * @throws `DataError` when an argument is not valid, or the answer is not a service description that offers the authorization
 * code flow.
 * @throws `ServiceError` when the server did not answer, answered with a status other than 200, answered a redirect, or
 * answered more than the limit.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#service-discovery-endpoint | Open Badges 3.0, Service Discovery Endpoint}
 */
export async function discoverService(
  baseUrl: string,
  api: CredentialApi,
  options: DiscoverOptions,
): Promise<ServiceDescription> {
  const checked = parseWith(optionsSchema, options, "The options of discoverService");
  const kind = parseWith(v.picklist(CREDENTIAL_APIS), api, "The api");
  const url = `${apiRoot(baseUrl, kind, "The baseUrl")}/discovery`;
  const what = `The service description at ${url}`;
  const { fetch, timeoutMs = DEFAULT_TIMEOUT_MS, signal } = checked;
  const response = await requestService(
    { fetch, timeoutMs, ...(signal === undefined ? {} : { signal }) },
    what,
    url,
    { method: "GET", headers: { accept: "application/json" } },
    { maxBytes: DISCOVERY_MAX_BYTES, expect: [200] },
  );
  const json = jsonOf(textOf(response, what), what);
  const { info, components } = parseWith(usableDescriptionSchema, json, what);
  const scheme = components.securitySchemes.OAuth2ACG;
  const flow = scheme.flows.authorizationCode;
  return {
    title: info.title,
    tokenUrl: flow.tokenUrl,
    authorizationUrl: flow.authorizationUrl,
    registrationUrl: scheme["x-imssf-registrationUrl"],
    scopes: Object.keys(flow.scopes),
    privacyPolicyUrl: info["x-imssf-privacyPolicyUrl"],
    ...(flow.refreshUrl === undefined ? {} : { refreshUrl: flow.refreshUrl }),
    ...(info.termsOfService === undefined ? {} : { termsOfServiceUrl: info.termsOfService }),
    ...(info["x-imssf-image"] === undefined ? {} : { image: info["x-imssf-image"] }),
  };
}
