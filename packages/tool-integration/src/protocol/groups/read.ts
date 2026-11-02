// biome-ignore-all lint/style/useNamingConvention: The names of the properties are those of the LTI specifications.

import { looseRecord, parseWith } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  BOOLEAN,
  HTTPS_URL,
  IDENTIFIER,
  NULLABLE_STRING,
  STRING,
  STRING_ARRAY,
  searchLimit,
  searchValue,
} from "../claims/index.js";
import type { Group, GroupContainer, GroupQuery, GroupSet, GroupSetContainer } from "./model.js";

const GROUP_QUERY = "group query";

const groupSchema = v.pipe(
  looseRecord({
    id: IDENTIFIER,
    name: STRING,
    tag: NULLABLE_STRING,
    set_ids: v.optional(STRING_ARRAY),
    hidden: v.optional(BOOLEAN),
  }),
  v.transform(
    (claim): Group => ({ id: claim.id, name: claim.name, tag: claim.tag, setIds: claim.set_ids, hidden: claim.hidden }),
  ),
);

const groupSetSchema = v.pipe(
  looseRecord({ id: IDENTIFIER, name: STRING, tag: NULLABLE_STRING, hidden: v.optional(BOOLEAN) }),
  v.transform((claim): GroupSet => ({ id: claim.id, name: claim.name, tag: claim.tag, hidden: claim.hidden })),
);

const groupContainerSchema = v.pipe(
  looseRecord({ id: HTTPS_URL, user_id: v.optional(IDENTIFIER), groups: v.array(groupSchema) }),
  v.transform((claim): GroupContainer => ({ id: claim.id, userId: claim.user_id, groups: claim.groups })),
);

const groupSetContainerSchema = v.pipe(
  looseRecord({ id: HTTPS_URL, sets: v.array(groupSetSchema) }),
  v.transform((claim): GroupSetContainer => ({ id: claim.id, sets: claim.sets })),
);

/** Reads the answer of the groups endpoint: groups with an `id` and a `name`, and the user when the request named one. @throws `DataError` that names the first invalid member. */
export function readGroupContainer(value: unknown): GroupContainer {
  return parseWith(groupContainerSchema, value, "The groups");
}

/** Reads the answer of the group sets endpoint: sets with an `id` and a `name`. @throws `DataError` that names the first invalid member. */
export function readGroupSetContainer(value: unknown): GroupSetContainer {
  return parseWith(groupSetContainerSchema, value, "The group sets");
}

/**
 * Reads the filters of a request for groups: `user_id` and `limit`. An unknown parameter is ignored.
 *
 * @throws `DataError` when a parameter is given twice or `limit` is not a positive integer.
 */
export function readGroupQuery(search: URLSearchParams): GroupQuery {
  return { userId: searchValue(search, "user_id", GROUP_QUERY), limit: searchLimit(search, GROUP_QUERY) };
}
