/**
 * What the other modules and the tests share of `model` and the package does not export.
 *
 * @module
 */
import type { CredentialApi } from "./api.js";

/** The path below the base of a service on which every endpoint of an API sits (OB 6.2, CLR 5.2). */
export const API_PATHS: Readonly<Record<CredentialApi, string>> = {
  badges: "/ims/ob/v3p0",
  clr: "/ims/clr/v2p0",
};

/** The operations of an API that an access token must hold a scope for (OB 6.2.1, CLR 5.2.1). */
export type ScopedOperation = "getCredentials" | "upsertCredential" | "getProfile" | "putProfile";

/** The scope that each operation of each API asks of an access token (OB 6.2.1, CLR 5.2.1). */
export const API_SCOPES: Readonly<Record<CredentialApi, Readonly<Record<ScopedOperation, string>>>> = {
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
};

export {
  ACHIEVEMENT_CREDENTIAL_SCHEMA,
  CLR_CREDENTIAL_SCHEMA,
  ENDORSEMENT_CREDENTIAL_SCHEMA,
  OFFICIAL_SCHEMA_IDS,
  SCHEMA_TYPE,
} from "./schema-urls.js";
