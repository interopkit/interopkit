// biome-ignore-all lint/style/useNamingConvention: the names of the bodies of NRPS, Context Groups and the PNP connector are those of the specifications.

import { DataError, type Fetch } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { type LtiMessage, type PreferencesClaim, SCOPES } from "../src/index.js";
import { createServiceClient, handleLaunch, type ServiceClientOptions } from "../src/tool/index.js";
import { ACCESS_TOKEN_URL, ISSUER } from "./fake-platform.js";
import {
  FakeRosterLms,
  GROUP_SETS_URL,
  GROUPS,
  GROUPS_URL,
  MEMBERSHIPS_URL,
  PEOPLE,
  PNP_HOST,
  RECORD,
  SETS,
} from "./fake-roster.js";
import { cookieLogin, type Setup, setup } from "./tool-setup.js";

/**
 * The clients of Names and Role Provisioning, Context Groups and the AfA PNP Connector against a learning platform written from
 * their specifications: the fake platform checks the bearer token, the `Accept` and the filters of each request.
 */

/** The scopes that the learning platform offers for the three services. */
const OFFERED = [SCOPES.contextMembershipReadonly, SCOPES.contextGroupReadonly, SCOPES.preferencesRecordReadonly];
const CLAIM: PreferencesClaim = { hostUrl: PNP_HOST, activityIds: ["activity-1"], scopes: [OFFERED[2] ?? ""] };
const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
/** The comma that a `fields` list has between its names, percent-encoded as `URLSearchParams` writes it. */
const COMMA = "%2C";

/** A tool launched by a user against a learning platform, with the options of a client of its services. */
async function launched(registration: Parameters<typeof setup>[0] = {}): Promise<{
  readonly ctx: Setup;
  readonly lms: FakeRosterLms;
  readonly launch: LtiMessage;
  readonly options: ServiceClientOptions;
}> {
  const ctx = setup(registration);
  const lms = new FakeRosterLms(ctx.platform);
  const { request: post } = await cookieLogin(ctx);
  const launch = (await handleLaunch(post, ctx.options)) as LtiMessage;
  return { ctx, lms, launch, options: { ...ctx.options, fetch: lms.fetch, scopes: OFFERED } };
}

/** The scopes that the token requests of the platform asked for, in order. */
const asked = (ctx: Setup) => ctx.platform.grants.map((grant) => grant.scope);

