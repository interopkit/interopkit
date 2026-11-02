// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims, NRPS, Context Groups and PNP bodies are those of the specifications.

import { DataError } from "@interopkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SCOPES } from "../src/index.js";
import {
  ltiPlatformLogin,
  type MessageInput,
  type PlatformRequestOptions,
  type PlatformServices,
} from "../src/platform/index.js";
import { readMessage } from "../src/protocol/internal.js";
import { clientAssertion, TOOL_CLIENT_ID, TOOL_DEPLOYMENT_ID, tokenRequest, toolRegistration } from "./fake-tool.js";
import { call, json, tokenFor } from "./platform-services.js";
import {
  baseMessage,
  endpoints,
  handle,
  ISSUER,
  launch,
  PLATFORM_ORIGIN,
  type Setup,
  setup,
  toolKeys,
} from "./platform-setup.js";
import { INSTRUCTOR, LEARNER, MemoryGroups, MemoryPreferences, MemoryRoster } from "./roster-stores.js";
import { textOf } from "./text-of.js";

afterEach(() => {
  vi.useRealTimers();
});

const NRPS_CLAIM = "https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice";
const GROUPS_CLAIM = "https://purl.imsglobal.org/spec/lti-gs/claim/groupsservice";
const PNP_CLAIM = "https://purl.imsglobal.org/spec/lti-afapnp/claim/afapnp-endpoint-service";
const MEMBERSHIPS = `${PLATFORM_ORIGIN}/contexts/course-1/memberships`;
const GROUPS = `${PLATFORM_ORIGIN}/contexts/course-1/groups`;
const SETS = `${PLATFORM_ORIGIN}/contexts/course-1/group-sets`;
const RECORD = `${PLATFORM_ORIGIN}/ims/afapnp/v1p0/users/ana/activities/activity-1/afapnprecords`;
const MEMBERSHIP_TYPE = "application/vnd.ims.lti-nrps.v2.membershipcontainer+json";
const GROUPS_TYPE = "application/vnd.ims.lti-gs.v1.contextgroupcontainer+json";
const SETS_TYPE = "application/vnd.ims.lti-gs.v1.contextgroupsetcontainer+json";
const ALL = [SCOPES.contextMembershipReadonly, SCOPES.contextGroupReadonly, SCOPES.preferencesRecordReadonly];

/** A platform whose first tool may use the three services, with a course, its groups and a record. */
function served(scopes: readonly string[] = ALL): Setup & {
  readonly roster: MemoryRoster;
  readonly groups: MemoryGroups;
  readonly preferences: MemoryPreferences;
} {
  const ctx = setup({ tools: [toolRegistration({ scopes })] });
  const roster = new MemoryRoster(TOOL_CLIENT_ID);
  const groups = new MemoryGroups(TOOL_CLIENT_ID);
  const preferences = new MemoryPreferences(TOOL_CLIENT_ID);
  Object.assign(ctx.requests, { services: { roster, groups, preferences } });
  return Object.assign(ctx, { roster, groups, preferences });
}

const withServices: MessageInput = {
  ...baseMessage,
  services: { roster: true, groups: { sets: true }, preferences: { activityIds: ["activity-1", "activity-2"] } },
};

/** A request for a service with a token of one scope. */
async function get(ctx: Setup, url: string, scope: string, change: Partial<PlatformRequestOptions> = {}) {
  return handle(ctx, call(url, await tokenFor(ctx, scope)), change);
}

