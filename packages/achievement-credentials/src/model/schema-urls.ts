import type { CredentialSchema } from "./credentials.js";

/** The type of a data schema that names the JSON Schema which the credential conforms to (OB B.1.21). */
export const SCHEMA_TYPE = "1EdTechJsonSchemaValidator2019";

/** The `credentialSchema` that names the official JSON Schema of AchievementCredential (OB B.1.21). */
export const ACHIEVEMENT_CREDENTIAL_SCHEMA: CredentialSchema = {
  id: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_achievementcredential_schema.json",
  type: SCHEMA_TYPE,
};

/** The `credentialSchema` that names the official JSON Schema of EndorsementCredential. */
export const ENDORSEMENT_CREDENTIAL_SCHEMA: CredentialSchema = {
  id: "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/ob_v3p0_endorsementcredential_schema.json",
  type: SCHEMA_TYPE,
};

/** The `credentialSchema` that names the official JSON Schema of ClrCredential. */
export const CLR_CREDENTIAL_SCHEMA: CredentialSchema = {
  id: "https://purl.imsglobal.org/spec/clr/v2p0/schema/json/clr_v2p0_clrcredential_schema.json",
  type: SCHEMA_TYPE,
};

const OB_SCHEMAS = "https://purl.imsglobal.org/spec/ob/v3p0/schema/json/";
const CLR_SCHEMAS = "https://purl.imsglobal.org/spec/clr/v2p0/schema/json/";

/**
 * The addresses of the JSON Schemas of credentials that 1EdTech publishes, including those that accept a credential of either
 * data model. The readers of `read/` check what these schemas say, so a credential that names one of them needs no other check
 * of its schema.
 */
export const OFFICIAL_SCHEMA_IDS: readonly string[] = [
  `${OB_SCHEMAS}ob_v3p0_achievementcredential_schema.json`,
  `${OB_SCHEMAS}ob_v3p0_anyachievementcredential_schema.json`,
  `${OB_SCHEMAS}ob_v3p0_anyendorsementcredential_schema.json`,
  `${OB_SCHEMAS}ob_v3p0_endorsementcredential_schema.json`,
  `${CLR_SCHEMAS}clr_v2p0_achievementcredential_schema.json`,
  `${CLR_SCHEMAS}clr_v2p0_anyachievementcredential_schema.json`,
  `${CLR_SCHEMAS}clr_v2p0_anyclrcredential_schema.json`,
  `${CLR_SCHEMAS}clr_v2p0_anyendorsementcredential_schema.json`,
  `${CLR_SCHEMAS}clr_v2p0_clrcredential_schema.json`,
  `${CLR_SCHEMAS}clr_v2p0_endorsementcredential_schema.json`,
];
