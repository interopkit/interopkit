import type { CallOptions } from "@interopkit/core";
import { type Group, type GroupQuery, type GroupSet, SCOPES } from "../../protocol/index.js";
import {
  GROUP_CONTAINER_MEDIA_TYPE,
  GROUP_SET_CONTAINER_MEDIA_TYPE,
  readGroupContainer,
  readGroupSetContainer,
  writeGroupQuery,
} from "../../protocol/internal.js";
import { containerRequest, type Page, type ServiceAccess } from "./access.js";

/** The client of Context Groups 1.0 of a platform. */
export interface GroupsClient {
  /**
   * Returns a page of the groups of a context: the `context_groups_url` of the launch with the filters of the query, or the `next`
   * of an earlier page (Context Groups 1.0 sections 2.1 and 2.5.1). With a `userId` the groups are those that the user is
   * enrolled in (section 2.1.2).
   *
   * @param url - The container, or the `next` of a page, which is sent as it is but for a `limit` when it has none.
   * @param query - The filters; a `limit` of none is the option `pageLimit`.
   */
  groups(url: string, query?: GroupQuery, options?: CallOptions): Promise<Page<Group>>;
  /**
   * Returns a page of the group sets of a context: the `context_group_sets_url` of the launch, or the `next` of an earlier page
   * (Context Groups 1.0 sections 2.2 and 2.5.2).
   *
   * @param query - The most sets to ask for; none is the option `pageLimit`.
   */
  groupSets(url: string, query?: { readonly limit?: number }, options?: CallOptions): Promise<Page<GroupSet>>;
}

/** Makes the client of the groups over the access to the services of a platform. */
export function groupsClient(access: ServiceAccess): GroupsClient {
  const { pageLimit } = access.settings;
  return {
    async groups(url, query, options) {
      const address = containerRequest(url, writeGroupQuery(query ?? {}), pageLimit);
      const init = {
        method: "GET",
        scopes: [SCOPES.contextGroupReadonly],
        accept: GROUP_CONTAINER_MEDIA_TYPE,
      } as const;
      const response = await access.request(address, init, options);
      const items = access.read(response, `The group container at ${address}`, readGroupContainer).groups;
      const next = access.next(response, address);
      return next === undefined ? { items } : { items, next };
    },
    async groupSets(url, query, options) {
      const address = containerRequest(url, writeGroupQuery({ limit: query?.limit }), pageLimit);
      const init = {
        method: "GET",
        scopes: [SCOPES.contextGroupReadonly],
        accept: GROUP_SET_CONTAINER_MEDIA_TYPE,
      } as const;
      const response = await access.request(address, init, options);
      const items = access.read(response, `The group set container at ${address}`, readGroupSetContainer).sets;
      const next = access.next(response, address);
      return next === undefined ? { items } : { items, next };
    },
  };
}