describe("the claims of the roster services", () => {
  it("offers each service with its URLs and the scopes that the registration grants, for a message that asks for it", async () => {
    const { claims } = await launch(served([...ALL, "https://example.com/other"]), withServices);
    expect(claims[NRPS_CLAIM]).toEqual({ context_memberships_url: MEMBERSHIPS, service_versions: ["2.0"] });
    expect(claims[GROUPS_CLAIM]).toEqual({
      context_groups_url: GROUPS,
      context_group_sets_url: SETS,
      scope: [SCOPES.contextGroupReadonly],
      service_versions: ["1.0"],
    });
    expect(claims[PNP_CLAIM]).toEqual({
      afapnp_endpoint_hosturl: PLATFORM_ORIGIN,
      afapnp_activity_ids: ["activity-1", "activity-2"],
      scopes: [SCOPES.preferencesRecordReadonly],
    });
  });

  it("is read by the tool role as the services of the message", async () => {
    const { claims } = await launch(served(), withServices);
    const read = readMessage(claims, { issuer: ISSUER, clientId: TOOL_CLIENT_ID, deploymentIds: [TOOL_DEPLOYMENT_ID] });
    expect(read.services).toMatchObject({
      roster: { contextMembershipsUrl: MEMBERSHIPS, serviceVersions: ["2.0"] },
      groups: { contextGroupsUrl: GROUPS, contextGroupSetsUrl: SETS, serviceVersions: ["1.0"] },
      preferences: { hostUrl: PLATFORM_ORIGIN, activityIds: ["activity-1", "activity-2"] },
    });
  });

  it("is offered only when the host gives the store, and only for a message that asks for it", async () => {
    const without = await launch(setup({ tools: [toolRegistration({ scopes: ALL })] }), withServices);
    for (const name of [NRPS_CLAIM, GROUPS_CLAIM, PNP_CLAIM]) expect(without.claims[name], name).toBeUndefined();
    const notAsked = await launch(served(), baseMessage);
    for (const name of [NRPS_CLAIM, GROUPS_CLAIM, PNP_CLAIM]) expect(notAsked.claims[name], name).toBeUndefined();
    const onlyRoster = served();
    Object.assign(onlyRoster.requests, { services: { roster: onlyRoster.roster } });
    const some = await launch(onlyRoster, withServices);
    expect([some.claims[NRPS_CLAIM] !== undefined, some.claims[GROUPS_CLAIM], some.claims[PNP_CLAIM]]).toEqual([
      true,
      undefined,
      undefined,
    ]);
  });

  it("names the group sets only when the message says so, and the connector only to a tool with one of its scopes", async () => {
    const noSets = await launch(served(), { ...baseMessage, services: { groups: { sets: false } } });
    expect(noSets.claims[GROUPS_CLAIM]).not.toHaveProperty("context_group_sets_url");
    const noScope = await launch(served([SCOPES.contextMembershipReadonly]), withServices);
    expect(noScope.claims[PNP_CLAIM]).toBeUndefined();
    expect(noScope.claims[NRPS_CLAIM]).toBeDefined();
  });

  it("encodes the identifier of the context in the URLs", async () => {
    const message = { ...withServices, context: { id: "course 1/a" } };
    const { claims } = await launch(served(), message);
    expect(claims[NRPS_CLAIM]).toMatchObject({
      context_memberships_url: `${PLATFORM_ORIGIN}/contexts/course%201%2Fa/memberships`,
    });
    expect(claims[GROUPS_CLAIM]).toMatchObject({
      context_groups_url: `${PLATFORM_ORIGIN}/contexts/course%201%2Fa/groups`,
    });
  });

  it("needs the context for the roster and the groups, and not for the connector", async () => {
    const ctx = served();
    const noContext = { ...baseMessage, context: undefined };
    await expect(ltiPlatformLogin({ ...noContext, services: { roster: true } }, ctx.login)).rejects.toThrow(
      "offers the roster services, which need its context",
    );
    await expect(
      ltiPlatformLogin({ ...noContext, services: { roster: true, groups: { sets: false } } }, ctx.login),
    ).rejects.toThrow("offers the roster and group services, which need its context");
    const connector = { ...noContext, services: { preferences: { activityIds: ["activity-1"] } } };
    await expect(ltiPlatformLogin(connector, ctx.login)).resolves.toEqual(expect.any(String));
  });

  it("refuses a message whose services are of other types or lack what they need", async () => {
    const ctx = served();
    const bad = [
      { roster: false },
      { roster: "yes" },
      { groups: {} },
      { groups: { sets: "yes" } },
      { preferences: {} },
      { preferences: { activityIds: [] } },
      { preferences: { activityIds: [""] } },
      { unknown: true },
    ];
    for (const services of bad) {
      const message = JSON.parse(JSON.stringify({ ...baseMessage, services }));
      await expect(ltiPlatformLogin(message, ctx.login), JSON.stringify(services)).rejects.toThrow(DataError);
    }
  });

  it("answers no variable beside the existing ones from the new claims", async () => {
    const { claims } = await launch(served(), { ...withServices, custom: { items: "$LineItems.url" } });
    expect(claims["https://purl.imsglobal.org/spec/lti/claim/custom"]).toEqual({ items: "" });
  });
});

