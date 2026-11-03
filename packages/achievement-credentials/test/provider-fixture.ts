/**
 * A resource server for the tests of the provider: stores in memory that compare credentials as Open Badges 10 says, an
 * `authorize` that reads bearer tokens, a service description, and requests.
 */
import type { CallOptions } from "@interopkit/core";
import type { JsonObject } from "@interopkit/core/checks";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import {
  type CredentialApi,
  type IssuableCredential,
  isSameCredential,
  type Profile,
  readEntity,
  selectNewerCredential,
} from "../src/index.js";
import type {
  CredentialList,
  CredentialStore,
  CredentialsAccess,
  CredentialsPage,
  CredentialsProviderOptions,
  ProfileStore,
  ReceivedCredential,
  UpsertOutcome,
} from "../src/provider/index.js";

export const ORIGIN = "https://badges.example.org";
export const ROOTS: Readonly<Record<CredentialApi, string>> = { badges: "/ims/ob/v3p0", clr: "/ims/clr/v2p0" };

/** The scopes of each operation, as the tables of OB 6.2.1 and CLR 5.2.1 print them. */
export const SCOPES = {
  badges: {
    getCredentials: "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.readonly",
    upsertCredential: "https://purl.imsglobal.org/spec/ob/v3p0/scope/credential.upsert",
    getProfile: "https://purl.imsglobal.org/spec/ob/v3p0/scope/profile.readonly",
    putProfile: "https://purl.imsglobal.org/spec/ob/v3p0/scope/profile.update",
  },
  clr: {
    getCredentials: "https://purl.imsglobal.org/spec/clr/v2p0/scope/credential.readonly",
    upsertCredential: "https://purl.imsglobal.org/spec/clr/v2p0/scope/credential.upsert",
    getProfile: "https://purl.imsglobal.org/spec/clr/v2p0/scope/profile.readonly",
    putProfile: "https://purl.imsglobal.org/spec/clr/v2p0/scope/profile.update",
  },
} as const;

/**
 * The service description of the example of OB 6.3, with `https` addresses, its name and policies in `info` as OB B.4.1 puts
 * them, and the scopes of an API.
 */
export function description(api: CredentialApi = "badges"): JsonObject {
  return {
    openapi: "3.0.1",
    info: {
      title: "Example Provider",
      version: "1.0",
      termsOfService: "https://provider.example.com/terms",
      "x-imssf-privacyPolicyUrl": "https://provider.example.com/privacy",
    },
    components: {
      securitySchemes: {
        OAuth2ACG: {
          type: "oauth2",
          description: "OAuth 2.0 Authorization Code Grant authorization",
          "x-imssf-registrationUrl": "https://provider.example.com/registration",
          flows: {
            authorizationCode: {
              tokenUrl: "https://provider.example.com/token",
              authorizationUrl: "https://provider.example.com/authorize",
              refreshUrl: "https://provider.example.com/token",
              scopes: Object.fromEntries(Object.values(SCOPES[api]).map((scope) => [scope, "..."])),
            },
          },
        },
      },
    },
  };
}

/** The access tokens that the test authorization server issued: the owner and the scopes of each. */
const TOKENS: Readonly<Record<string, { readonly owner: string; readonly scopes: readonly string[] }>> = {
  "token-all": { owner: "learner-1", scopes: [...Object.values(SCOPES.badges), ...Object.values(SCOPES.clr)] },
  "token-read": { owner: "learner-1", scopes: [SCOPES.badges.getCredentials, SCOPES.clr.getCredentials] },
  "token-other": { owner: "learner-2", scopes: [...Object.values(SCOPES.badges), ...Object.values(SCOPES.clr)] },
};

/** A call to a port, as the test saw it. */
export interface Asked {
  readonly port: string;
  readonly argument: unknown;
  readonly signal: AbortSignal | undefined;
}

/** Checks a bearer token as RFC 6750 sends it: unknown is 401, a token without the scope is 403. */
export function bearerAuthorize(asked: Asked[] = []): CredentialsProviderOptions["authorize"] {
  return async (request, scope, options) => {
    asked.push({ port: "authorize", argument: scope, signal: options?.signal });
    const token = /^Bearer (\S+)$/u.exec(request.headers.authorization ?? "")?.[1];
    const grant = token === undefined ? undefined : TOKENS[token];
    if (grant === undefined) return { allowed: false, status: 401 } satisfies CredentialsAccess;
    if (!grant.scopes.includes(scope)) return { allowed: false, status: 403 } satisfies CredentialsAccess;
    return { allowed: true, owner: grant.owner } satisfies CredentialsAccess;
  };
}

