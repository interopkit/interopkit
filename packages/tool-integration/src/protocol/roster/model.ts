import type { JsonObject } from "@interopkit/core/checks";

/**
 * The statuses of a membership (NRPS 2.0, membership status). `Deleted` appears only in the differences between two reads.
 */
export const MEMBER_STATUSES = ["Active", "Inactive", "Deleted"] as const;

/** The status of a membership. */
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

/** The context a membership container is for (NRPS 2.0, context membership). */
export interface MembershipContext {
  /** The identifier of the context. */
  readonly id: string;
  /** The short name of the context. */
  readonly label?: string;
  /** The full name of the context. */
  readonly title?: string;
}

/** A group that a member is enrolled in (Context Groups 1.0 section 2.4). */
export interface GroupEnrollment {
  /** The identifier of the group. */
  readonly groupId: string;
}

/** A member of a context: a user with at least one role (NRPS 2.0). */
export interface Member {
  /** The identifier of the user, as the `sub` of a launch has it. */
  readonly userId: string;
  /** The roles of the user in the context, as the platform sent them. */
  readonly roles: readonly string[];
  /** The status; a membership without one is `Active`. */
  readonly status?: MemberStatus;
  /** The full name of the user. */
  readonly name?: string;
  /** The address of a picture of the user. */
  readonly picture?: string;
  /** The given names of the user. */
  readonly givenName?: string;
  /** The family names of the user. */
  readonly familyName?: string;
  /** The middle names of the user. */
  readonly middleName?: string;
  /** The email address of the user. */
  readonly email?: string;
  /** The Learning Information Services identifier of the user. */
  readonly lisPersonSourcedId?: string;
  /** The `user_id` that LTI 1.1 sent for the user, when it differs from `userId` (Migration Guide). */
  readonly lti11LegacyUserId?: string;
  /** What the launch of a resource link would carry for this member, as claims (NRPS 2.0, message section). */
  readonly message?: readonly JsonObject[];
  /** The groups the member is enrolled in; present when the request asked for `groups`. */
  readonly groupEnrollments?: readonly GroupEnrollment[];
}

/** The members of a context or of a resource link, as one answer holds them (`application/vnd.ims.lti-nrps.v2.membershipcontainer+json`). */
export interface Membership {
  /** The address of the container. */
  readonly id: string;
  /** The context of the members. */
  readonly context: MembershipContext;
  /** The members. */
  readonly members: readonly Member[];
}

/** The filters of a request for members (NRPS 2.0, Context Groups 1.0 section 2.4). */
export interface MemberQuery {
  /** Only the members with this role, by its URI or, for a context role, its simple name. */
  readonly role?: string;
  /** The most members to return; the platform may return fewer or more. */
  readonly limit?: number;
  /** Only the members that can reach this resource link, each with the message of that link. */
  readonly resourceLinkId?: string;
  /** Whether to add the group enrollments of each member. */
  readonly groups?: boolean;
  /** The token of the differences with an earlier read, as the `differences` link of that answer gave it. */
  readonly since?: string;
}
