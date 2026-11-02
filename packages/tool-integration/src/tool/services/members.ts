import type { CallOptions } from "@interopkit/core";
import { type Member, type MemberQuery, type MembershipContext, SCOPES } from "../../protocol/index.js";
import { MEMBERSHIP_MEDIA_TYPE, readMembership, writeMemberQuery } from "../../protocol/internal.js";
import { containerRequest, type Page, type ServiceAccess } from "./access.js";

/** A page of the members of a context or a resource link, with the context they are in. */
export interface MemberPage extends Page<Member> {
  /** The context of the members. */
  readonly context: MembershipContext;
  /**
   * The link to the differences between the memberships of this read and now (NRPS 2.0, membership differences), on the origin of
   * the request; pass it to `members` as it is. Absent when the platform gave none, and when the link leads to another origin.
   */
  readonly differences?: string;
}

/** The client of Names and Role Provisioning (NRPS 2.0) of a platform. */
export interface MembersClient {
  /**
   * Returns a page of the members of a context: the `context_memberships_url` of the launch with the filters of the query, the
   * `next` of an earlier page, or the `differences` of an earlier read.
   *
   * @remarks
   * A query with a `resourceLinkId` asks for the members of that resource link, each with the `message` that its launch would
   * carry (NRPS 2.0, resource link membership), and one with `groups` for their group enrollments (Context Groups 1.0 section
   * 2.4). A link of an earlier read is sent as it is but for a `limit` when it has none, since the platform made it complete. The
   * platform may return more or fewer members than the `limit`.
   *
   * @param url - The container, or a `next` or `differences` link.
   * @param query - The filters; a `limit` of none is the option `pageLimit`.
   */
  members(url: string, query?: MemberQuery, options?: CallOptions): Promise<MemberPage>;
}

/** Makes the client of the members over the access to the services of a platform. */
export function membersClient(access: ServiceAccess): MembersClient {
  const { pageLimit } = access.settings;
  return {
    async members(url, query, options) {
      const address = containerRequest(url, writeMemberQuery(query ?? {}), pageLimit);
      const init = {
        method: "GET",
        scopes: [SCOPES.contextMembershipReadonly],
        accept: MEMBERSHIP_MEDIA_TYPE,
      } as const;
      const response = await access.request(address, init, options);
      const membership = access.read(response, `The membership at ${address}`, readMembership);
      const next = access.next(response, address);
      const differences = access.link(response, "differences", address);
      return {
        items: membership.members,
        context: membership.context,
        ...(next === undefined ? {} : { next }),
        ...(differences === undefined ? {} : { differences }),
      };
    },
  };
}
