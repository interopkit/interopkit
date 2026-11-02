// biome-ignore-all lint/style/useNamingConvention: The names of the claims are those of the LTI specifications.

import { jsonObjectSchema, looseRecord, mapSchema } from "@interopkit/core/checks";
import * as v from "valibot";
import { BOOLEAN, HTTPS_URL, IDENTIFIER, NULLABLE_STRING, NUMBER, STRING, STRING_ARRAY } from "../claims/index.js";
import type {
  ActualUser,
  AssessmentControlClaim,
  ContextClaim,
  DeepLinkingSettings,
  ForUser,
  GradesClaim,
  GroupsClaim,
  LaunchPresentation,
  MigrationClaim,
  OrganizationClaim,
  PlatformInstance,
  PreferencesClaim,
  ProctoringSettings,
  RosterClaim,
  UserIdentity,
} from "./model.js";

// Canvas sends `null` for a string it has no value for (`title`, `description`, `person_sourcedid`), and LTI 1.3 Core has them
// as strings, so a `null` is read as absent.
const TEXT = NULLABLE_STRING;

/** The identity claims of OpenID Connect that LTI messages use, beside `sub`. */
const identityEntries = {
  name: TEXT,
  given_name: TEXT,
  family_name: TEXT,
  middle_name: TEXT,
  email: TEXT,
  email_verified: v.optional(BOOLEAN),
  picture: TEXT,
  locale: TEXT,
};

/** The claims of a user at the top of a message: `sub` and the identity claims (LTI 1.3 Core section 5.3.6). */
export const userSchema = v.pipe(
  looseRecord({ sub: v.optional(IDENTIFIER), ...identityEntries }),
  v.transform(
    (claims): UserIdentity => ({
      subject: claims.sub,
      name: claims.name,
      givenName: claims.given_name,
      familyName: claims.family_name,
      middleName: claims.middle_name,
      email: claims.email,
      emailVerified: claims.email_verified,
      picture: claims.picture,
      locale: claims.locale,
    }),
  ),
);

/** The identity claims of a user without the subject, such as those the proctoring tool verified. */
export const verifiedUserSchema = v.pipe(
  looseRecord(identityEntries),
  v.transform(
    (claims): Omit<UserIdentity, "subject"> => ({
      name: claims.name,
      givenName: claims.given_name,
      familyName: claims.family_name,
      middleName: claims.middle_name,
      email: claims.email,
      emailVerified: claims.email_verified,
      picture: claims.picture,
      locale: claims.locale,
    }),
  ),
);

/** The `actual_user` claim (LTI 1.3 Core section 5.3.6.2): the identity of the person acting, and their roles. */
export const actualUserSchema = v.pipe(
  looseRecord({ id: IDENTIFIER, roles: v.optional(STRING_ARRAY), ...identityEntries }),
  v.transform(
    (claim): ActualUser => ({
      id: claim.id,
      roles: claim.roles,
      name: claim.name,
      givenName: claim.given_name,
      familyName: claim.family_name,
      middleName: claim.middle_name,
      email: claim.email,
      emailVerified: claim.email_verified,
      picture: claim.picture,
      locale: claim.locale,
    }),
  ),
);

/** The context claim (LTI 1.3 Core section 5.4.1). */
export const contextSchema = v.pipe(
  looseRecord({ id: IDENTIFIER, label: TEXT, title: TEXT, type: v.optional(STRING_ARRAY) }),
  v.transform((claim): ContextClaim => ({ id: claim.id, label: claim.label, title: claim.title, type: claim.type })),
);

/** The organization claim (LTI 1.3 Core section 5.4.2). */
export const organizationSchema = v.pipe(
  looseRecord({ id: IDENTIFIER, type: TEXT, name: TEXT, description: TEXT, url: TEXT }),
  v.transform(
    (claim): OrganizationClaim => ({
      id: claim.id,
      type: claim.type,
      name: claim.name,
      description: claim.description,
      url: claim.url,
    }),
  ),
);

