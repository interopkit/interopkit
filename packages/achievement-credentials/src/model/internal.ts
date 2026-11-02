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

export {
  ACHIEVEMENT_CREDENTIAL_SCHEMA,
  CLR_CREDENTIAL_SCHEMA,
  ENDORSEMENT_CREDENTIAL_SCHEMA,
  OFFICIAL_SCHEMA_IDS,
  SCHEMA_TYPE,
} from "./schema-urls.js";
