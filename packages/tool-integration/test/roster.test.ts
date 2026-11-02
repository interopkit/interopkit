// biome-ignore-all lint/style/useNamingConvention: the names of the bodies of NRPS and of its query parameters are those of the specification.

import { DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MEMBER_STATUSES } from "../src/index.js";
import {
  readMember,
  readMemberQuery,
  readMembership,
  writeMember,
  writeMemberQuery,
  writeMembership,
} from "../src/protocol/internal.js";
import { FUZZ, fuzzJson } from "./fuzz.js";
import { expectRefusals, expectRefusesOtherTypes, plainJson } from "./services.js";

const member = {
  user_id: "0ae836b9-7fc9-4060-006f-27b2066ac545",
  roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"],
};
const membership = {
  id: "https://lms.example.com/sections/2923/memberships",
  context: { id: "2923-abc" },
  members: [member],
};

describe("the membership", () => {
  it("holds at least the user_id and roles of each member and the id of the context, as NRPS says a platform shares them", () => {
    expect(readMembership(membership)).toEqual({
      id: membership.id,
      context: { id: "2923-abc", label: undefined, title: undefined },
      members: [
        {
          userId: member.user_id,
          roles: member.roles,
          status: undefined,
          name: undefined,
          picture: undefined,
          givenName: undefined,
          familyName: undefined,
          middleName: undefined,
          email: undefined,
          lisPersonSourcedId: undefined,
          lti11LegacyUserId: undefined,
          message: undefined,
          groupEnrollments: undefined,
        },
      ],
    });
  });

  it("reads every property of a member, the message of a resource link and the group enrollments, and writes them as read", () => {
    const full = {
      status: "Active",
      name: "Jane M. Doe",
      picture: "https://platform.example.edu/jane.jpg",
      given_name: "Jane",
      family_name: "Doe",
      middle_name: "Marie",
      email: "jane@platform.example.edu",
      ...member,
      lis_person_sourcedid: "59254-6782-12ab",
      lti11_legacy_user_id: "668321221-2879",
      message: [
        {
          "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiResourceLinkRequest",
          "https://purl.imsglobal.org/spec/lti/claim/custom": { country: "Canada" },
        },
      ],
      group_enrollments: [{ group_id: "44711f9f" }, { group_id: "bf2042b4" }],
    };
    const read = readMember(full);
    expect(read).toMatchObject({
      status: "Active",
      givenName: "Jane",
      lisPersonSourcedId: "59254-6782-12ab",
      lti11LegacyUserId: "668321221-2879",
      groupEnrollments: [{ groupId: "44711f9f" }, { groupId: "bf2042b4" }],
    });
    expect(writeMember(read)).toEqual(full);
    expect(writeMembership(readMembership({ ...membership, members: [full] }))).toEqual({
      ...membership,
      members: [full],
    });
  });

  it("reads each status that NRPS names, a null string as absent, and refuses any other status", () => {
    for (const status of MEMBER_STATUSES) expect(readMember({ ...member, status }).status).toBe(status);
    expect(MEMBER_STATUSES).toEqual(["Active", "Inactive", "Deleted"]);
    expect(readMember({ ...member, name: null, email: null, lis_person_sourcedid: null })).toMatchObject({
      name: undefined,
      email: undefined,
    });
    expect(() => readMember({ ...member, status: "Gone" })).toThrow(DataError);
  });

  it("is refused when it lacks what NRPS requires", () => {
    expectRefusals(readMember, member, [
      ["no user_id", { user_id: undefined }],
      ["an empty user_id", { user_id: "" }],
      ["no roles", { roles: undefined }],
      ["roles that are not strings", { roles: [1] }],
      ["a name that is a number", { name: 5 }],
      ["a message that is not a list", { message: {} }],
      ["a message entry that is not an object", { message: [1] }],
      ["a group enrollment without a group_id", { group_enrollments: [{}] }],
    ]);
    expectRefusals(readMembership, membership, [
      ["no id", { id: undefined }],
      ["an id that is http", { id: "http://lms.example.com/m" }],
      ["no context", { context: undefined }],
      ["a context without an id", { context: { label: "x" } }],
      ["no members", { members: undefined }],
      ["a member that breaks a rule", { members: [{ roles: [] }] }],
    ]);
    expectRefusesOtherTypes(readMembership);
    expectRefusesOtherTypes(readMember);
  });

  it("is written only with an https address", () => {
    expect(() => writeMembership({ ...readMembership(membership), id: "http://x.example/" })).toThrow(DataError);
  });
});

describe("the filters of a request for members", () => {
  it("read role, limit, rlid, groups and since, and write them back", () => {
    const search = new URLSearchParams("role=Learner&limit=50&rlid=49566-rkk96&groups=true&since=1422554502&x=1");
    const query = readMemberQuery(search);
    expect(query).toEqual({
      role: "Learner",
      limit: 50,
      resourceLinkId: "49566-rkk96",
      groups: true,
      since: "1422554502",
    });
    expect(readMemberQuery(writeMemberQuery(query))).toEqual(query);
    expect(writeMemberQuery({ groups: false }).toString()).toBe("groups=false");
    expect(writeMemberQuery({}).toString()).toBe("");
    expect(readMemberQuery(new URLSearchParams()).groups).toBeUndefined();
  });

  it("refuse a parameter given twice, a limit that is not a positive integer and a groups that is not true or false", () => {
    for (const text of [
      "role=a&role=b",
      "limit=0",
      "limit=x",
      "groups=yes",
      "groups=",
      "rlid=a&rlid=b",
      "since=1&since=2",
    ]) {
      expect(() => readMemberQuery(new URLSearchParams(text)), text).toThrow(DataError);
    }
    expect(() => writeMemberQuery({ limit: 0 })).toThrow(DataError);
  });
});

describe("the bodies of NRPS", () => {
  const text = fc.string({ minLength: 1, maxLength: 8 });
  const some = <TValue>(value: fc.Arbitrary<TValue>) => fc.option(value, { nil: undefined });

  it("read back what was written, for any member and membership", () => {
    const members = fc.record({
      userId: text,
      roles: fc.array(text, { maxLength: 3 }),
      status: some(fc.constantFrom(...MEMBER_STATUSES)),
      name: some(text),
      picture: some(text),
      givenName: some(text),
      familyName: some(text),
      middleName: some(text),
      email: some(text),
      lisPersonSourcedId: some(text),
      lti11LegacyUserId: some(text),
      message: some(fc.array(fc.dictionary(text, plainJson, { maxKeys: 2 }), { maxLength: 2 })),
      groupEnrollments: some(fc.array(fc.record({ groupId: text }), { maxLength: 2 })),
    });
    const containers = fc.record({
      id: text.map((path) => `https://lms.example.com/${encodeURIComponent(path)}`),
      context: fc.record({ id: text, label: some(text), title: some(text) }),
      members: fc.array(members, { maxLength: 3 }),
    });
    fc.assert(
      fc.property(containers, (value) => {
        expect(readMembership(JSON.parse(JSON.stringify(writeMembership(value))))).toEqual(value);
      }),
      FUZZ,
    );
  });

  it("return a value or throw a DataError for any JSON, and for the examples with any value replaced", () => {
    fuzzJson(readMembership, [membership]);
    fuzzJson(readMember, [member]);
  });
});