describe("the token endpoint with the roster services", () => {
  it("grants the scope of a service only when the host gives its store", async () => {
    const ctx = served();
    for (const scope of ALL) expect(await tokenFor(ctx, scope)).toBeTruthy();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const without = await handle(ctx, tokenRequest(endpoints.token, assertion, ALL.join(" ")), {
      services: { roster: ctx.roster },
    });
    expect(json(without).scope).toBe(SCOPES.contextMembershipReadonly);
  });
});

describe("the access to the roster services", () => {
  const routes = [
    [MEMBERSHIPS, SCOPES.contextMembershipReadonly],
    [GROUPS, SCOPES.contextGroupReadonly],
    [SETS, SCOPES.contextGroupReadonly],
    [RECORD, SCOPES.preferencesRecordReadonly],
  ] as const;

  it("needs a token of this platform, and the scope of the route among those that the registration still grants", async () => {
    const ctx = served();
    for (const [url, scope] of routes) {
      const missing = await handle(ctx, call(url, undefined));
      expect([missing.status, missing.headers["www-authenticate"]], url).toEqual([401, "Bearer"]);
      const other = ALL.find((each) => each !== scope) ?? "";
      const forbidden = await get(ctx, url, other);
      expect([forbidden.status, json(forbidden).error], url).toEqual([403, "insufficient_scope"]);
      expect(forbidden.headers["www-authenticate"]).toBe(`Bearer error="insufficient_scope", scope="${scope}"`);
      expect((await get(ctx, url, scope)).status, url).toBe(200);
    }
    const token = await tokenFor(ctx, SCOPES.contextMembershipReadonly);
    ctx.tools.set(TOOL_CLIENT_ID, toolRegistration({ scopes: [SCOPES.contextGroupReadonly] }));
    expect((await handle(ctx, call(MEMBERSHIPS, token))).status).toBe(403);
    ctx.tools.delete(TOOL_CLIENT_ID);
    expect((await handle(ctx, call(MEMBERSHIPS, token))).status).toBe(401);
  });

  it("passes the tool and the deployment of the token to the stores, and the signal of the request", async () => {
    const ctx = served();
    const signal = new AbortController().signal;
    await get(ctx, MEMBERSHIPS, SCOPES.contextMembershipReadonly, { signal });
    await get(ctx, GROUPS, SCOPES.contextGroupReadonly);
    await get(ctx, RECORD, SCOPES.preferencesRecordReadonly);
    const caller = { clientId: TOOL_CLIENT_ID, deploymentId: TOOL_DEPLOYMENT_ID };
    expect(ctx.roster.calls.map((each) => each.caller)).toEqual([caller]);
    expect(ctx.groups.calls.map((each) => each.caller)).toEqual([caller]);
    expect(ctx.preferences.calls.map((each) => each.caller)).toEqual([caller]);
    expect(ctx.roster.calls[0]?.signal).toBe(signal);
  });

  it("answers 404 for what the store does not give the caller, and 405 with the method of the route", async () => {
    const ctx = served();
    ctx.roster.owner = ctx.groups.owner = ctx.preferences.owner = "someone-else";
    for (const [url, scope] of routes) expect((await get(ctx, url, scope)).status, url).toBe(404);
    const unknown = `${PLATFORM_ORIGIN}/contexts/other/memberships`;
    ctx.roster.owner = TOOL_CLIENT_ID;
    expect((await get(ctx, unknown, SCOPES.contextMembershipReadonly)).status).toBe(404);
    for (const [url] of routes) {
      const refused = await handle(ctx, call(url, undefined, { method: "POST" }));
      expect([refused.status, refused.headers.allow], url).toEqual([405, "GET"]);
    }
  });

  it("answers 500 when a store fails, with nothing of the cause", async () => {
    const ctx = served();
    ctx.roster.members = () => Promise.reject(new Error("cause: the database is down"));
    ctx.groups.groups = () => Promise.reject(new Error("cause: the database is down"));
    ctx.preferences.record = () => Promise.reject(new Error("cause: the database is down"));
    for (const [url, scope] of routes.filter(([url]) => url !== SETS)) {
      const failed = await get(ctx, url, scope);
      expect([failed.status, textOf(failed.body).includes("cause")], url).toEqual([500, false]);
    }
  });
});