/** The platform instance claim (LTI 1.3 Core section 5.4.3). */
export const platformInstanceSchema = v.pipe(
  looseRecord({
    guid: IDENTIFIER,
    contact_email: TEXT,
    description: TEXT,
    name: TEXT,
    url: TEXT,
    product_family_code: TEXT,
    version: TEXT,
  }),
  v.transform(
    (claim): PlatformInstance => ({
      guid: claim.guid,
      contactEmail: claim.contact_email,
      description: claim.description,
      name: claim.name,
      url: claim.url,
      productFamilyCode: claim.product_family_code,
      version: claim.version,
    }),
  ),
);

/** The launch presentation claim (LTI 1.3 Core section 5.4.5). */
export const presentationSchema = v.pipe(
  looseRecord({
    document_target: v.optional(v.picklist(["frame", "iframe", "window"])),
    height: v.optional(NUMBER),
    width: v.optional(NUMBER),
    return_url: v.optional(HTTPS_URL),
    locale: TEXT,
  }),
  v.transform(
    (claim): LaunchPresentation => ({
      documentTarget: claim.document_target,
      height: claim.height,
      width: claim.width,
      returnUrl: claim.return_url,
      locale: claim.locale,
    }),
  ),
);

/**
 * The LIS claim (LTI 1.3 Core section 5.4.4): an object of strings, whose members that are `null` are absent. Canvas sends
 * `person_sourcedid` as `null` when it has none.
 */
export const lisSchema = v.pipe(
  mapSchema(v.nullish(v.string())),
  v.transform((claim): Readonly<Record<string, string>> => {
    const members: [string, string][] = [];
    for (const [name, member] of claim) if (typeof member === "string") members.push([name, member]);
    return Object.fromEntries(members);
  }),
);

/** The `for_user` claim of a Submission Review request (Submission Review 1.0 section 2.7). */
export const forUserSchema = v.pipe(
  looseRecord({
    user_id: IDENTIFIER,
    person_sourcedid: TEXT,
    given_name: TEXT,
    family_name: TEXT,
    name: TEXT,
    email: TEXT,
    roles: v.optional(STRING_ARRAY),
  }),
  v.transform(
    (claim): ForUser => ({
      userId: claim.user_id,
      personSourcedId: claim.person_sourcedid,
      givenName: claim.given_name,
      familyName: claim.family_name,
      name: claim.name,
      email: claim.email,
      roles: claim.roles,
    }),
  ),
);

/** The `lti1p1` claim (LTI Migration Guide, LTI 1.1 migration claim). */
export const migrationSchema = v.pipe(
  looseRecord({
    user_id: TEXT,
    context_id: TEXT,
    tool_consumer_instance_guid: TEXT,
    resource_link_id: TEXT,
    oauth_consumer_key: v.pipe(STRING, v.nonEmpty()),
    oauth_consumer_key_sign: TEXT,
  }),
  v.transform(
    (claim): MigrationClaim => ({
      userId: claim.user_id,
      contextId: claim.context_id,
      toolConsumerInstanceGuid: claim.tool_consumer_instance_guid,
      resourceLinkId: claim.resource_link_id,
      oauthConsumerKey: claim.oauth_consumer_key,
      oauthConsumerKeySign: claim.oauth_consumer_key_sign,
    }),
  ),
);

/** An address of a service; LTI AGS 2.0 section 3.1 lets a platform leave `lineitem` blank or `null`. */
const SERVICE_URL = v.pipe(
  v.optional(v.nullable(v.string())),
  v.check(
    (url) => url === undefined || url === null || url === "" || v.is(HTTPS_URL, url),
    (issue) => `expected an absolute https URL, found ${issue.received}`,
  ),
  v.transform((url) => (url === null || url === "" ? undefined : url)),
);

/** The endpoint claim of the Assignment and Grade Services (LTI AGS 2.0 section 3.1). */
export const gradesSchema = v.pipe(
  looseRecord({ scope: v.optional(STRING_ARRAY), lineitems: SERVICE_URL, lineitem: SERVICE_URL }),
  v.transform(
    (claim): GradesClaim => ({ scopes: claim.scope ?? [], lineitems: claim.lineitems, lineitem: claim.lineitem }),
  ),
);