describe("the members", () => {
  it("reads the first page: the members, the context, and the link to the differences", async () => {
    const { ctx, lms, launch, options } = await launched();
    const page = await createServiceClient(launch, options).members(MEMBERSHIPS_URL);
    expect(page.items).toHaveLength(PEOPLE.length);
    expect(page.items[0]).toMatchObject({
      status: "Active",
      name: "Jane M. Doe",
      givenName: "Jane",
      familyName: "Doe",
      middleName: "Marie",
      email: "jane@platform.example.edu",
      userId: "0ae836b9-7fc9-4060-006f-27b2066ac545",
      lisPersonSourcedId: "59254-6782-12ab",
      lti11LegacyUserId: "668321221-2879",
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
    });
    expect(page.context).toEqual({ id: "2923-abc", label: "CPS 435", title: "CPS 435 Learning Analytics" });
    expect(page.differences).toBe(`${MEMBERSHIPS_URL}?since=1422554502`);
    expect(page.next).toBeUndefined();
    expect(lms.calls).toEqual([`GET ${MEMBERSHIPS_URL}?limit=100`]);
    expect(asked(ctx)).toEqual([SCOPES.contextMembershipReadonly]);
  });

  it("follows the next link, which may be relative, through every page", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, { ...options, pageLimit: 2 });
    const ids: string[] = [];
    let page = await client.members(MEMBERSHIPS_URL);
    for (;;) {
      ids.push(...page.items.map((member) => member.userId));
      if (page.next === undefined) break;
      page = await client.members(page.next);
    }
    expect(ids).toEqual(PEOPLE.map((person) => person.user_id));
    expect(lms.calls.map((call) => new URL(call.slice(4)).searchParams.get("p"))).toEqual([null, "2", "4"]);
  });

  it("asks for a role, a limit, the members of a resource link, their groups and the differences, as NRPS names them", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const learners = await client.members(MEMBERSHIPS_URL, { role: "Learner", limit: 3 });
    expect(learners.items.map((member) => member.roles)).toEqual([[LEARNER], [LEARNER], [LEARNER]]);
    const byUri = await client.members(MEMBERSHIPS_URL, { role: LEARNER });
    expect(byUri.items).toHaveLength(4);
    await client.members(MEMBERSHIPS_URL, { resourceLinkId: "link-1", groups: true, since: "1422554502" });
    const search = new URL(lms.calls.at(-1)?.slice(4) ?? "").searchParams;
    expect([...search]).toEqual([
      ["rlid", "link-1"],
      ["groups", "true"],
      ["since", "1422554502"],
      ["limit", "100"],
    ]);
  });

  it("reads the message section of a resource link and the group enrollments of the members, which a plain read lacks", async () => {
    const { launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const plain = await client.members(MEMBERSHIPS_URL);
    expect(plain.items.some((member) => member.message !== undefined || member.groupEnrollments !== undefined)).toBe(
      false,
    );
    const link = await client.members(MEMBERSHIPS_URL, { resourceLinkId: "link-1", groups: true });
    expect(link.items).toHaveLength(PEOPLE.length - 1);
    expect(link.items[0]?.message).toEqual([
      {
        "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
        "https://purl.imsglobal.org/spec/lti/claim/custom": { country: "Canada" },
      },
    ]);
    const budi = link.items.find((member) => member.userId === "budi-1");
    expect(budi?.groupEnrollments).toEqual([
      { groupId: "44711f9f-64af-443a-bc3d-0abbfff73790" },
      { groupId: "bf2042b4-fdad-486a-86f3-bdb84e28a099" },
    ]);
  });

  it("reads the differences link as it is, with a member that no longer exists, and that read has no link of its own", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const first = await client.members(MEMBERSHIPS_URL);
    const changes = await client.members(first.differences ?? "");
    expect(changes.items.at(-1)).toMatchObject({ userId: "left-1", status: "Deleted" });
    expect(changes.differences).toBeUndefined();
    expect(lms.calls.at(-1)).toBe(`GET ${MEMBERSHIPS_URL}?since=1422554502&limit=100`);
  });

  it("ends the pages and the differences at a link of another origin, so that the token never leaves the platform", async () => {
    const { lms, launch, options } = await launched();
    lms.link =
      '<https://evil.example/memberships?p=2>; rel="next", <https://evil.example/memberships?since=1>; rel="differences"';
    const page = await createServiceClient(launch, options).members(MEMBERSHIPS_URL);
    expect([page.next, page.differences]).toEqual([undefined, undefined]);
  });

  it("reads a member with null strings as one without them, as Canvas sends them", async () => {
    const { lms, launch, options } = await launched();
    lms.answer = () =>
      Response.json({
        id: MEMBERSHIPS_URL,
        context: { id: "c1", label: null, title: null },
        members: [{ user_id: "u1", roles: [LEARNER], name: null, email: null, lis_person_sourcedid: null }],
      });
    const page = await createServiceClient(launch, options).members(MEMBERSHIPS_URL);
    expect(page.context).toEqual({ id: "c1", label: undefined, title: undefined });
    expect(page.items[0]).toMatchObject({ userId: "u1", name: undefined, email: undefined });
  });

  it("rejects with the ServiceError of a platform that has no such resource link, so that the tool starts again", async () => {
    const { launch, options } = await launched();
    await expect(
      createServiceClient(launch, options).members(MEMBERSHIPS_URL, { resourceLinkId: "gone" }),
    ).rejects.toMatchObject({ name: "ServiceError", status: 404 });
  });

  it("throws DataError at the first member that breaks its model, and for an answer that is not a membership", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const context = { id: "c1" };
    lms.answer = () =>
      Response.json({ id: MEMBERSHIPS_URL, context, members: [{ user_id: "u1", roles: [] }, { roles: [] }] });
    await expect(client.members(MEMBERSHIPS_URL)).rejects.toThrow(
      'The membership is invalid at members[1]: missing the property "user_id"',
    );
    lms.answer = () => Response.json([]);
    await expect(client.members(MEMBERSHIPS_URL)).rejects.toThrow(DataError);
    lms.answer = () => new Response("{", { headers: { "content-type": MEMBERSHIPS_URL } });
    await expect(client.members(MEMBERSHIPS_URL)).rejects.toThrow("not JSON");
  });

  it("reads within maxBytes and maxTokens, and names the option", async () => {
    const { lms, launch, options } = await launched();
    const body = JSON.stringify({ id: MEMBERSHIPS_URL, context: { id: "c1" }, members: [] });
    lms.answer = () => new Response(body);
    await expect(createServiceClient(launch, { ...options, maxBytes: 10 }).members(MEMBERSHIPS_URL)).rejects.toThrow(
      "maxBytes",
    );
    await expect(createServiceClient(launch, { ...options, maxTokens: 3 }).members(MEMBERSHIPS_URL)).rejects.toThrow(
      "the limit of the option maxTokens",
    );
  });

  it("refuses a URL that may not receive the token, a query of other types, and a call the platform did not offer", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await expect(client.members("https://localhost/memberships")).rejects.toMatchObject({
      reason: "service-origin-refused",
    });
    await expect(client.members("http://lms.example.edu/memberships")).rejects.toThrow(DataError);
    await expect(client.members(MEMBERSHIPS_URL, { limit: 0 })).rejects.toThrow(DataError);
    const without = createServiceClient(launch, { ...options, scopes: [SCOPES.contextGroupReadonly] });
    await expect(without.members(MEMBERSHIPS_URL)).rejects.toMatchObject({ reason: "scope-unavailable" });
    expect(lms.calls).toEqual([]);
  });
});