describe("the members of a context", () => {
  it("answers the container with its media type and the id and context of NRPS, and each member as the wire form", async () => {
    const ctx = served();
    const response = await get(ctx, MEMBERSHIPS, SCOPES.contextMembershipReadonly);
    expect(response.headers["content-type"]).toBe(MEMBERSHIP_TYPE);
    expect(json(response)).toEqual({
      id: MEMBERSHIPS,
      context: { id: "course-1", label: "CPS 435", title: "CPS 435 Learning Analytics" },
      members: [
        { user_id: "jane", roles: [INSTRUCTOR], name: "Jane M. Doe", email: "jane@platform.example.edu" },
        { user_id: "ana", roles: [LEARNER], lti11_legacy_user_id: "legacy-ana" },
        { user_id: "budi", roles: [LEARNER] },
        { user_id: "citra", roles: [LEARNER] },
      ],
    });
  });

  it("keeps back what the request did not ask for: the group enrollments, and the message of a resource link", async () => {
    const ctx = served();
    const plain = json(await get(ctx, MEMBERSHIPS, SCOPES.contextMembershipReadonly));
    expect(JSON.stringify(plain)).not.toMatch(/group_enrollments|"message"/u);
    const groups = json(await get(ctx, `${MEMBERSHIPS}?groups=true`, SCOPES.contextMembershipReadonly));
    expect(groups.members[2].group_enrollments).toEqual([{ group_id: "g1" }, { group_id: "g2" }]);
    expect(groups.members[0].group_enrollments).toEqual([{ group_id: "g3" }]);
    expect(JSON.stringify(groups)).not.toContain('"message"');
    const link = await get(ctx, `${MEMBERSHIPS}?rlid=link-1`, SCOPES.contextMembershipReadonly);
    const body = json(link);
    expect(body.id).toBe(`${MEMBERSHIPS}?rlid=link-1`);
    expect(body.members.map((member: { user_id: string }) => member.user_id)).toEqual(["ana", "budi"]);
    expect(body.members[0].message).toEqual([
      {
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/custom": { country: "Canada" },
      },
    ]);
    expect(JSON.stringify(body)).not.toContain("group_enrollments");
  });

  it("passes the filters to the store, a context role by its URI, and the page asked for", async () => {
    const ctx = served();
    await get(ctx, `${MEMBERSHIPS}?role=Learner&limit=2&groups=false&rlid=link-1`, SCOPES.contextMembershipReadonly);
    await get(ctx, `${MEMBERSHIPS}?role=${encodeURIComponent(INSTRUCTOR)}`, SCOPES.contextMembershipReadonly);
    await get(ctx, `${MEMBERSHIPS}?role=http://example.com/custom-role`, SCOPES.contextMembershipReadonly);
    expect(ctx.roster.calls.map((each) => each.args[1])).toEqual([
      { role: LEARNER, resourceLinkId: "link-1", groups: false, limit: 2 },
      { role: INSTRUCTOR, limit: 100 },
      { role: "http://example.com/custom-role", limit: 100 },
    ]);
  });

  it("links to the next page with every filter of the request, and to the differences from its own read", async () => {
    const ctx = served();
    const first = await get(
      ctx,
      `${MEMBERSHIPS}?role=Learner&limit=1&rlid=link-1&groups=true`,
      SCOPES.contextMembershipReadonly,
    );
    expect(first.headers.link).toBe(
      `<${MEMBERSHIPS}?role=Learner&limit=1&rlid=link-1&groups=true&cursor=1>; rel="next", <${MEMBERSHIPS}?role=Learner&limit=1&rlid=link-1&groups=true&since=t2>; rel="differences"`,
    );
    const learners = await get(ctx, `${MEMBERSHIPS}?role=Learner&limit=2`, SCOPES.contextMembershipReadonly);
    expect(json(learners).members.map((member: { user_id: string }) => member.user_id)).toEqual(["ana", "budi"]);
    const next = /<([^>]+)>; rel="next"/u.exec(learners.headers.link ?? "")?.[1] ?? "";
    const second = await handle(ctx, call(next, await tokenFor(ctx, SCOPES.contextMembershipReadonly)));
    expect(json(second).members.map((member: { user_id: string }) => member.user_id)).toEqual(["citra"]);
    expect(second.headers.link).toBe(`<${MEMBERSHIPS}?role=Learner&limit=2&since=t2>; rel="differences"`);
    ctx.roster.differences = undefined;
    expect((await get(ctx, MEMBERSHIPS, SCOPES.contextMembershipReadonly)).headers.link).toBeUndefined();
  });

  it("reads the differences from the link, with the members that left as Deleted, and answers 404 for a token that is gone", async () => {
    const ctx = served();
    const changes = await get(ctx, `${MEMBERSHIPS}?since=t1`, SCOPES.contextMembershipReadonly);
    expect(json(changes).members).toEqual([{ user_id: "left", roles: [LEARNER], status: "Deleted" }]);
    expect((await get(ctx, `${MEMBERSHIPS}?since=gone`, SCOPES.contextMembershipReadonly)).status).toBe(404);
  });

  it("answers 404 for a resource link that is not the tool's, and for a cursor that is gone", async () => {
    const ctx = served();
    expect((await get(ctx, `${MEMBERSHIPS}?rlid=other`, SCOPES.contextMembershipReadonly)).status).toBe(404);
    expect((await get(ctx, `${MEMBERSHIPS}?cursor=x`, SCOPES.contextMembershipReadonly)).status).toBe(404);
  });

  it("sends the store a page of the default size without a limit, and of the largest size for a larger limit", async () => {
    const ctx = served();
    await get(ctx, MEMBERSHIPS, SCOPES.contextMembershipReadonly);
    await get(ctx, `${MEMBERSHIPS}?limit=5000`, SCOPES.contextMembershipReadonly);
    await get(ctx, `${MEMBERSHIPS}?limit=10`, SCOPES.contextMembershipReadonly, { pageSize: 7, maxPageSize: 9 });
    const limits = ctx.roster.calls.map(({ args }) => (args[1] as { limit: number }).limit);
    expect(limits).toEqual([100, 1000, 9]);
  });

  it("refuses a query that is not one", async () => {
    const ctx = served();
    for (const query of [
      "limit=0",
      "limit=x",
      "role=a&role=b",
      "rlid=a&rlid=b",
      "groups=maybe",
      "since=a&since=b",
      "cursor=1&cursor=2",
    ]) {
      expect((await get(ctx, `${MEMBERSHIPS}?${query}`, SCOPES.contextMembershipReadonly)).status, query).toBe(400);
    }
    expect(ctx.roster.calls).toEqual([]);
  });

  it("throws DataError for a store that breaks its contract, and names the store", async () => {
    const ctx = served();
    const ask = () => get(ctx, MEMBERSHIPS, SCOPES.contextMembershipReadonly);
    const answers: readonly [string, unknown][] = [
      ["not a page", 5],
      ["items", { items: 5 }],
      ["a member that is not an object", { items: [5] }],
      ["a member without roles", { items: [{ userId: "x" }] }],
      ["a member without a user", { items: [{ roles: [] }] }],
      ["a status that is not one", { items: [{ userId: "x", roles: [], status: "Gone" }] }],
      ["roles of other types", { items: [{ userId: "x", roles: [5] }] }],
      ["a message that is not a list", { items: [{ userId: "x", roles: [], message: 5 }] }],
      ["a cursor that is empty", { items: [], cursor: "" }],
      ["differences that are empty", { items: [], differences: "" }],
      ["a label that is not text", { items: [], context: { label: 5 } }],
      [
        "a member that left, outside a read of the differences",
        { items: [{ userId: "x", roles: [], status: "Deleted" }] },
      ],
    ];
    for (const [name, answer] of answers) {
      ctx.roster.members = async () => answer as never;
      await expect(ask(), name).rejects.toThrow(/The answer of (RosterStore\.members|RosterStore\.members breaks)/u);
      await expect(ask(), name).rejects.toThrow(DataError);
    }
    ctx.roster.members = async (_caller, _context, query) => ({
      items: Array.from({ length: query.limit + 1 }, (_, index) => ({ userId: `u${index}`, roles: [] })),
    });
    await expect(ask()).rejects.toThrow("must return at most the limit");
  });
});

