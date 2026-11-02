// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { checkHttpsUrl, type JsonValue } from "@interopkit/core/checks";
import { checkLimit, compact, searchOf } from "../claims/index.js";
import type { Member, MemberQuery, Membership } from "./model.js";

/** Writes a member as the membership service sends it. */
export function writeMember(member: Member): Record<string, JsonValue> {
  return compact({
    status: member.status,
    name: member.name,
    picture: member.picture,
    given_name: member.givenName,
    family_name: member.familyName,
    middle_name: member.middleName,
    email: member.email,
    user_id: member.userId,
    lis_person_sourcedid: member.lisPersonSourcedId,
    lti11_legacy_user_id: member.lti11LegacyUserId,
    roles: [...member.roles],
    message: member.message?.map((claims) => ({ ...claims })),
    group_enrollments: member.groupEnrollments?.map(({ groupId }) => ({ group_id: groupId })),
  });
}

/**
 * Writes a membership container, as `readMembership` reads it.
 *
 * @throws `DataError` when its address is not an https address.
 */
export function writeMembership(membership: Membership): Record<string, JsonValue> {
  checkHttpsUrl(membership.id, "The id of a membership");
  return {
    id: membership.id,
    context: compact({ ...membership.context }),
    members: membership.members.map(writeMember),
  };
}

/** Writes the filters of a request for members as query parameters. @throws `DataError` when `limit` is not a positive integer. */
export function writeMemberQuery(query: MemberQuery): URLSearchParams {
  checkLimit(query.limit, "member query");
  return searchOf([
    ["role", query.role],
    ["limit", query.limit],
    ["rlid", query.resourceLinkId],
    ["groups", query.groups === undefined ? undefined : String(query.groups)],
    ["since", query.since],
  ]);
}
