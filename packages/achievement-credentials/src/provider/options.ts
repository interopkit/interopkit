import { type CallOptions, DataError } from "@interopkit/core";
import {
  guardSchema,
  isRecord,
  type JsonObject,
  MAX_JSON_TOKENS,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import { type AccessDecision, basePathSchema, type HttpRequest } from "@interopkit/core/http";
import * as v from "valibot";
import { CREDENTIAL_APIS, type CredentialApi, type ServiceDescriptionDocument } from "../model/index.js";
import { API_SCOPES } from "../model/internal.js";
import { readEntity } from "../read/index.js";
import { usableDescriptionSchema } from "../read/internal.js";
import { type VerifyOptions, verifySettings } from "../verify/internal.js";
import { type CredentialStore, credentialStoreSchema, type ProfileStore, profileStoreSchema } from "./store.js";

/**
 * The decision of `authorize` about a request: it may go on for the owner of the access token, or it is refused as not
 * authenticated (401), as not allowed (403), or as one request too many (429).
 */
export type CredentialsAccess = AccessDecision<{
  /** The user whose credentials and profile the request reaches: the resource owner of the access token. */
  readonly owner: string;
}>;

/** The options of `handleCredentialsRequest`. */
export interface CredentialsProviderOptions extends CallOptions {
  /** The API to serve: `"badges"` for the Open Badges API (`/ims/ob/v3p0`), or `"clr"` for the CLR Standard API (`/ims/clr/v2p0`). */
  readonly api: CredentialApi;
  /** Where the credentials of each user are kept. */
  readonly credentials: CredentialStore;
  /** Where the profile of each user is kept. */
  readonly profiles: ProfileStore;
  /**
   * Checks the access token of a request against the scope that its operation needs, and names the owner of the resources that
   * the token reaches; or refuses it with 401, 403 or 429. It is not asked for the service description, which is public.
   */
  readonly authorize: (request: HttpRequest, scope: string, options?: CallOptions) => Promise<CredentialsAccess>;
  /**
   * The service description that the provider serves at `/discovery` (OB 6.3): the OpenAPI file of the API, profiled, with the
   * name and the policies of the resource server and its authorization code flow, which offers every scope of the API. It is
   * checked each time it is served.
   */
  readonly serviceDescription: JsonObject;
  /**
   * The path the provider is mounted at, before `/ims/ob/v3p0` or `/ims/clr/v2p0`: `""` or a path that starts with `/` and
   * does not end with one. It is compared with the path of a request as `URL` writes that, percent-encoded, so `/café` and
   * `/caf%C3%A9` are one path.
   *
   * @defaultValue `""`
   */
  readonly basePath?: string;
  /**
   * The credentials in a page when the request has no `limit`. It is lowered to `maxPageSize` when it is above it.
   *
   * @defaultValue 100
   */
  readonly pageSize?: number;
  /**
   * The most credentials in a page; a `limit` above it is lowered to it.
   *
   * @defaultValue 1000
   */
  readonly maxPageSize?: number;
  /**
   * The most bytes of the body of a request. A larger body is answered 413 before it is read.
   *
   * @defaultValue 1,048,576
   */
  readonly maxBodyBytes?: number;
  /**
   * The most tokens of JSON in a body, or in the payload of a compact JWS: each bracket, brace, colon and comma, each string,
   * each number, and each of `true`, `false` and `null`. They are counted before the text is parsed, since the memory of a
   * parse grows with the tokens and not with the bytes.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
  /**
   * Verifies a credential before it is stored, with these options of `verifyCredential`; a credential that does not verify is
   * refused with 422. The refresh service of the credential is not followed, so the store keeps the credential that came.
   *
   * @defaultValue none: the credential is read and its kind checked, and its proof is not
   */
  readonly verify?: VerifyOptions;
}

/** The options of a provider with their defaults. */
export interface ProviderSettings {
  readonly api: CredentialApi;
  readonly credentials: CredentialStore;
  readonly profiles: ProfileStore;
  readonly authorize: CredentialsProviderOptions["authorize"];
  readonly serviceDescription: JsonObject;
  readonly basePath: string;
  readonly pageSize: number;
  readonly maxPageSize: number;
  readonly maxBodyBytes: number;
  readonly maxTokens: number;
  readonly verify: VerifyOptions | undefined;
  readonly signal: AbortSignal | undefined;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGE_SIZE = 1000;
/** The most bytes of a body: the size of the input that `verifyCredential` takes by default. */
const DEFAULT_MAX_BODY_BYTES = 1_048_576;

const optionsSchema = strictRecord({
  api: v.picklist(CREDENTIAL_APIS),
  credentials: credentialStoreSchema,
  profiles: profileStoreSchema,
  authorize: guardSchema(
    (value): value is CredentialsProviderOptions["authorize"] => typeof value === "function",
    "a function",
  ),
  serviceDescription: guardSchema((value): value is JsonObject => isRecord(value), "an object"),
  basePath: v.optional(basePathSchema),
  pageSize: v.optional(positiveIntegerSchema),
  maxPageSize: v.optional(positiveIntegerSchema),
  maxBodyBytes: v.optional(positiveIntegerSchema),
  maxTokens: v.optional(positiveIntegerSchema),
  verify: v.optional(guardSchema((value): value is VerifyOptions => isRecord(value), "an object")),
  signal: v.optional(guardSchema((value): value is AbortSignal => value instanceof AbortSignal, "an AbortSignal")),
});

/**
 * Reads the service description of the options, when the provider serves it: a ServiceDescriptionDocument of the model, made
 * of JSON, whose authorization code flow a client can use and offers every scope of the API, so that a client can register for
 * them.
 *
 * @returns A copy of the description, which shares nothing with the option.
 * @throws `DataError` that says what the description lacks.
 */
export function readDescription(settings: ProviderSettings): ServiceDescriptionDocument {
  const label = "The option serviceDescription";
  let description: ServiceDescriptionDocument;
  try {
    description = readEntity("ServiceDescriptionDocument", settings.serviceDescription);
  } catch (error) {
    throw new DataError(
      `${label} is not a service description: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const usable = parseWith(usableDescriptionSchema, description, label);
  const offered = usable.components.securitySchemes.OAuth2ACG.flows.authorizationCode.scopes;
  const missing = Object.values(API_SCOPES[settings.api]).filter((scope) => !Object.hasOwn(offered, scope));
  if (missing.length > 0) {
    throw new DataError(
      `${label} must offer every scope of the API in its authorization code flow, and lacks ${missing.join(", ")}.`,
    );
  }
  return description;
}

/**
 * Checks the options of a provider and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readProviderOptions(options: unknown): ProviderSettings {
  const read = parseWith(optionsSchema, options, "The provider options");
  // The options of the verifier are checked here, so that a wrong one is found on the first request and not on the first upsert.
  if (read.verify !== undefined) verifySettings(read.verify);
  return {
    api: read.api,
    credentials: read.credentials,
    profiles: read.profiles,
    authorize: read.authorize,
    serviceDescription: read.serviceDescription,
    basePath: read.basePath ?? "",
    pageSize: read.pageSize ?? DEFAULT_PAGE_SIZE,
    maxPageSize: read.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE,
    maxBodyBytes: read.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    maxTokens: read.maxTokens ?? MAX_JSON_TOKENS,
    verify: read.verify,
    signal: read.signal,
  };
}