describe("the groups of a context", () => {
  it("answers the groups with the media type and the id of Context Groups, each as the wire form", async () => {
    const ctx = served();
    const response = await get(ctx, GROUPS, SCOPES.contextGroupReadonly);
    expect(response.headers["content-type"]).toBe(GROUPS_TYPE);
    expect(json(response)).toEqual({
      id: GROUPS,
      groups: [
        { id: "g1", name: "Tuesday", set_ids: ["s1"], tag: "marking" },
        { id: "g2", name: "Friday", set_ids: ["s1", "s2"], hidden: true },
        { id: "g3", name: "Cool kids" },
      ],
    });
  });

  it("answers the groups of a user with the user and the request as its id", async () => {
    const ctx = served();
    const response = await get(ctx, `${GROUPS}?user_id=budi`, SCOPES.contextGroupReadonly);
    expect(json(response)).toMatchObject({ id: `${GROUPS}?user_id=budi`, user_id: "budi" });
    expect(json(response).groups.map((group: { id: string }) => group.id)).toEqual(["g1", "g2"]);
    expect(ctx.groups.calls[0]?.args[1]).toEqual({ userId: "budi", limit: 100 });
    const nobody = json(await get(ctx, `${GROUPS}?user_id=nobody`, SCOPES.contextGroupReadonly));
    expect(nobody.groups).toEqual([]);
  });

  it("pages the groups and the sets, with a next link that keeps the filter", async () => {
    const ctx = served();
    const first = await get(ctx, `${GROUPS}?limit=2&user_id=budi`, SCOPES.contextGroupReadonly);
    expect(first.headers.link).toBeUndefined();
    const all = await get(ctx, `${GROUPS}?limit=2`, SCOPES.contextGroupReadonly);
    expect(all.headers.link).toBe(`<${GROUPS}?limit=2&cursor=2>; rel="next"`);
    const sets = await get(ctx, `${SETS}?limit=1`, SCOPES.contextGroupReadonly);
    expect(sets.headers["content-type"]).toBe(SETS_TYPE);
    expect(json(sets)).toEqual({ id: SETS, sets: [{ id: "s1", name: "Chemistry lab" }] });
    expect(sets.headers.link).toBe(`<${SETS}?limit=1&cursor=1>; rel="next"`);
    const second = await handle(
      ctx,
      call(`${SETS}?limit=1&cursor=1`, await tokenFor(ctx, SCOPES.contextGroupReadonly)),
    );
    expect(json(second).sets).toEqual([
      { id: "s2", name: "Sections", tag: "http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection" },
    ]);
  });

  it("refuses a query that is not one, and throws DataError for a store that breaks its contract", async () => {
    const ctx = served();
    for (const query of ["limit=0", "user_id=a&user_id=b", "cursor=1&cursor=2"]) {
      expect((await get(ctx, `${GROUPS}?${query}`, SCOPES.contextGroupReadonly)).status, query).toBe(400);
      expect((await get(ctx, `${SETS}?${query}`, SCOPES.contextGroupReadonly)).status, query).toBe(400);
    }
    const ask = (url: string) => get(ctx, url, SCOPES.contextGroupReadonly);
    for (const answer of [
      5,
      { items: 5 },
      { items: [5] },
      { items: [{ id: "x" }] },
      { items: [{ id: "x", name: 5 }] },
    ]) {
      ctx.groups.groups = async () => answer as never;
      ctx.groups.groupSets = async () => answer as never;
      await expect(ask(GROUPS), JSON.stringify(answer)).rejects.toThrow(DataError);
      await expect(ask(SETS), JSON.stringify(answer)).rejects.toThrow(DataError);
    }
    ctx.groups.groups = async (_caller, _context, query) => ({
      items: Array.from({ length: query.limit + 1 }, (_, index) => ({ id: `g${index}`, name: "n" })),
    });
    await expect(ask(GROUPS)).rejects.toThrow("must return at most the limit");
  });
});

