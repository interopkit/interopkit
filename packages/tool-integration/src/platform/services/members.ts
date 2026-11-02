import { DataError } from "@interopkit/core";
import { nonEmptyStringSchema, parseWith } from "@interopkit/core/checks";
import { type HttpResponse, jsonResponse } from "@interopkit/core/http";
import * as v from "valibot";
import { canonicalizeRole, type Member, type MessageServices, SCOPES } from "../../protocol/index.js";
import {
  MEMBERSHIP_MEDIA_TYPE,
  readMember,
  readMemberQuery,
  writeMember,
  writeMembership,
} from "../../protocol/internal.js";
import { notFound, refusal } from "../answers.js";
import type { RosterStore } from "../ports.js";
import { pageHeaders, readPageRequest } from "./paging.js";
import { askStore, type ClaimRequest, fromStore, PAGE_ENTRIES, type Service, type ServiceRequest } from "./service.js";

const MEMBERSHIPS_PATH = "/contexts/{context}/memberships";
/** The version of the service that the claim says (NRPS 2.0 section 4.1). */
const SERVICE_VERSION = "2.0";
const LABEL = "RosterStore.members";

type Call = ServiceRequest<RosterStore>;

const memberPageSchema = v.object({
  ...PAGE_ENTRIES,
  differences: v.optional(nonEmptyStringSchema),
  context: v.optional(v.object({ label: v.optional(v.string()), title: v.optional(v.string()) })),
});

/** Returns the URL of the members of a context, which is the `context_memberships_url` of the claim. */
function membershipsUrl(origin: string, contextId: string): string {
  return `${origin}/contexts/${encodeURIComponent(contextId)}/memberships`;
}

/** Reads a member that the store answered into the model: the writer takes the model, and the reader of the wire form checks it. */
function storedMember(value: unknown): Member {
  return fromStore(LABEL, () => readMember(writeMember(value as Member)));
}

/**
 * GET of the members of a context (NRPS 2.0), or of a resource link of it with `rlid`: filtered by role, in pages, with a
 * `differences` link when the store gives a token. Only a member that the store gave is shared, and the group enrollments and the
 * message of a resource link only when the request asked for them.
 */
async function getMembers(call: Call): Promise<HttpResponse> {
  const { url, store, caller, settings } = call;
  const context = call.params.context ?? "";
  let query: ReturnType<typeof readMemberQuery>;
  let page: ReturnType<typeof readPageRequest>;
  try {
    query = readMemberQuery(url.searchParams);
    page = readPageRequest(url, query.limit, settings);
  } catch (error) {
    if (error instanceof DataError) return refusal(400, "invalid_request", error.message);
    throw error;
  }
  const { role, resourceLinkId, groups, since } = query;
  const asked = {
    ...(role === undefined ? {} : { role: canonicalizeRole(role) }),
    ...(resourceLinkId === undefined ? {} : { resourceLinkId }),
    ...(groups === undefined ? {} : { groups }),
    ...(since === undefined ? {} : { since }),
    ...page,
  };
  const found = await askStore(call, (options) => store.members(caller, context, asked, options));
  if (found === undefined) return notFound();
  const stored = parseWith(memberPageSchema, found, `The answer of ${LABEL}`);
  const headers = pageHeaders(url, { items: stored.items, cursor: stored.cursor }, page, LABEL);
  const members = stored.items.map(storedMember).map((member) => {
    if (member.status === "Deleted" && since === undefined) {
      throw new DataError(
        `The answer of ${LABEL} breaks its contract: the member ${member.userId} has the status Deleted, which only a read of the differences may give.`,
      );
    }
    // What the tool did not ask for is not shared: the enrollments need `groups=true`, and the message a resource link.
    return {
      ...member,
      groupEnrollments: groups === true ? member.groupEnrollments : undefined,
      message: resourceLinkId === undefined ? undefined : member.message,
    };
  });
  const id = new URL(membershipsUrl(settings.config.origin, context));
  if (resourceLinkId !== undefined) id.searchParams.set("rlid", resourceLinkId);
  const body = writeMembership({ id: id.href, context: { id: context, ...stored.context }, members });
  const links = [headers.link];
  if (stored.differences !== undefined) {
    const differences = new URL(url);
    differences.searchParams.delete("cursor");
    differences.searchParams.set("since", stored.differences);
    links.push(`<${differences.href}>; rel="differences"`);
  }
  const link = links.filter((value) => value !== undefined).join(", ");
  return jsonResponse(200, body, link === "" ? {} : { link }, MEMBERSHIP_MEDIA_TYPE);
}

/** Writes the claim of Names and Role Provisioning (NRPS 2.0 section 4.1) into the services of a message that asks for it. */
function rosterClaim({ message, origin }: ClaimRequest): MessageServices {
  const contextId = message.context?.id;
  if (message.services?.roster !== true || contextId === undefined) return {};
  return {
    roster: { contextMembershipsUrl: membershipsUrl(origin, contextId), serviceVersions: [SERVICE_VERSION] },
  };
}

/** Names and Role Provisioning over the host's `RosterStore`. */
export const ROSTER: Service<"roster"> = {
  store: "roster",
  scopes: [SCOPES.contextMembershipReadonly],
  claim: rosterClaim,
  routes: [
    {
      path: MEMBERSHIPS_PATH,
      methods: { GET: { scopes: [SCOPES.contextMembershipReadonly], handle: getMembers } },
    },
  ],
};