describe("the groups", () => {
  it("reads the groups of a context with their sets, tag and hidden flag, and the sets themselves", async () => {
    const { ctx, lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const groups = await client.groups(GROUPS_URL);
    expect(groups.items).toHaveLength(GROUPS.length);
    expect(groups.items[1]).toEqual({
      id: "bf2042b4-fdad-486a-86f3-bdb84e28a099",
      name: "Bob's Friday Group",
      tag: "marking",
      setIds: ["912cc53f-b431-447e-aff6-9d49aa9b72f2", "8127ccca-1d2d-496d-976c-393616ad1ff4"],
      hidden: true,
    });
    const sets = await client.groupSets(GROUP_SETS_URL);
    expect(sets.items.map((set) => set.name)).toEqual(SETS.map((set) => set.name));
    expect(sets.items[1]?.tag).toBe("http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection");
    expect(lms.calls).toEqual([`GET ${GROUPS_URL}?limit=100`, `GET ${GROUP_SETS_URL}?limit=100`]);
    expect(asked(ctx)).toEqual([SCOPES.contextGroupReadonly]);
  });

  it("asks for the groups of a user, and follows the next link through the pages", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const budi = await client.groups(GROUPS_URL, { userId: "budi-1" });
    expect(budi.items.map((group) => group.name)).toEqual(["Bob's Tuesday Group", "Bob's Friday Group"]);
    expect(lms.calls.at(-1)).toBe(`GET ${GROUPS_URL}?user_id=budi-1&limit=100`);
    const names: string[] = [];
    let page = await client.groups(GROUPS_URL, { limit: 2 });
    for (;;) {
      names.push(...page.items.map((group) => group.name));
      if (page.next === undefined) break;
      page = await client.groups(page.next);
    }
    expect(names).toHaveLength(GROUPS.length);
    const sets = await client.groupSets(GROUP_SETS_URL, { limit: 1 });
    expect(sets.next).toBe(`${GROUP_SETS_URL}?limit=1&p=1`);
    expect((await client.groupSets(sets.next ?? "")).next).toBeUndefined();
  });

  it("ends the pages at a link of another origin", async () => {
    const { lms, launch, options } = await launched();
    lms.link = '<https://evil.example/groups?p=1>; rel="next"';
    const client = createServiceClient(launch, options);
    expect((await client.groups(GROUPS_URL)).next).toBeUndefined();
    expect((await client.groupSets(GROUP_SETS_URL)).next).toBeUndefined();
  });

  it("throws DataError for a group without a name or an answer that is not a container, and names the option of a limit", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    lms.answer = () => Response.json({ id: GROUPS_URL, groups: [{ id: "g1" }] });
    await expect(client.groups(GROUPS_URL)).rejects.toThrow(
      'The groups is invalid at groups[0]: missing the property "name"',
    );
    lms.answer = () => Response.json({ id: GROUP_SETS_URL, sets: [{ name: "n" }] });
    await expect(client.groupSets(GROUP_SETS_URL)).rejects.toThrow('sets[0]: missing the property "id"');
    lms.answer = () => Response.json([]);
    await expect(client.groups(GROUPS_URL)).rejects.toThrow(DataError);
    await expect(client.groups(GROUPS_URL, { limit: 0 })).rejects.toThrow(DataError);
    await expect(client.groupSets(GROUP_SETS_URL, { limit: 0 })).rejects.toThrow(DataError);
    await expect(client.groups("http://lms.example.edu/groups")).rejects.toThrow(DataError);
    const without = createServiceClient(launch, { ...options, scopes: [SCOPES.contextMembershipReadonly] });
    await expect(without.groups(GROUPS_URL)).rejects.toMatchObject({ reason: "scope-unavailable" });
  });
});