describe("the preferences record", () => {
  it("answers the record of a user for an activity as JSON, below the path that the connector fixes", async () => {
    const ctx = served();
    const response = await get(ctx, RECORD, SCOPES.preferencesRecordReadonly);
    expect(response.headers["content-type"]).toBe("application/json");
    expect(json(response)).toEqual({
      "language-of-interface": "id",
      "additional-testing-time": { "time-factor": 1.5 },
      encouragement: true,
    });
    expect(ctx.preferences.calls[0]?.args).toEqual(["ana", "activity-1", undefined]);
  });

  it("answers only the fields that the request names, whatever the store gave", async () => {
    const ctx = served();
    const some = await get(
      ctx,
      `${RECORD}?fields=encouragement,language-of-interface,absent`,
      SCOPES.preferencesRecordReadonly,
    );
    expect(json(some)).toEqual({ "language-of-interface": "id", encouragement: true });
    expect(ctx.preferences.calls[0]?.args[2]).toEqual(["encouragement", "language-of-interface", "absent"]);
    const none = await get(ctx, `${RECORD}?fields=nothing`, SCOPES.preferencesRecordReadonly);
    expect(json(none)).toEqual({});
  });

  it("decodes the user and the activity of the path, and answers 404 for a record the store does not give", async () => {
    const ctx = served();
    ctx.preferences.records.set("user/1\u0000a b", { encouragement: true });
    const encoded = `${PLATFORM_ORIGIN}/ims/afapnp/v1p0/users/user%2F1/activities/a%20b/afapnprecords`;
    expect(json(await get(ctx, encoded, SCOPES.preferencesRecordReadonly))).toEqual({ encouragement: true });
    const missing = `${PLATFORM_ORIGIN}/ims/afapnp/v1p0/users/nobody/activities/activity-1/afapnprecords`;
    expect((await get(ctx, missing, SCOPES.preferencesRecordReadonly)).status).toBe(404);
  });

  it("refuses a fields parameter that is not one, and throws DataError for a record that is not an object", async () => {
    const ctx = served();
    for (const query of ["fields=a,,b", "fields=", "fields=a&fields=b"]) {
      expect((await get(ctx, `${RECORD}?${query}`, SCOPES.preferencesRecordReadonly)).status, query).toBe(400);
    }
    for (const record of [5, [1], "text", null]) {
      ctx.preferences.record = async () => record as never;
      await expect(get(ctx, RECORD, SCOPES.preferencesRecordReadonly), JSON.stringify(record)).rejects.toThrow(
        "The answer of PreferencesStore.record breaks its contract",
      );
    }
  });
});

describe("the options of the roster services", () => {
  it("throw DataError for stores that are not stores", async () => {
    const ctx = served();
    const cases: Partial<PlatformRequestOptions>[] = [
      { services: { roster: {} as never } },
      { services: { groups: { groups: () => undefined } as never } },
      { services: { preferences: {} as never } },
      { services: JSON.parse('{"roster":5}') as PlatformServices },
    ];
    for (const change of cases) {
      await expect(handle(ctx, call(MEMBERSHIPS, undefined), change), JSON.stringify(change)).rejects.toThrow(
        DataError,
      );
    }
  });
});
