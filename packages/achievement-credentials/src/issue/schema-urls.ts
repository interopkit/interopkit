import type { CredentialSchema } from "../model/index.js";

/** The type of a data schema that names the JSON Schema which the credential conforms to (OB B.1.21). */
const SCHEMA_TYPE = "1EdTechJsonSchemaValidator2019";

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
