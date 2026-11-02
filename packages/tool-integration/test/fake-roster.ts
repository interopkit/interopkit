// biome-ignore-all lint/style/useNamingConvention: the names of the bodies of NRPS, Context Groups and the PNP connector are those of the specifications.

import type { Fetch } from "@interopkit/core";
import { expect } from "vitest";
import { type FakePlatform, ISSUER } from "./fake-platform.js";

export const MEMBERSHIPS_URL = `${ISSUER}/sections/2923/memberships`;
export const GROUPS_URL = `${ISSUER}/class/2923/groups`;
export const GROUP_SETS_URL = `${ISSUER}/class/2923/groups/sets`;
export const PNP_HOST = ISSUER;
const PNP_PATH = "/ims/afapnp/v1p0";
const MEMBERSHIP_TYPE = "application/vnd.ims.lti-nrps.v2.membershipcontainer+json";
const GROUPS_TYPE = "application/vnd.ims.lti-gs.v1.contextgroupcontainer+json";
const SETS_TYPE = "application/vnd.ims.lti-gs.v1.contextgroupsetcontainer+json";
const INSTRUCTOR = "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor";
const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

/** The people of the course: the member of the example of NRPS first, then four learners. */
export const PEOPLE = [
  {
    status: "Active",
    name: "Jane M. Doe",
    picture: "https://platform.example.edu/jane.jpg",
    given_name: "Jane",
    family_name: "Doe",
    middle_name: "Marie",
    email: "jane@platform.example.edu",
    user_id: "0ae836b9-7fc9-4060-006f-27b2066ac545",
    lis_person_sourcedid: "59254-6782-12ab",
    lti11_legacy_user_id: "668321221-2879",
    roles: [INSTRUCTOR],
  },
  ...["ana", "budi", "citra", "dewi"].map((name) => ({ user_id: `${name}-1`, roles: [LEARNER] })),
];

/** The group of each learner, by the identifier of the user. */
const ENROLLMENTS: Readonly<Record<string, readonly string[]>> = {
  "ana-1": ["44711f9f-64af-443a-bc3d-0abbfff73790"],
  "budi-1": ["44711f9f-64af-443a-bc3d-0abbfff73790", "bf2042b4-fdad-486a-86f3-bdb84e28a099"],
};

export const GROUPS = [
  {
    id: "44711f9f-64af-443a-bc3d-0abbfff73790",
    name: "Bob's Tuesday Group",
    set_ids: ["912cc53f-b431-447e-aff6-9d49aa9b72f2"],
    tag: "marking",
  },
  {
    id: "bf2042b4-fdad-486a-86f3-bdb84e28a099",
    name: "Bob's Friday Group",
    set_ids: ["912cc53f-b431-447e-aff6-9d49aa9b72f2", "8127ccca-1d2d-496d-976c-393616ad1ff4"],
    tag: "marking",
    hidden: true,
  },
  { id: "89230b3-a341-447e-aff6-9d354aa9b72a6", name: "The cool kids group" },
];

export const SETS = [
  { id: "912cc53f-b431-447e-aff6-9d49aa9b72f2", name: "The Chemistry Lab Group Set" },
  {
    id: "6af307fc-cc7d-4867-9e6f-20c85601367a",
    name: "Course Sections",
    tag: "http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection",
  },
];

/** The record of a user for an activity, with the members of the AfA PNP record that the connector shows. */
export const RECORD = {
  "language-of-interface": "id",
  "additional-testing-time": { "time-factor": 1.5 },
  encouragement: true,
};

/**
 * A learning platform's Names and Role Provisioning, Context Groups and AfA PNP Connector for a tool that has been launched,
 * written from the three specifications: the bearer token and the `Accept` of each request, the `role`, `limit`, `rlid`,
 * `groups` and `since` of NRPS (section 3), the `user_id` of Context Groups (2.1.2) and the `fields` of the connector, the
 * `Link` headers with `next` and `differences`, and the message section of a resource link. Its token endpoint and key set are
 * those of `FakePlatform`.
 */
export class FakeRosterLms {
  /** The calls to the services, as `METHOD url`, and the `Accept` and the bearer token of each. */
  readonly calls: string[] = [];
  readonly accepts: (string | undefined)[] = [];
  readonly tokens: string[] = [];
  /** Answers every call of a service with this answer while set. */
  answer: (() => Response) | undefined;
  /** The `Link` header of a page while set, in place of the ones the platform makes. */
  link: string | undefined;
  readonly platform: FakePlatform;
  validToken = "access-token-1";

  constructor(platform: FakePlatform) {
    this.platform = platform;
  }

