// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { afterEach, describe, expect, it, vi } from "vitest";
import { SCOPES } from "../src/index.js";
import { type RosterStore, readDeepLinkingResponse } from "../src/platform/index.js";
import { launch, world } from "./references-lti-tool.js";
import {
  CLIENT_ID,
  COURSE,
  DEPLOYMENT_ID,
  deepLinkingMessage,
  LINE_ITEM,
  PLATFORM,
  resourceLinkMessage,
  TOOL,
} from "./references-setup.js";
import { INSTRUCTOR, type MemoryRoster } from "./roster-stores.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A roster that states the status and the name of every member, as a platform does for a tool that requires them. */
function complete(roster: MemoryRoster): RosterStore {
  return {
    members: async (...args) => {
      const page = await roster.members(...args);
      return (
        page && {
          ...page,
          items: page.items.map((member) => ({
            ...member,
            status: member.status ?? "Active",
            name: member.name ?? `Member ${member.userId}`,
          })),
        }
      );
    },
  };
}

const CONTAINER = `${PLATFORM}/contexts/${COURSE}/line-items`;
const LINE_ITEM_URL = `${CONTAINER}/${LINE_ITEM}`;

describe("@lti-tool/core as the tool: launch", () => {
  it.each(["RS256", "ES256"] as const)("validates a launch that the platform signs with %s", async (algorithm) => {
    const { platform, tool } = await world(algorithm);
    const { claims, session } = await launch(platform, tool);
    expect(claims.iss).toBe(PLATFORM);
    expect(session.user.id).toBe("ana");
    expect(session.user.givenName).toBe("Ana");
    expect(session.context.id).toBe(COURSE);
    expect(session.resourceLink?.id).toBe("link-1");
    expect(session.customParameters).toEqual({ exam: "tryout-1" });
    expect(session.isStudent).toBe(true);
    expect(session.isAssignmentAndGradesAvailable).toBe(true);
    expect(session.isNameAndRolesAvailable).toBe(true);
  });

  it("offers the grade services and the roster at the addresses that the platform serves", async () => {
    const { platform, tool } = await world("RS256");
    const { session } = await launch(platform, tool);
    expect(session.services?.ags).toEqual({
      lineitem: LINE_ITEM_URL,
      lineitems: CONTAINER,
      scopes: [SCOPES.lineitem, SCOPES.lineitemReadonly, SCOPES.resultReadonly, SCOPES.score],
    });
    expect(session.services?.nrps?.membershipUrl).toBe(`${PLATFORM}/contexts/${COURSE}/memberships`);
  });

  it("refuses a launch a second time with the same state, as the platform keeps no second message", async () => {
    const { platform, tool } = await world("RS256");
    const login = new URL(await platform.login(resourceLinkMessage()));
    const authentication = await tool.handleLogin({
      client_id: CLIENT_ID,
      iss: PLATFORM,
      launchUrl: `${TOOL}/lti/launch`,
      login_hint: login.searchParams.get("login_hint") ?? "",
      target_link_uri: login.searchParams.get("target_link_uri") ?? "",
      lti_deployment_id: DEPLOYMENT_ID,
      lti_message_hint: login.searchParams.get("lti_message_hint") ?? undefined,
    });
    const { idToken, state } = await platform.authenticate(authentication);
    await tool.verifyLaunch(idToken, state);
    await expect(tool.verifyLaunch(idToken, state)).rejects.toThrow("already used");
    const again = await platform.handle({ method: "GET", url: authentication, headers: {}, body: new Uint8Array() });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  // LTI Core 5.3.6 makes `sub` the only required claim of the user, and 5.3.6.1 lets a platform omit the others; @lti-tool/core
  // reads a launch that omits one.
  it.each([
    ["given_name", { givenName: undefined }],
    ["family_name", { familyName: undefined }],
    ["email", { email: undefined }],
  ])("accepts a launch of a user who has no %s, as the specification allows", async (claim, absent) => {
    const { platform, tool } = await world("RS256");
    const user = {
      subject: "ana",
      name: "Ana Candidate",
      givenName: "Ana",
      familyName: "Candidate",
      email: "ana@example.edu",
      ...absent,
    };
    const { claims, session } = await launch(platform, tool, resourceLinkMessage({ user }));
    expect(claims).not.toHaveProperty(claim);
    expect(session.user.id).toBe("ana");
  });
});

describe("@lti-tool/core as the tool: Assignment and Grade Services and Names and Role Provisioning", () => {
  it("reads, creates, updates and deletes line items and reads them in the container", async () => {
    const { platform, tool } = await world("RS256");
    const { session } = await launch(platform, tool);
    const item = await tool.getLineItem(session);
    expect(item).toMatchObject({ id: LINE_ITEM_URL, label: "Quiz", scoreMaximum: 10, resourceLinkId: "link-1" });
    expect(await tool.listLineItems(session)).toHaveLength(1);
    expect(await tool.listLineItems(session, { resourceLinkId: "no-such-link" })).toHaveLength(0);

    const created = await tool.createLineItem(session, { label: "Practice", scoreMaximum: 5, tag: "practice" });
    expect(created).toMatchObject({ label: "Practice", scoreMaximum: 5, tag: "practice" });
    expect(created.id.startsWith(`${CONTAINER}/`)).toBe(true);
    expect(await tool.listLineItems(session)).toHaveLength(2);
    expect(await tool.listLineItems(session, { tag: "practice" })).toHaveLength(1);

    const updated = await tool.updateLineItem(session, { label: "Quiz, second try", scoreMaximum: 20 });
    expect(updated).toMatchObject({ id: LINE_ITEM_URL, label: "Quiz, second try", scoreMaximum: 20 });
    await tool.deleteLineItem(session);
    await expect(tool.getLineItem(session)).rejects.toThrow("get line item failed");
  });

  it("posts a score and reads the result back", async () => {
    const { platform, tool } = await world("RS256");
    const { session } = await launch(platform, tool);
    await tool.submitScore(session, {
      userId: "ana",
      scoreGiven: 8,
      scoreMaximum: 10,
      comment: "Good work",
      timestamp: "2026-11-02T10:00:00.000Z",
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
    });
    expect(platform.gradebook.scores.get(`${COURSE}/${LINE_ITEM}`)?.get("ana")).toMatchObject({
      scoreGiven: 8,
      scoreMaximum: 10,
      comment: "Good work",
    });
    const results = await tool.getScores(session);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ userId: "ana", resultScore: 8, resultMaximum: 10, comment: "Good work" });
    expect(results[0]?.id).toBe(`${LINE_ITEM_URL}/results?user_id=ana`);
    expect(results[0]?.scoreOf).toBe(LINE_ITEM_URL);
    expect(await tool.getScores(session, { userId: "nobody" })).toHaveLength(0);
  });

  // AGS 3.4.9 has a platform keep the later score. The platform answers 204 to the older one as well, since a tool cannot act on it.
  it("keeps the later of two scores whatever the order they arrive in", async () => {
    const { platform, tool } = await world("RS256");
    const { session } = await launch(platform, tool);
    const score = (scoreGiven: number, timestamp: string) => ({
      userId: "ana",
      scoreGiven,
      scoreMaximum: 10,
      timestamp,
      activityProgress: "Completed" as const,
      gradingProgress: "FullyGraded" as const,
    });
    await tool.submitScore(session, score(9, "2026-11-02T10:00:02.000Z"));
    await tool.submitScore(session, score(1, "2026-11-02T10:00:01.000Z"));
    expect((await tool.getScores(session))[0]?.resultScore).toBe(9);
  });

  // NRPS 2.3 makes the status of a member optional (Active when it is absent) and NRPS 2 has a tool never rely on more than the
  // required attributes; the schema of @lti-tool/core requires `status` and `name` of every member.
  it("refuses members that have no status and no name, which NRPS allows", async () => {
    const { platform, tool } = await world("RS256");
    const { session } = await launch(platform, tool);
    await expect(tool.getMembers(session)).rejects.toThrow("status");
  });

  it("reads the members of the context when the platform states each status and name", async () => {
    const { platform, tool } = await world("RS256");
    Object.assign(platform.options.services ?? {}, { roster: complete(platform.roster) });
    const { session } = await launch(platform, tool);
    const members = await tool.getMembers(session);
    expect(members.map((member) => member.userId)).toEqual(platform.roster.people.map((person) => person.userId));
    expect(members.find((member) => member.userId === "jane")).toMatchObject({
      name: "Jane M. Doe",
      email: "jane@platform.example.edu",
      roles: [INSTRUCTOR],
    });
    expect(members.every((member) => member.status === "Active")).toBe(true);
  });
});