/** The credentials and profiles that the stores of a test hold, by owner. */
interface Held {
  readonly credentials: Map<string, ReceivedCredential[]>;
  readonly profiles: Map<string, Profile>;
}

/**
 * Stores in memory that do what the ports promise: an upsert finds the same credential with `isSameCredential` and keeps the
 * newer with `selectNewerCredential`; a list pages in the order of arrival and counts unless told not to.
 */
export function memoryStores(options: { readonly count?: boolean; readonly asked?: Asked[] } = {}) {
  const { count = true, asked = [] } = options;
  const held: Held = { credentials: new Map(), profiles: new Map() };
  const record = (port: string, argument: unknown, call?: CallOptions) =>
    asked.push({ port, argument, signal: call?.signal });
  const credentials: CredentialStore = {
    async list(owner: string, page: CredentialsPage, call?: CallOptions): Promise<CredentialList> {
      record("list", { owner, page }, call);
      const mine = (held.credentials.get(owner) ?? []).filter(
        ({ credential }) =>
          page.since === undefined ||
          ("validFrom" in credential && Date.parse(String(credential.validFrom)) > Date.parse(page.since)),
      );
      const slice = mine.slice(page.offset, page.offset + page.limit).map(({ received }) => received);
      return count ? { credentials: slice, total: mine.length } : { credentials: slice };
    },
    async upsert(owner: string, received: ReceivedCredential, call?: CallOptions): Promise<UpsertOutcome> {
      record("upsert", { owner, received }, call);
      const mine = held.credentials.get(owner) ?? [];
      const index = mine.findIndex((each) => isSameCredential(each.credential, received.credential));
      const found = mine[index];
      if (found === undefined) {
        held.credentials.set(owner, [...mine, received]);
        return "created";
      }
      const kept = selectNewerCredential(
        found.credential as IssuableCredential,
        received.credential as IssuableCredential,
      );
      if (kept === found.credential) return "unchanged";
      mine[index] = received;
      return "replaced";
    },
  };
  const profiles: ProfileStore = {
    async get(owner: string, call?: CallOptions) {
      record("get", { owner }, call);
      return held.profiles.get(owner);
    },
    async put(owner: string, profile: Profile, call?: CallOptions) {
      record("put", { owner, profile }, call);
      held.profiles.set(owner, profile);
      return profile;
    },
  };
  return { credentials, profiles, held, asked };
}

const encoder = new TextEncoder();

/** A request to the provider, with the token of the test that may reach everything unless another is given. */
export function request(
  method: string,
  path: string,
  init: { readonly body?: string | Uint8Array; readonly type?: string; readonly token?: string | null } = {},
): HttpRequest {
  const { body = "", type, token = "token-all" } = init;
  return {
    method,
    url: `${ORIGIN}${path}`,
    headers: {
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      ...(type === undefined ? {} : { "content-type": type }),
    },
    body: typeof body === "string" ? encoder.encode(body) : body,
  };
}

/** The options of a provider of an API over fresh stores, with the bearer `authorize`. */
export function serving(api: CredentialApi = "badges", extra: Partial<CredentialsProviderOptions> = {}) {
  const stores = memoryStores();
  const options: CredentialsProviderOptions = {
    api,
    credentials: stores.credentials,
    profiles: stores.profiles,
    authorize: bearerAuthorize(stores.asked),
    serviceDescription: description(api),
    ...extra,
  };
  return { options, ...stores };
}

/** The body of an answer as JSON. */
export const jsonOf = (response: HttpResponse): unknown => JSON.parse(String(response.body));

/** The code of the detail of the `imsx_StatusInfo` of an answer, read with the reader of the package. */
export function minorOf(response: HttpResponse): string | undefined {
  const status = readEntity("imsx_StatusInfo", jsonOf(response));
  return status.imsx_codeMinor?.imsx_codeMinorField[0]?.imsx_codeMinorFieldValue;
}