/** The claim of Names and Role Provisioning (NRPS 2.0 section 4.1). */
export const rosterSchema = v.pipe(
  looseRecord({ context_memberships_url: HTTPS_URL, service_versions: v.optional(STRING_ARRAY) }),
  v.transform(
    (claim): RosterClaim => ({
      contextMembershipsUrl: claim.context_memberships_url,
      serviceVersions: claim.service_versions,
    }),
  ),
);

/** The claim of Context Groups (Context Groups 1.0 section 2.5). */
export const groupsSchema = v.pipe(
  looseRecord({
    context_groups_url: HTTPS_URL,
    context_group_sets_url: v.optional(HTTPS_URL),
    scope: STRING_ARRAY,
    service_versions: STRING_ARRAY,
  }),
  v.transform(
    (claim): GroupsClaim => ({
      contextGroupsUrl: claim.context_groups_url,
      contextGroupSetsUrl: claim.context_group_sets_url,
      scopes: claim.scope,
      serviceVersions: claim.service_versions,
    }),
  ),
);

/** The claim of the AfA PNP Connector (AfA PNP Connector 1.0, PNP service connector claims). */
export const preferencesSchema = v.pipe(
  looseRecord({
    afapnp_endpoint_hosturl: HTTPS_URL,
    afapnp_activity_ids: v.pipe(STRING_ARRAY, v.minLength(1)),
    scopes: v.pipe(STRING_ARRAY, v.minLength(1)),
  }),
  v.transform(
    (claim): PreferencesClaim => ({
      hostUrl: claim.afapnp_endpoint_hosturl,
      activityIds: claim.afapnp_activity_ids,
      scopes: claim.scopes,
    }),
  ),
);

/** The settings of a Deep Linking request (Deep Linking 2.0 section 4.4.1). */
export const deepLinkingSettingsSchema = v.pipe(
  looseRecord({
    deep_link_return_url: HTTPS_URL,
    accept_types: STRING_ARRAY,
    accept_presentation_document_targets: STRING_ARRAY,
    // The text and the example give a comma-separated string, and the JSON schema of the specification an array.
    accept_media_types: v.optional(v.union([STRING, STRING_ARRAY])),
    accept_multiple: v.optional(BOOLEAN),
    accept_lineitem: v.optional(BOOLEAN),
    auto_create: v.optional(BOOLEAN),
    title: v.optional(STRING),
    text: v.optional(STRING),
    data: v.optional(STRING),
  }),
  v.transform(
    (claim): DeepLinkingSettings => ({
      returnUrl: claim.deep_link_return_url,
      acceptTypes: claim.accept_types,
      acceptPresentationDocumentTargets: claim.accept_presentation_document_targets,
      acceptMediaTypes:
        typeof claim.accept_media_types === "string"
          ? claim.accept_media_types.split(",").map((type) => type.trim())
          : claim.accept_media_types,
      acceptMultiple: claim.accept_multiple,
      acceptLineItem: claim.accept_lineitem,
      autoCreate: claim.auto_create,
      title: claim.title,
      text: claim.text,
      data: claim.data,
    }),
  ),
);

/** The assessment control claim of a Start Proctoring message (Proctoring Services 1.0 section 4.2.2.6). */
export const assessmentControlSchema = v.pipe(
  looseRecord({ assessment_control_url: HTTPS_URL, actions: STRING_ARRAY }),
  v.transform((claim): AssessmentControlClaim => ({ url: claim.assessment_control_url, actions: claim.actions })),
);

/** The proctoring settings claim (Proctoring Services 1.0 section 4.2.2.7). */
export const proctoringSettingsSchema = v.pipe(
  looseRecord({ data: v.optional(STRING) }),
  v.transform((claim): ProctoringSettings => ({ data: claim.data })),
);

/** The attempt number of a proctored assessment: a whole number, the first attempt being 1 (Proctoring Services 1.0 section 4.2.1.6). */
export const ATTEMPT_NUMBER = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/** The content items of a Deep Linking response: objects that each name their type (Deep Linking 2.0 section 3). */
export const CONTENT_ITEMS = v.array(
  v.pipe(
    jsonObjectSchema,
    v.check((item) => typeof item.type === "string" && item.type !== "", "expected a content item with a type"),
  ),
);