describe("@lti-tool/core as the tool: Deep Linking", () => {
  it("answers a request with items that the platform reads, with its own data", async () => {
    const { platform, tool } = await world("RS256");
    const { session } = await launch(platform, tool, deepLinkingMessage());
    expect(session.isDeepLinkingAvailable).toBe(true);
    expect(session.services?.deepLinking).toMatchObject({
      returnUrl: `${PLATFORM}/deep-linking`,
      acceptTypes: ["ltiResourceLink"],
      acceptPresentationDocumentTargets: ["iframe", "window"],
      autoCreate: false,
    });
    const page = await tool.createDeepLinkingResponse(session, [
      {
        type: "ltiResourceLink",
        title: "Quiz 2",
        url: `${TOOL}/lti/launch?quiz=2`,
        custom: { quiz: "2" },
        lineItem: { scoreMaximum: 10, label: "Quiz 2" },
      },
    ]);
    const action = /action="([^"]*)"/u.exec(page)?.[1] ?? "";
    const jwt = /name="JWT" value="([^"]*)"/u.exec(page)?.[1] ?? "";
    expect(action).toBe(`${PLATFORM}/deep-linking`);
    const response = await readDeepLinkingResponse(
      {
        method: "POST",
        url: action,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new TextEncoder().encode(new URLSearchParams({ JWT: jwt }).toString()),
      },
      platform.toolMessage,
    );
    expect(response.data).toEqual({ picker: "reference" });
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      type: "ltiResourceLink",
      title: "Quiz 2",
      url: `${TOOL}/lti/launch?quiz=2`,
      custom: { quiz: "2" },
    });
  });
});
