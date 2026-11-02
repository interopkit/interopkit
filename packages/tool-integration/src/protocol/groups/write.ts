// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { checkHttpsUrl, type JsonValue } from "@interopkit/core/checks";
import { checkLimit, compact, searchOf } from "../claims/index.js";
import type { Group, GroupContainer, GroupQuery, GroupSet, GroupSetContainer } from "./model.js";

function writeGroup(group: Group): Record<string, JsonValue> {
  return compact({
    id: group.id,
    name: group.name,
    tag: group.tag,
    set_ids: group.setIds && [...group.setIds],
    hidden: group.hidden,
  });
}

function writeGroupSet(set: GroupSet): Record<string, JsonValue> {
  return compact({ id: set.id, name: set.name, tag: set.tag, hidden: set.hidden });
}

/** Writes the answer of the groups endpoint, as `readGroupContainer` reads it. @throws `DataError` when the address is not an https address. */
export function writeGroupContainer(container: GroupContainer): Record<string, JsonValue> {
  checkHttpsUrl(container.id, "The id of a group container");
  return compact({ id: container.id, user_id: container.userId, groups: container.groups.map(writeGroup) });
}

/** Writes the answer of the group sets endpoint, as `readGroupSetContainer` reads it. @throws `DataError` when the address is not an https address. */
export function writeGroupSetContainer(container: GroupSetContainer): Record<string, JsonValue> {
  checkHttpsUrl(container.id, "The id of a group set container");
  return { id: container.id, sets: container.sets.map(writeGroupSet) };
}

/** Writes the filters of a request for groups as query parameters. @throws `DataError` when `limit` is not a positive integer. */
export function writeGroupQuery(query: GroupQuery): URLSearchParams {
  checkLimit(query.limit, "group query");
  return searchOf([
    ["user_id", query.userId],
    ["limit", query.limit],
  ]);
}
