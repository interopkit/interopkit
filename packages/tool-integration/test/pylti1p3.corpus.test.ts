// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SCOPES } from "../src/index.js";
import { readDeepLinkingResponse } from "../src/platform/index.js";
import { type HttpsHost, serveHttps } from "./https-host.js";
import {
  CLIENT_ID,
  COURSE,
  createReferencePlatform,
  DEPLOYMENT_ID,
  deepLinkingMessage,
  LINE_ITEM,
  type PlatformAlgorithm,
  type ReferencePlatform,
  referenceTool,
  resourceLinkMessage,
} from "./references-setup.js";

/** PyLTI1p3 2.0.0 as the tool, in a container that `pnpm pylti1p3` starts: `validation/pylti1p3/README.md` says how. */

const TOOL_ORIGIN = "https://pylti.example.org";
const LAUNCH_URL = `${TOOL_ORIGIN}/lti/launch`;
const PLATFORM_ORIGIN = `https://lms.example.edu:${process.env.PLATFORM_PORT}`;
const TOOL_URL = process.env.PYLTI_URL ?? "";
const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";

/** What `JSON.parse` gives, which is the answer of a counterparty: each assertion below checks the part that it reads. */
type Parsed = ReturnType<typeof JSON.parse>;

/** The answer of the tool to the browser. */
interface Answer {
  readonly status: number;
  readonly location: string | null;
  readonly json: Parsed;
}

/** The browser: it keeps the cookies of the tool, asks the tool at its loopback address and says that the page is `https`. */
class Browser {
  private readonly cookies = new Map<string, string>();

  async send(method: string, path: string, body?: URLSearchParams | Record<string, unknown>): Promise<Answer> {
    const headers: Record<string, string> = {
      "x-forwarded-proto": "https",
      cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "),
    };
    let payload: string | undefined;
    if (body instanceof URLSearchParams) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      payload = body.toString();
    } else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const answer = await fetch(`${TOOL_URL}${path}`, { method, headers, body: payload, redirect: "manual" });
    for (const cookie of answer.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const [name = "", ...value] = pair.split("=");
      this.cookies.set(name, value.join("="));
    }
    const text = await answer.text();
    return {
      status: answer.status,
      location: answer.headers.get("location"),
      json: text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : {},
    };
  }
}

/** Reaches the key set of the tool, which the platform fetches at the address that it registered. */
const toolFetch = async (url: string): Promise<Response> => {
  if (!url.startsWith(`${TOOL_ORIGIN}/`)) throw new TypeError(`No system answers at ${url}.`);
  return fetch(`${TOOL_URL}${url.slice(TOOL_ORIGIN.length)}`);
};

let host: HttpsHost;

beforeAll(async () => {
  host = await serveHttps({
    certificate: process.env.PLATFORM_CERTIFICATE ?? "",
    key: process.env.PLATFORM_KEY ?? "",
    port: Number(process.env.PLATFORM_PORT),
  });
});

afterAll(async () => {
  await host.close();
});

/** A platform that the tool is registered with, and a browser that has not visited the tool. */
async function world(algorithm: PlatformAlgorithm = "RS256") {
  const platform = await createReferencePlatform({
    algorithm,
    tool: referenceTool({
      loginUrl: `${TOOL_ORIGIN}/lti/login`,
      redirectUris: [LAUNCH_URL],
      jwksUrl: `${TOOL_ORIGIN}/lti/jwks`,
      scopes: [
        SCOPES.lineitem,
        SCOPES.lineitemReadonly,
        SCOPES.resultReadonly,
        SCOPES.score,
        SCOPES.contextMembershipReadonly,
        SCOPES.contextGroupReadonly,
      ],
    }),
    origin: PLATFORM_ORIGIN,
    fetch: (url) => toolFetch(url),
  });
  host.handler = platform.handle;
  const browser = new Browser();
  const configured = await browser.send("POST", "/admin/configure", {
    iss: PLATFORM_ORIGIN,
    client_id: CLIENT_ID,
    auth_login_url: platform.endpoints.authorization,
    auth_token_url: platform.endpoints.token,
    key_set_url: platform.endpoints.jwks,
    deployment_ids: [DEPLOYMENT_ID],
    launch_url: LAUNCH_URL,
  });
  expect(configured.status).toBe(200);
  return { platform, browser };
}

/** Plays the browser through the login and the launch of a message, and returns what the tool made of it. */
async function launch(
  platform: ReferencePlatform,
  browser: Browser,
  message = resourceLinkMessage({ targetLinkUri: LAUNCH_URL }),
) {
  const login = new URL(await platform.login(message));
  const redirected = await browser.send("GET", `/lti/login${login.search}`);
  expect(redirected.status, JSON.stringify(redirected.json)).toBe(302);
  const { action, idToken, state } = await platform.authenticate(redirected.location ?? "");
  expect(action).toBe(LAUNCH_URL);
  return browser.send("POST", "/lti/launch", new URLSearchParams({ id_token: idToken, state }));
}

