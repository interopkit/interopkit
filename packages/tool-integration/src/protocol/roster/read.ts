// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { DataError } from "@interopkit/core";
import { jsonObjectSchema, looseRecord, parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import { HTTPS_URL, IDENTIFIER, NULLABLE_STRING, STRING_ARRAY, searchLimit, searchValue } from "../claims/index.js";
import { MEMBER_STATUSES, type Member, type MemberQuery, type Membership } from "./model.js";

const MEMBER_QUERY = "member query";

/** A member of a context (NRPS 2.0). Canvas and others send `null` for what they have none of, read as absent. */
const memberSchema = v.pipe(
  looseRecord({
    user_id: IDENTIFIER,
    roles: STRING_ARRAY,
    status: v.optional(v.picklist(MEMBER_STATUSES)),
    name: NULLABLE_STRING,
    picture: NULLABLE_STRING,
    given_name: NULLABLE_STRING,
    family_name: NULLABLE_STRING,
    middle_name: NULLABLE_STRING,
    email: NULLABLE_STRING,
    lis_person_sourcedid: NULLABLE_STRING,
    lti11_legacy_user_id: NULLABLE_STRING,
    message: v.optional(v.array(jsonObjectSchema)),
    group_enrollments: v.optional(v.array(looseRecord({ group_id: IDENTIFIER }))),
  }),
  v.transform(
    (claim): Member => ({
      userId: claim.user_id,
      roles: claim.roles,
      status: claim.status,
      name: claim.name,
      picture: claim.picture,
      givenName: claim.given_name,
      familyName: claim.family_name,
      middleName: claim.middle_name,
      email: claim.email,
      lisPersonSourcedId: claim.lis_person_sourcedid,
      lti11LegacyUserId: claim.lti11_legacy_user_id,
      message: claim.message,
      groupEnrollments: claim.group_enrollments?.map(({ group_id }) => ({ groupId: group_id })),
    }),
  ),
);

/** A membership container (`application/vnd.ims.lti-nrps.v2.membershipcontainer+json`). */
const membershipSchema = v.pipe(
  looseRecord({
    id: HTTPS_URL,
    context: v.pipe(
      looseRecord({ id: IDENTIFIER, label: NULLABLE_STRING, title: NULLABLE_STRING }),
      v.transform(({ id, label, title }) => ({ id, label, title })),
    ),
    members: v.array(memberSchema),
  }),
  v.transform((claim): Membership => ({ id: claim.id, context: claim.context, members: claim.members })),
);

/**
 * Reads the answer of the membership service into the model: the context, which must have an `id`, and the members, each with
 * a `user_id` and `roles`. A `null` string is absent.
 *
 * @param value - The parsed JSON.
 * @throws `DataError` that names the path of the first invalid member.
 */
export function readMembership(value: unknown): Membership {
  return parseWith(membershipSchema, value, "The membership");
}

/** Reads one member as the membership service sends it. @throws `DataError` that names the path of the first invalid property. */
export function readMember(value: unknown): Member {
  return parseWith(memberSchema, value, "The member");
}

/**
 * Reads the filters of a request for members: `role`, `limit`, `rlid`, `groups` and `since`. An unknown parameter is ignored.
 *
 * @throws `DataError` when a parameter is given twice, `limit` is not a positive integer, or `groups` is neither `true` nor `false`.
 */
export function readMemberQuery(search: URLSearchParams): MemberQuery {
  const groups = searchValue(search, "groups", MEMBER_QUERY);
  if (groups !== undefined && groups !== "true" && groups !== "false") {
    throw new DataError(
      `The parameter groups of the ${MEMBER_QUERY} must be true or false, found ${JSON.stringify(groups)}.`,
    );
  }
  return {
    role: searchValue(search, "role", MEMBER_QUERY),
    limit: searchLimit(search, MEMBER_QUERY),
    resourceLinkId: searchValue(search, "rlid", MEMBER_QUERY),
    groups: groups === undefined ? undefined : groups === "true",
    since: searchValue(search, "since", MEMBER_QUERY),
  };
}