  /** The `fetch` of the tool: the platform's token endpoint and key set, and the three services. */
  readonly fetch: Fetch = async (url, init) => {
    const serves =
      url.startsWith(MEMBERSHIPS_URL) || url.startsWith(GROUPS_URL) || new URL(url).pathname.startsWith(PNP_PATH);
    if (!serves) return this.platform.fetch(url, init);
    expect(init.redirect).toBe("manual");
    expect(init.method).toBe("GET");
    this.calls.push(`${init.method} ${url}`);
    this.accepts.push(init.headers.accept);
    const token = /^Bearer (.+)$/u.exec(init.headers.authorization ?? "")?.[1] ?? "";
    this.tokens.push(token);
    if (token !== this.validToken) return new Response("", { status: 401 });
    if (this.answer !== undefined) return this.answer();
    const parsed = new URL(url);
    if (`${parsed.origin}${parsed.pathname}` === MEMBERSHIPS_URL) return this.members(parsed);
    if (`${parsed.origin}${parsed.pathname}` === GROUP_SETS_URL) return this.sets(parsed);
    if (`${parsed.origin}${parsed.pathname}` === GROUPS_URL) return this.groups(parsed);
    return this.record(parsed);
  };

  private members(url: URL): Response {
    expect(this.accepts.at(-1)).toBe(MEMBERSHIP_TYPE);
    const search = url.searchParams;
    const limit = Number(search.get("limit") ?? "100");
    const start = Number(search.get("p") ?? "0");
    const role = search.get("role");
    const rlid = search.get("rlid");
    const since = search.get("since");
    let people = PEOPLE.filter(
      (person) => role === null || person.roles.some((each) => each.endsWith(`#${role}`) || each === role),
    );
    if (rlid === "gone") return new Response("", { status: 404 });
    if (rlid !== null) people = people.filter((person) => person.user_id !== "dewi-1");
    const page = people.slice(start, start + limit).map((person) => {
      const member: Record<string, unknown> = { ...person };
      if (search.get("groups") === "true") {
        member.group_enrollments = (ENROLLMENTS[person.user_id] ?? []).map((group_id) => ({ group_id }));
      }
      if (rlid !== null) {
        member.message = [
          {
            "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
            "https://purl.imsglobal.org/spec/lti/claim/custom": { country: "Canada" },
          },
        ];
      }
      return member;
    });
    if (since !== null) page.push({ status: "Deleted", user_id: "left-1", roles: [LEARNER] });
    const id = new URL(MEMBERSHIPS_URL);
    if (rlid !== null) id.searchParams.set("rlid", rlid);
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("p", String(start + limit));
    const differences = new URL(`${MEMBERSHIPS_URL}?since=1422554502`);
    const links = [
      ...(start + limit < people.length ? [`<${nextUrl.pathname}${nextUrl.search}>; rel="next"`] : []),
      ...(since === null ? [`<${differences.href}>; rel="differences"`] : []),
    ];
    const link = this.link ?? (links.length === 0 ? undefined : links.join(", "));
    const body = {
      id: id.href,
      context: { id: "2923-abc", label: "CPS 435", title: "CPS 435 Learning Analytics" },
      members: page,
    };
    return Response.json(body, {
      headers: { "content-type": MEMBERSHIP_TYPE, ...(link === undefined ? {} : { link }) },
    });
  }

  private groups(url: URL): Response {
    expect(this.accepts.at(-1)).toBe(GROUPS_TYPE);
    const search = url.searchParams;
    const userId = search.get("user_id");
    const limit = Number(search.get("limit") ?? "100");
    const start = Number(search.get("p") ?? "0");
    const all = GROUPS.filter((group) => userId === null || (ENROLLMENTS[userId] ?? []).includes(group.id));
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("p", String(start + limit));
    const link = this.link ?? (start + limit < all.length ? `<${nextUrl.href}>; rel="next"` : undefined);
    const body = {
      id: userId === null ? `${GROUPS_URL}/` : `${GROUPS_URL}?user_id=${userId}`,
      ...(userId === null ? {} : { user_id: userId }),
      groups: all.slice(start, start + limit),
    };
    return Response.json(body, { headers: { "content-type": GROUPS_TYPE, ...(link === undefined ? {} : { link }) } });
  }

  private sets(url: URL): Response {
    expect(this.accepts.at(-1)).toBe(SETS_TYPE);
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const start = Number(url.searchParams.get("p") ?? "0");
    const nextUrl = new URL(url);
    nextUrl.searchParams.set("p", String(start + limit));
    const link = this.link ?? (start + limit < SETS.length ? `<${nextUrl.href}>; rel="next"` : undefined);
    return Response.json(
      { id: GROUP_SETS_URL, sets: SETS.slice(start, start + limit) },
      { headers: { "content-type": SETS_TYPE, ...(link === undefined ? {} : { link }) } },
    );
  }

  private record(url: URL): Response {
    expect(this.accepts.at(-1)).toBe("application/json");
    const match = /^\/ims\/afapnp\/v1p0\/users\/([^/]+)\/activities\/([^/]+)\/afapnprecords$/u.exec(url.pathname);
    if (match === null) return new Response("", { status: 404 });
    const user = decodeURIComponent(match[1] ?? "");
    const fields = url.searchParams.get("fields");
    if (user !== "ana-1" && user !== "user/1") return new Response("", { status: 404 });
    const record: Record<string, unknown> =
      fields === null
        ? RECORD
        : Object.fromEntries(Object.entries(RECORD).filter(([name]) => fields.split(",").includes(name)));
    return Response.json(record, { headers: { "content-type": "application/json" } });
  }
}
