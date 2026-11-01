/**
 * The schemas that read the models of the Open Badges and CLR APIs: the answers of getCredentials, the status of an answer and the service description.
 *
 * @module
 */

import { openRecord, type Schema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type {
  GetOpenBadgeCredentialsResponse,
  ImsxCodeMinor,
  ImsxCodeMinorField,
  ImsxStatusInfo,
  OpenApiComponents,
  OpenApiInfo,
  OpenApiOAuth2SecurityScheme,
  OpenApiSecuritySchemes,
  ServiceDescriptionDocument,
} from "../model/index.js";
import { STATUS_CODES_MAJOR, STATUS_CODES_MINOR, STATUS_SEVERITIES } from "../model/index.js";
import { achievementCredentialSchema } from "./credential-schemas.js";
import { jws, many, ref, text } from "./primitives.js";

export const getOpenBadgeCredentialsResponseSchema: Schema<GetOpenBadgeCredentialsResponse> = strictRecord({
  credential: v.optional(many(ref(() => achievementCredentialSchema))),
  compactJwsString: v.optional(many(jws)),
});

export const imsxStatusInfoSchema: Schema<ImsxStatusInfo> = strictRecord({
  imsx_codeMajor: v.picklist(STATUS_CODES_MAJOR),
  imsx_severity: v.picklist(STATUS_SEVERITIES),
  imsx_description: v.optional(text),
  imsx_codeMinor: v.optional(ref(() => imsxCodeMinorSchema)),
});

export const imsxCodeMinorSchema: Schema<ImsxCodeMinor> = strictRecord({
  imsx_codeMinorField: many(
    ref(() => imsxCodeMinorFieldSchema),
    1,
  ),
});

export const imsxCodeMinorFieldSchema: Schema<ImsxCodeMinorField> = strictRecord({
  imsx_codeMinorFieldName: text,
  imsx_codeMinorFieldValue: v.picklist(STATUS_CODES_MINOR),
});

export const serviceDescriptionDocumentSchema: Schema<ServiceDescriptionDocument> = openRecord({
  openapi: text,
  info: ref(() => openApiInfoSchema),
  components: ref(() => openApiComponentsSchema),
});

export const openApiInfoSchema: Schema<OpenApiInfo> = openRecord({
  termsOfService: text,
  title: text,
  version: text,
  "x-imssf-image": v.optional(text),
  "x-imssf-privacyPolicyUrl": text,
});

export const openApiComponentsSchema: Schema<OpenApiComponents> = openRecord({
  securitySchemes: ref(() => openApiSecuritySchemesSchema),
});

export const openApiSecuritySchemesSchema: Schema<OpenApiSecuritySchemes> = strictRecord({
  OAuth2ACG: v.optional(ref(() => openApiOAuth2SecuritySchemeSchema)),
});

export const openApiOAuth2SecuritySchemeSchema: Schema<OpenApiOAuth2SecurityScheme> = openRecord({
  type: text,
  description: v.optional(text),
  "x-imssf-registrationUrl": text,
});