describe("PyLTI1p3 as the tool: launch", () => {
  beforeEach(() => {
    expect(TOOL_URL, "Run this file with pnpm pylti1p3.").not.toBe("");
  });

  it.each(["RS256", "ES256"] as const)("validates a launch that the platform signs with %s", async (algorithm) => {
    const { platform, browser } = await world(algorithm);
    const launched = await launch(platform, browser);
    expect(launched.status, JSON.stringify(launched.json)).toBe(200);
    expect(launched.json).toMatchObject({
      is_resource_launch: true,
      is_deep_link_launch: false,
      has_ags: true,
      has_nrps: true,
      has_cgs: false,
    });
    expect(launched.json.launch).toMatchObject({
      iss: PLATFORM_ORIGIN,
      aud: CLIENT_ID,
      sub: "ana",
      name: "Ana Candidate",
      given_name: "Ana",
      family_name: "Candidate",
      email: "ana@example.edu",
      [`${CLAIM}message_type`]: "LtiResourceLinkRequest",
      [`${CLAIM}version`]: "1.3.0",
      [`${CLAIM}deployment_id`]: DEPLOYMENT_ID,
      [`${CLAIM}resource_link`]: { id: "link-1", title: "Quiz" },
      [`${CLAIM}context`]: { id: COURSE, label: "C1", title: "Course 1" },
      [`${CLAIM}custom`]: { exam: "tryout-1" },
    });
  });

  // LTI Core 4.1 has the redirect URI be one that the tool registered; PyLTI1p3 sends the launch URL that it is configured with,
  // whatever the target link of the login is, and takes the target from the claim of the launch.
  it("sends its launch URL as the redirect URI whatever the target link is, and reads the target from the launch", async () => {
    const { platform, browser } = await world();
    const target = `${TOOL_ORIGIN}/lti/tools/drawing`;
    const launched = await launch(platform, browser, resourceLinkMessage({ targetLinkUri: target }));
    expect(launched.status, JSON.stringify(launched.json)).toBe(200);
    expect(launched.json.launch[`${CLAIM}target_link_uri`]).toBe(target);
  });

  it("refuses a second authentication of the same login, which the platform keeps no message for", async () => {
    const { platform, browser } = await world();
    const login = new URL(await platform.login(resourceLinkMessage({ targetLinkUri: LAUNCH_URL })));
    const redirected = await browser.send("GET", `/lti/login${login.search}`);
    await platform.authenticate(redirected.location ?? "");
    const again = await platform.handle({
      method: "GET",
      url: redirected.location ?? "",
      headers: {},
      body: new Uint8Array(),
    });
    expect(again.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses an id_token that the browser carries to another state", async () => {
    const { platform, browser } = await world();
    const login = new URL(await platform.login(resourceLinkMessage({ targetLinkUri: LAUNCH_URL })));
    const redirected = await browser.send("GET", `/lti/login${login.search}`);
    const { idToken } = await platform.authenticate(redirected.location ?? "");
    const forged = await browser.send(
      "POST",
      "/lti/launch",
      new URLSearchParams({ id_token: idToken, state: "state-00000000-0000-4000-8000-000000000000" }),
    );
    expect(forged.status).toBe(400);
  });
});

describe("PyLTI1p3 as the tool: services", () => {
  beforeEach(() => {
    expect(TOOL_URL, "Run this file with pnpm pylti1p3.").not.toBe("");
  });

  it("reads the line item and the container, creates a line item, posts a score and reads the results", async () => {
    const { platform, browser } = await world();
    const launched = await launch(platform, browser);
    const api = `/api/${launched.json.launch_id}`;
    const lineItemUrl = `${PLATFORM_ORIGIN}/contexts/${COURSE}/line-items/${LINE_ITEM}`;

    const item = await browser.send("GET", `${api}/ags/line-item`);
    expect(item.json).toMatchObject({ id: lineItemUrl, label: "Quiz", scoreMaximum: 10 });
    const items = await browser.send("GET", `${api}/ags/line-items`);
    expect(items.json).toHaveLength(1);

    const created = await browser.send("POST", `${api}/ags/line-items`, {
      label: "Practice",
      scoreMaximum: 5,
      tag: "practice",
      resourceId: "practice-1",
    });
    expect(created.json).toMatchObject({
      label: "Practice",
      scoreMaximum: 5,
      tag: "practice",
      resourceId: "practice-1",
    });
    expect((await browser.send("GET", `${api}/ags/line-items`)).json).toHaveLength(2);
    // The tool finds a line item by its tag before it creates one, so a second request makes no second line item.
    const found = await browser.send("POST", `${api}/ags/line-items`, {
      label: "Practice",
      scoreMaximum: 5,
      tag: "practice",
    });
    expect(found.json.id).toBe(created.json.id);

    const score = await browser.send("POST", `${api}/ags/score`, {
      userId: "ana",
      scoreGiven: 8,
      scoreMaximum: 10,
      comment: "Good work",
      timestamp: "2026-11-02T10:00:00+00:00",
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
    });
    expect(score.status, JSON.stringify(score.json)).toBe(200);
    expect(platform.gradebook.scores.get(`${COURSE}/${LINE_ITEM}`)?.get("ana")).toMatchObject({
      scoreGiven: 8,
      scoreMaximum: 10,
      comment: "Good work",
    });
    const results = await browser.send("GET", `${api}/ags/results`);
    expect(results.json).toHaveLength(1);
    expect(results.json[0]).toMatchObject({ userId: "ana", resultScore: 8, resultMaximum: 10, scoreOf: lineItemUrl });
  });

  it("reads the members and the context of the roster", async () => {
    const { platform, browser } = await world();
    const launched = await launch(platform, browser);
    const api = `/api/${launched.json.launch_id}`;
    const members = await browser.send("GET", `${api}/nrps/members`);
    expect(members.status, JSON.stringify(members.json)).toBe(200);
    expect(members.json.map((member: { user_id: string }) => member.user_id)).toEqual(
      platform.roster.people.map((person) => person.userId),
    );
    expect(members.json.find((member: { user_id: string }) => member.user_id === "jane")).toMatchObject({
      name: "Jane M. Doe",
      email: "jane@platform.example.edu",
    });
    const context = await browser.send("GET", `${api}/nrps/context`);
    expect(context.json).toMatchObject({ label: "CPS 435", title: "CPS 435 Learning Analytics" });
  });

  it("reads the groups and the group sets of the context", async () => {
    const { platform, browser } = await world();
    const launched = await launch(
      platform,
      browser,
      resourceLinkMessage({
        targetLinkUri: LAUNCH_URL,
        services: { grades: { lineItemId: LINE_ITEM, container: true }, roster: true, groups: { sets: true } },
      }),
    );
    expect(launched.json.has_cgs).toBe(true);
    const api = `/api/${launched.json.launch_id}`;
    const groups = await browser.send("GET", `${api}/groups/groups`);
    expect(groups.status, JSON.stringify(groups.json)).toBe(200);
    expect(groups.json.map((group: { id: string }) => group.id)).toEqual(
      platform.groups.groups_.map((group) => group.id),
    );
    const sets = await browser.send("GET", `${api}/groups/sets`);
    expect(sets.json.map((set: { id: string }) => set.id)).toEqual(platform.groups.sets.map((set) => set.id));
  });
});

describe("PyLTI1p3 as the tool: Submission Review", () => {
  beforeEach(() => {
    expect(TOOL_URL, "Run this file with pnpm pylti1p3.").not.toBe("");
  });

  it("validates the launch of a review of the work of a learner, with the line item of the review", async () => {
    const { platform, browser } = await world();
    const launched = await launch(platform, browser, {
      ...resourceLinkMessage({
        targetLinkUri: LAUNCH_URL,
        user: {
          subject: "jane",
          givenName: "Jane",
          familyName: "Instructor",
          name: "Jane Instructor",
          email: "jane@example.edu",
        },
      }),
      messageType: "LtiSubmissionReviewRequest",
      forUser: { userId: "ana", givenName: "Ana", familyName: "Candidate" },
      services: { grades: { lineItemId: LINE_ITEM, container: true } },
    });
    expect(launched.status, JSON.stringify(launched.json)).toBe(200);
    expect(launched.json).toMatchObject({
      is_submission_review_launch: true,
      is_resource_launch: false,
      submission_review_user: { user_id: "ana", given_name: "Ana", family_name: "Candidate" },
    });
    expect(launched.json.launch[`${CLAIM}message_type`]).toBe("LtiSubmissionReviewRequest");
    const lineItem = await browser.send("GET", `/api/${launched.json.launch_id}/ags/line-item`);
    expect(lineItem.json).toMatchObject({ label: "Quiz" });
  });
});

describe("PyLTI1p3 as the tool: Deep Linking", () => {
  beforeEach(() => {
    expect(TOOL_URL, "Run this file with pnpm pylti1p3.").not.toBe("");
  });

  it("answers a request with items that the platform reads, with its own data", async () => {
    const { platform, browser } = await world();
    const launched = await launch(platform, browser, {
      ...deepLinkingMessage(PLATFORM_ORIGIN),
      targetLinkUri: LAUNCH_URL,
    });
    expect(launched.status, JSON.stringify(launched.json)).toBe(200);
    expect(launched.json.is_deep_link_launch).toBe(true);
    const answered = await browser.send("POST", `/api/${launched.json.launch_id}/deep-linking/items`, {
      items: [{ url: `${TOOL_ORIGIN}/lti/launch?quiz=4`, title: "Quiz 4", custom: { quiz: "4" } }],
    });
    expect(answered.status, JSON.stringify(answered.json)).toBe(200);
    expect(answered.json.return_url).toBe(`${PLATFORM_ORIGIN}/deep-linking`);
    const response = await readDeepLinkingResponse(
      {
        method: "POST",
        url: answered.json.return_url,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new TextEncoder().encode(new URLSearchParams({ JWT: answered.json.jwt }).toString()),
      },
      platform.toolMessage,
    );
    expect(response.data).toEqual({ picker: "reference" });
    expect(response.items[0]).toMatchObject({
      type: "ltiResourceLink",
      title: "Quiz 4",
      url: `${TOOL_ORIGIN}/lti/launch?quiz=4`,
      custom: new Map([["quiz", "4"]]),
    });
  });
});
