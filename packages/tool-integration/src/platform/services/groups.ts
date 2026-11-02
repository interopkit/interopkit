import { DataError } from "@interopkit/core";
import { type HttpResponse, jsonResponse } from "@interopkit/core/http";
import { type Group, type GroupSet, type MessageServices, SCOPES } from "../../protocol/index.js";
import {
  GROUP_CONTAINER_MEDIA_TYPE,
  GROUP_SET_CONTAINER_MEDIA_TYPE,
  readGroupContainer,
  readGroupQuery,
  readGroupSetContainer,
  writeGroupContainer,
  writeGroupSetContainer,
} from "../../protocol/internal.js";
import { notFound, refusal } from "../answers.js";
import type { GroupStore } from "../ports.js";
import { pageHeaders, readPageRequest } from "./paging.js";
import { askStore, type ClaimRequest, fromStore, readStorePage, type Service, type ServiceRequest } from "./service.js";

const GROUPS_PATH = "/contexts/{context}/groups";
const GROUP_SETS_PATH = "/contexts/{context}/group-sets";
/** The version of the service that the claim says (Context Groups 1.0 section 2.7.1.1). */
const SERVICE_VERSION = "1.0";

type Call = ServiceRequest<GroupStore>;

/** Returns the URL of the groups of a context, which is the `context_groups_url` of the claim. */
function groupsUrl(origin: string, contextId: string): string {
  return `${origin}/contexts/${encodeURIComponent(contextId)}/groups`;
}

/** Returns the URL of the group sets of a context, which is the `context_group_sets_url` of the claim. */
function groupSetsUrl(origin: string, contextId: string): string {
  return `${origin}/contexts/${encodeURIComponent(contextId)}/group-sets`;
}

/** Reads the filters and the page of a request; the answer is a refusal when the request is not one. */
function readRequest(
  call: Call,
):
  | { readonly query: ReturnType<typeof readGroupQuery>; readonly page: ReturnType<typeof readPageRequest> }
  | HttpResponse {
  try {
    const query = readGroupQuery(call.url.searchParams);
    return { query, page: readPageRequest(call.url, query.limit, call.settings) };
  } catch (error) {
    if (error instanceof DataError) return refusal(400, "invalid_request", error.message);
    throw error;
  }
}

/** GET of the groups of a context, or of the groups a user is enrolled in (Context Groups 1.0 sections 2.1 and 2.1.2), in pages. */
async function getGroups(call: Call): Promise<HttpResponse> {
  const { url, store, caller, settings } = call;
  const context = call.params.context ?? "";
  const request = readRequest(call);
  if ("status" in request) return request;
  const { userId } = request.query;
  const label = "GroupStore.groups";
  const asked = { ...(userId === undefined ? {} : { userId }), ...request.page };
  const found = await askStore(call, (options) => store.groups(caller, context, asked, options));
  if (found === undefined) return notFound();
  const stored = readStorePage(label, found);
  const headers = pageHeaders(url, stored, request.page, label);
  // The answer to a filter by user says whose groups they are, and its `id` is the request's URL (section 2.1.2.1).
  const id = new URL(groupsUrl(settings.config.origin, context));
  if (userId !== undefined) id.searchParams.set("user_id", userId);
  const body = fromStore(label, () => {
    const written = writeGroupContainer({
      id: id.href,
      ...(userId === undefined ? {} : { userId }),
      groups: stored.items as Group[],
    });
    readGroupContainer(written);
    return written;
  });
  return jsonResponse(200, body, headers, GROUP_CONTAINER_MEDIA_TYPE);
}

/** GET of the group sets of a context (Context Groups 1.0 sections 2.2 and 2.5.2), in pages. */
async function getGroupSets(call: Call): Promise<HttpResponse> {
  const { url, store, caller, settings } = call;
  const context = call.params.context ?? "";
  const request = readRequest(call);
  if ("status" in request) return request;
  const label = "GroupStore.groupSets";
  const found = await askStore(call, (options) => store.groupSets(caller, context, request.page, options));
  if (found === undefined) return notFound();
  const stored = readStorePage(label, found);
  const headers = pageHeaders(url, stored, request.page, label);
  const body = fromStore(label, () => {
    const written = writeGroupSetContainer({
      id: groupSetsUrl(settings.config.origin, context),
      sets: stored.items as GroupSet[],
    });
    readGroupSetContainer(written);
    return written;
  });
  return jsonResponse(200, body, headers, GROUP_SET_CONTAINER_MEDIA_TYPE);
}

/**
 * Writes the claim of Context Groups (Context Groups 1.0 section 2.7.1.1) into the services of a message that asks for it: the
 * groups of the context, its group sets when the message says so, and the scopes that the registration grants.
 */
function groupsClaim({ message, granted, origin }: ClaimRequest): MessageServices {
  const asked = message.services?.groups;
  const contextId = message.context?.id;
  if (asked === undefined || contextId === undefined) return {};
  return {
    groups: {
      contextGroupsUrl: groupsUrl(origin, contextId),
      ...(asked.sets ? { contextGroupSetsUrl: groupSetsUrl(origin, contextId) } : {}),
      scopes: granted,
      serviceVersions: [SERVICE_VERSION],
    },
  };
}

/** Context Groups over the host's `GroupStore`. */
export const GROUPS: Service<"groups"> = {
  store: "groups",
  scopes: [SCOPES.contextGroupReadonly],
  claim: groupsClaim,
  routes: [
    { path: GROUPS_PATH, methods: { GET: { scopes: [SCOPES.contextGroupReadonly], handle: getGroups } } },
    { path: GROUP_SETS_PATH, methods: { GET: { scopes: [SCOPES.contextGroupReadonly], handle: getGroupSets } } },
  ],
};