describe("the preferences record", () => {
  it("reads the record of a user for an activity below the host of the claim, with the accept of the connector", async () => {
    const { ctx, lms, launch, options } = await launched();
    const record = await createServiceClient(launch, options).preferences(CLAIM, "ana-1", "activity-1");
    expect(record).toEqual(RECORD);
    expect(lms.calls).toEqual([`GET ${ISSUER}/ims/afapnp/v1p0/users/ana-1/activities/activity-1/afapnprecords`]);
    expect(lms.accepts).toEqual(["application/json"]);
    expect(asked(ctx)).toEqual([SCOPES.preferencesRecordReadonly]);
  });

  it("asks for the fields it wants and no other parameter, and encodes the user and the activity in the path", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const some = await client.preferences(CLAIM, "user/1", "a b/c", {
      fields: ["encouragement", "language-of-interface"],
    });
    expect(some).toEqual({ encouragement: true, "language-of-interface": "id" });
    expect(lms.calls[0]).toBe(
      `GET ${ISSUER}/ims/afapnp/v1p0/users/user%2F1/activities/a%20b%2Fc/afapnprecords?fields=encouragement${COMMA}language-of-interface`,
    );
  });

  it("appends the path to a host with a trailing slash or a path of its own", async () => {
    const { ctx, launch, options } = await launched();
    const seen: string[] = [];
    const fetch: Fetch = async (url, init) => {
      if (url === ACCESS_TOKEN_URL) return ctx.platform.fetch(url, init);
      seen.push(url);
      return Response.json({});
    };
    const client = createServiceClient(launch, { ...options, fetch });
    await client.preferences({ ...CLAIM, hostUrl: `${ISSUER}/` }, "u", "a");
    await client.preferences({ ...CLAIM, hostUrl: "https://example.edu/lti/afapnp-hosturl" }, "u", "a");
    expect(seen).toEqual([
      `${ISSUER}/ims/afapnp/v1p0/users/u/activities/a/afapnprecords`,
      "https://example.edu/lti/afapnp-hosturl/ims/afapnp/v1p0/users/u/activities/a/afapnprecords",
    ]);
  });

  it("answers undefined for a record that the platform does not have or does not share (404)", async () => {
    const { launch, options } = await launched();
    expect(await createServiceClient(launch, options).preferences(CLAIM, "nobody", "activity-1")).toBeUndefined();
  });

  it("throws DataError for a record that is not an object, and for arguments of other types", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    lms.answer = () => Response.json([1]);
    await expect(client.preferences(CLAIM, "ana-1", "activity-1")).rejects.toThrow(DataError);
    const parse = (text: string) => JSON.parse(text);
    await expect(client.preferences(parse("null"), "ana-1", "a")).rejects.toThrow(
      new DataError("The claim must be an object, found null."),
    );
    await expect(client.preferences(parse('{"hostUrl":"http://x.example"}'), "ana-1", "a")).rejects.toThrow(
      "The host URL of the claim must be an absolute https URL",
    );
    await expect(client.preferences(CLAIM, parse("5"), "a")).rejects.toThrow(DataError);
    await expect(client.preferences(CLAIM, "ana-1", parse('""'))).rejects.toThrow(DataError);
    await expect(client.preferences(CLAIM, "ana-1", "a", { fields: [] })).rejects.toThrow(DataError);
    const without = createServiceClient(launch, { ...options, scopes: [SCOPES.contextGroupReadonly] });
    await expect(without.preferences(CLAIM, "ana-1", "activity-1")).rejects.toMatchObject({
      reason: "scope-unavailable",
    });
  });
});

describe("the tokens of the three services", () => {
  it("asks for the scope of each service, once, and reuses it", async () => {
    const { ctx, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await client.members(MEMBERSHIPS_URL);
    await client.groups(GROUPS_URL);
    await client.groupSets(GROUP_SETS_URL);
    await client.preferences(CLAIM, "ana-1", "activity-1");
    await client.members(MEMBERSHIPS_URL);
    expect(asked(ctx)).toEqual([
      SCOPES.contextMembershipReadonly,
      SCOPES.contextGroupReadonly,
      SCOPES.preferencesRecordReadonly,
    ]);
  });

  it("drops the token that a service refuses with 401, and retries nothing", async () => {
    const { ctx, lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await client.members(MEMBERSHIPS_URL);
    lms.validToken = "another";
    await expect(client.members(MEMBERSHIPS_URL)).rejects.toMatchObject({ status: 401 });
    expect(lms.calls).toHaveLength(2);
    lms.validToken = "access-token-1";
    await client.members(MEMBERSHIPS_URL);
    expect(ctx.platform.grants).toHaveLength(2);
  });
});
