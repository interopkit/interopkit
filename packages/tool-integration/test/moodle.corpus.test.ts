// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canonicalizeRole, SCOPES } from "../src/index.js";
import { buildRegistrationInitiation, buildToolRegistration } from "../src/platform/index.js";
import { advanceScoreTimestamp, buildDeepLinkingResponse, createServiceClient } from "../src/tool/index.js";
import { type HttpsHost, serveHttps } from "./https-host.js";
import { Browser, createLocalNetwork } from "./local-network.js";
import { callService, formOf, setup, signIn } from "./moodle-driver.js";
import { createReferenceTool, type ReferenceTool } from "./moodle-tool.js";
import {
  CLOCK,
  createReferencePlatform,
  createRegistrations,
  type ReferencePlatform,
  referenceTool,
  resourceLinkMessage,
} from "./references-setup.js";
import { INSTRUCTOR, LEARNER } from "./roster-stores.js";

/** Moodle 5.3 in containers that `pnpm moodle` starts: `validation/moodle/README.md` says how. */

const MOODLE = process.env.MOODLE_ORIGIN ?? "";
const TOOL_ORIGIN = `https://${process.env.TOOL_HOST}:${process.env.TOOL_PORT}`;
const PLATFORM_ORIGIN = `https://${process.env.PLATFORM_HOST}:${process.env.PLATFORM_PORT}`;
const network = createLocalNetwork([{ origin: MOODLE, port: Number(process.env.MOODLE_HTTP_PORT) }]);
const { fetch: moodleFetch } = network;

/** The type of a course in the context claim, which Moodle as a tool requires of every launch. */
const COURSE_OFFERING = "http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering";
const FORM = { "content-type": "application/x-www-form-urlencoded" };
/** The state of a tool in Moodle once its administrator accepts it (`LTI_TOOL_STATE_CONFIGURED`). */
const CONFIGURED = 1;
/** The tasks of the cron of Moodle that synchronize the roster and the grades of a published course. */
const SYNC_MEMBERS = "\\enrol_lti\\local\\ltiadvantage\\task\\sync_members";
const SYNC_GRADES = "\\enrol_lti\\local\\ltiadvantage\\task\\sync_grades";
const SYNC_TOOL_GRADES = "enrol_lti\\local\\ltiadvantage\\task\\sync_tool_grades";

/** What `setup.php` prints when it adds an activity. */
interface Activity {
  readonly cmid: number;
  readonly gradeitem: number;
}

/** A user of Moodle as `setup.php` lists it. */
interface MoodleUser {
  readonly first: string;
  readonly last: string;
  readonly email: string;
  readonly auth: string;
  readonly enrolled: boolean;
  readonly roles: readonly string[];
}

const usersOfMoodle = async () => ((await setup("users")) as { users: Record<string, MoodleUser> }).users;

let admin: { browser: Browser; sesskey: string };

beforeAll(async () => {
  expect(MOODLE, "Run this file with pnpm moodle.").not.toBe("");
  await setup("reset-tools");
  await setup("init");
  const browser = new Browser(network.send);
  admin = { browser, sesskey: await signIn(browser, MOODLE, "admin", process.env.MOODLE_ADMIN_PASSWORD ?? "") };
});

describe("Moodle as the platform", () => {
  let host: HttpsHost;
  let tool: ReferenceTool;
  let typeId = 0;
  let gradeItem = 0;

  /** Posts a form to a route of the tool, as the browser does, and returns the tool's answer. */
  const postToTool = (url: string, fields: Readonly<Record<string, string>>, cookie?: string) =>
    tool.handle({
      method: "POST",
      url,
      headers: { ...FORM, ...(cookie === undefined ? {} : { cookie }) },
      body: new TextEncoder().encode(new URLSearchParams(fields).toString()),
    });

  /** The `name=value` pairs of the cookies that an answer of the tool sets, as a `cookie` header. */
  const cookieOf = (response: { readonly headers: Readonly<Record<string, string>> }) =>
    (response.headers["set-cookie"] ?? "")
      .split(/,(?=\s*\w+=)/u)
      .map((cookie) => cookie.split(";")[0]?.trim())
      .join("; ");

  /**
   * Plays the browser of a user who opens a page of Moodle that starts the tool: the page posts to the tool's login, the tool
   * sends the browser to Moodle to authenticate, Moodle's page posts the `id_token` and the `state` to the tool's launch URL, and
   * the tool answers.
   */
  async function open(browser: Browser, path: string) {
    const page = await browser.visit("GET", `${MOODLE}${path}`, [MOODLE]);
    const login = formOf(page.text);
    const initiated = await postToTool(login.action, login.fields);
    const authentication = await browser.visit("GET", initiated.headers.location ?? "", [MOODLE]);
    const posted = formOf(authentication.text);
    const launched = await postToTool(posted.action, posted.fields, cookieOf(initiated));
    return { login, initiated, launched };
  }

  const launched = () => {
    const launch = tool.launches.at(-1);
    if (launch === undefined) throw new Error("The tool has accepted no launch.");
    return launch;
  };
  const client = (scopes: readonly string[]) => createServiceClient(launched(), { ...tool.options, scopes });

  beforeAll(async () => {
    host = await serveHttps({
      certificate: process.env.SERVER_CERTIFICATE ?? "",
      key: process.env.SERVER_KEY ?? "",
      port: Number(process.env.TOOL_PORT),
    });
    tool = await createReferenceTool(TOOL_ORIGIN, moodleFetch);
    host.handler = tool.handle;
  });

  afterAll(async () => {
    await host.close();
  });

  it("registers the tool through Dynamic Registration, which the administrator then activates", async () => {
    const start = await admin.browser.request(
      "GET",
      `${MOODLE}/mod/lti/startltiadvregistration.php?url=${encodeURIComponent(tool.initiationUrl)}&sesskey=${admin.sesskey}`,
    );
    expect(start.status, start.text.slice(0, 300)).toBe(302);
    expect(start.location?.startsWith(tool.initiationUrl)).toBe(true);
    // The browser of the administrator opens the tool's initiation URL, which the tool's handler answers.
    const closed = await tool.handle({ method: "GET", url: start.location ?? "", headers: {}, body: new Uint8Array() });
    expect(closed.status, String(closed.body).slice(0, 400)).toBe(200);
    // Moodle answers with `"logo_uri": ""`, which the reader takes as no logo.
    expect(tool.registered.result).toMatchObject({ clientName: "Reference tool", clientId: expect.any(String) });
    expect(tool.registered.result?.logoUri).toBeUndefined();
    typeId = Number(tool.registered.result?.lti.deploymentId);
    expect(typeId).toBeGreaterThan(0);

    await callService(admin.browser, MOODLE, admin.sesskey, "mod_lti_update_tool_type", {
      id: typeId,
      state: CONFIGURED,
    });
    expect(tool.activate().deploymentIds).toEqual([String(typeId)]);
  });

  it("launches the tool for a learner, which validates the launch against the login", async () => {
    const created = await setup<Activity>("add-activity", { typeid: typeId, name: "Quiz", toolurl: tool.launchUrl });
    gradeItem = created.gradeitem;
    const browser = new Browser(network.send);
    await signIn(browser, MOODLE, "ana", "Passw0rd!-ana");
    const seen = await open(browser, `/mod/lti/launch.php?id=${created.cmid}`);
    expect(seen.launched.status, String(seen.launched.body).slice(0, 600)).toBe(200);
    expect(seen.initiated.headers["set-cookie"]).toContain("Secure");
    expect(launched()).toMatchObject({
      messageType: "LtiResourceLinkRequest",
      issuer: MOODLE,
      deploymentId: String(typeId),
      targetLinkUri: tool.launchUrl,
      user: {
        subject: "3",
        name: "Ana Candidate",
        givenName: "Ana",
        familyName: "Candidate",
        email: "ana@example.edu",
      },
      roles: ["http://purl.imsglobal.org/vocab/lis/v2/membership#Learner"],
      context: { label: "COURSE1", title: "Course 1" },
      resourceLink: { title: "Quiz" },
      platform: { productFamilyCode: "moodle" },
    });
    expect(launched().services.grades?.lineitem).toContain("/mod/lti/services.php/");
    expect(launched().services.roster?.contextMembershipsUrl).toContain("/memberships");
  });

  it("launches an activity whose target link has a query of its own, which the login and the launch both carry", async () => {
    const target = `${tool.launchUrl}?quiz=1`;
    const created = await setup<Activity>("add-activity", { typeid: typeId, name: "Quiz 1", toolurl: target });
    const browser = new Browser(network.send);
    await signIn(browser, MOODLE, "ana", "Passw0rd!-ana");
    const seen = await open(browser, `/mod/lti/launch.php?id=${created.cmid}`);
    expect(seen.login.fields.target_link_uri).toBe(target);
    expect(seen.launched.status, String(seen.launched.body).slice(0, 600)).toBe(200);
    expect(launched().targetLinkUri).toBe(target);
  });

  it("reads the line item of the launch, lists the container, creates a line item, posts a score and reads the results", async () => {
    const created = await setup<Activity>("add-activity", { typeid: typeId, name: "Quiz 2", toolurl: tool.launchUrl });
    gradeItem = created.gradeitem;
    const browser = new Browser(network.send);
    await signIn(browser, MOODLE, "ana", "Passw0rd!-ana");
    await open(browser, `/mod/lti/launch.php?id=${created.cmid}`);
    const grades = launched().services.grades;
    if (grades?.lineitem === undefined || grades.lineitems === undefined)
      throw new Error("The launch offers no grade services.");
    const service = client(grades.scopes);
    expect(await service.lineItem(grades.lineitem)).toMatchObject({ label: "Quiz 2", scoreMaximum: 100 });
    const before = await service.lineItems(grades.lineitems);
    expect(before.items.map((entry) => entry.label)).toContain("Quiz 2");

    const made = await service.createLineItem(grades.lineitems, {
      label: "Practice",
      scoreMaximum: 20,
      tag: "practice",
    });
    expect(made).toMatchObject({ label: "Practice", scoreMaximum: 20, tag: "practice" });
    expect((await service.lineItems(grades.lineitems)).items).toHaveLength(before.items.length + 1);

    await service.publishScore(grades.lineitem, {
      userId: "3",
      scoreGiven: 80,
      scoreMaximum: 100,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
      timestamp: advanceScoreTimestamp(undefined, Date.now()),
      comment: "Good work",
    });
    const { items } = (await setup("grades")) as {
      items: { id: number; grades: Record<string, { final: number; feedback: string }> }[];
    };
    expect(items.find((entry) => entry.id === gradeItem)?.grades.ana).toMatchObject({
      final: 80,
      feedback: "Good work",
    });

    // The client sends no `limit` with a request for results unless the caller names one, and Moodle answers such a request.
    const results = await service.results(grades.lineitem);
    expect(results.items).toHaveLength(1);
    expect(results.items[0]).toMatchObject({ userId: "3", resultScore: 80, resultMaximum: 100, comment: "Good work" });
    expect(results.next).toBeUndefined();

    // Moodle 5.3.0 answers a request for results that carries `limit` with 404 and an HTML page: for a line item of LTI 1.3 its
    // code takes the link to the first page from a variable that only the branch of LTI 2 sets (results.php, line 238, a call on
    // null). AGS 3.3 makes `limit` optional, which is why the request above has none.
    await expect(service.results(grades.lineitem, { limit: 5 })).rejects.toMatchObject({ status: 404 });
  });

  it("reads the members of the course, whose roles are simple names where the launch has URIs", async () => {
    const roster = launched().services.roster;
    if (roster === undefined) throw new Error("The launch offers no roster.");
    const page = await client([SCOPES.contextMembershipReadonly]).members(roster.contextMembershipsUrl);
    expect(page.context).toMatchObject({ label: "COURSE1" });
    expect(page.items.map((member) => member.userId).sort()).toEqual(["3", "4", "5"]);
    const jane = page.items.find((member) => member.userId === "4");
    expect(jane).toMatchObject({ givenName: "Jane", familyName: "Instructor", email: "jane@example.edu" });
    expect(jane?.roles).toEqual(["Instructor"]);
    expect(jane?.roles.map(canonicalizeRole)).toEqual(["http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"]);
  });

  it("takes the item that the tool chose in answer to a Deep Linking request, which Moodle verifies against the key set of the tool", async () => {
    const browser = new Browser(network.send);
    await signIn(browser, MOODLE, "jane", "Passw0rd!-jane");
    tool.answerDeepLinking = (request) =>
      buildDeepLinkingResponse(
        request,
        {
          items: [
            {
              type: "ltiResourceLink",
              title: "Quiz 4",
              url: `${tool.launchUrl}?quiz=4`,
              custom: { quiz: "4" },
              lineItem: { scoreMaximum: 40, label: "Quiz 4" },
            },
          ],
        },
        tool.options,
      );
    const seen = await open(browser, `/mod/lti/contentitem.php?id=${typeId}&course=2`);
    expect(launched()).toMatchObject({ messageType: "LtiDeepLinkingRequest", user: { subject: "4" } });
    const response = formOf(String(seen.launched.body));
    expect(response.action).toContain("/mod/lti/contentitem_return.php");
    expect(Object.keys(response.fields)).toEqual(["JWT"]);
    const returned = await browser.request("POST", response.action, { form: response.fields });
    expect(returned.status, returned.text.slice(0, 500)).toBe(200);
    // Moodle hands the item to the script of its page, which makes the activity from it.
    const item = /amd\.init\((\{.*?\})\);/su.exec(returned.text)?.[1] ?? "{}";
    expect(JSON.parse(item)).toMatchObject({
      name: "Quiz 4",
      toolurl: `${tool.launchUrl}?quiz=4`,
      instructorcustomparameters: "quiz=4",
      grade_modgrade_point: 40,
    });
  });
});

describe("Moodle as the tool", () => {
  const DEPLOYMENT = "platform-deployment-1";
  let platformHost: HttpsHost;
  let platform: ReferencePlatform;
  let registrations: ReturnType<typeof createRegistrations>;
  let clientId = "";
  let uuid = "";

  /** Opens the login of the tool for a message as a browser does, and returns what Moodle answers to the `id_token`. */
  async function launch(browser: Browser, message: Parameters<ReferencePlatform["login"]>[0]) {
    const redirected = await browser.visit("GET", await platform.login(message), [MOODLE]);
    const { action, idToken, state } = await platform.authenticate(redirected.location ?? "");
    return browser.request("POST", action, { form: { id_token: idToken, state } });
  }

  const message = (change: Partial<Parameters<typeof resourceLinkMessage>[0]> = {}) =>
    resourceLinkMessage({
      clientId,
      deploymentId: DEPLOYMENT,
      targetLinkUri: `${MOODLE}/enrol/lti/launch.php`,
      custom: { id: uuid },
      context: { id: "course-1", label: "C1", title: "Course 1", type: [COURSE_OFFERING] },
      ...change,
    });

  beforeAll(async () => {
    registrations = createRegistrations(DEPLOYMENT);
    platform = await createReferencePlatform({
      algorithm: "RS256",
      tool: referenceTool({ clientId: "registered-by-hand" }),
      origin: PLATFORM_ORIGIN,
      registrations: registrations.store,
      fetch: moodleFetch,
    });
    platformHost = await serveHttps({
      certificate: process.env.SERVER_CERTIFICATE ?? "",
      key: process.env.SERVER_KEY ?? "",
      port: Number(process.env.PLATFORM_PORT),
    });
    platformHost.handler = platform.handle;
    // The platform knows its members by name, as a real one does.
    platform.roster.people.splice(
      0,
      platform.roster.people.length,
      {
        userId: "jane",
        roles: [INSTRUCTOR],
        name: "Jane Instructor",
        givenName: "Jane",
        familyName: "Instructor",
        email: "jane@example.edu",
      },
      {
        userId: "ana",
        roles: [LEARNER],
        name: "Ana Candidate",
        givenName: "Ana",
        familyName: "Candidate",
        email: "ana@example.edu",
      },
      {
        userId: "budi",
        roles: [LEARNER],
        name: "Budi Learner",
        givenName: "Budi",
        familyName: "Learner",
        email: "budi@example.edu",
      },
    );
  });

  afterAll(async () => {
    await platformHost.close();
  });

  it("registers itself with the platform, which the administrator of the platform then activates", async () => {
    const draft = await setup<{ url: string }>("draft-registration", { name: "Reference platform" });
    const url = await buildRegistrationInitiation(draft.url, { config: platform.options.config, clock: CLOCK });
    const answer = await admin.browser.request("GET", url);
    expect(answer.status, answer.text.slice(0, 600)).toBe(200);
    expect(answer.text).toContain("org.imsglobal.lti.close");

    const [registered] = [...registrations.registered.values()];
    if (registered === undefined) throw new Error("Moodle did not register.");
    clientId = registered.clientId;
    expect(registered.configuration).toMatchObject({
      clientName: "Interopkit Moodle",
      applicationType: "web",
      grantTypes: ["client_credentials", "implicit"],
      tokenEndpointAuthMethod: "private_key_jwt",
      jwksUri: `${MOODLE}/enrol/lti/jwks.php`,
      redirectUris: [`${MOODLE}/enrol/lti/launch.php`, `${MOODLE}/enrol/lti/launch_deeplink.php`],
    });
    expect(registered.configuration.initiateLoginUri).toContain(`${MOODLE}/enrol/lti/login.php?id=`);
    expect(registered.configuration.lti.messages?.map((entry) => entry.type)).toEqual([
      "LtiDeepLinkingRequest",
      "LtiResourceLinkRequest",
    ]);
    platform.tools.set(
      clientId,
      buildToolRegistration(registered, {
        scopes: [SCOPES.lineitem, SCOPES.resultReadonly, SCOPES.score, SCOPES.contextMembershipReadonly],
        deploymentIds: [DEPLOYMENT],
      }),
    );
    // The gradebook and the roster of the platform belong to the tool that its administrator activated.
    for (const store of [platform.gradebook, platform.roster, platform.groups]) store.owner = clientId;
  });

  it("is launched for a learner, whom it provisions and enrols", async () => {
    uuid = (await setup<{ uuid: string }>("publish-tool", { name: "Published course" })).uuid;
    const launched = await launch(new Browser(network.send), message());
    expect(launched.status, launched.text.slice(0, 600)).toBe(200);
    expect(launched.text).toContain("/course/view.php?id=2");
    const users = await usersOfMoodle();
    expect(Object.values(users).find((user) => user.auth === "lti")).toMatchObject({
      first: "Ana",
      last: "Candidate",
      email: "ana@example.edu",
      enrolled: true,
      roles: ["student"],
    });
  });

  it("refuses a launch whose context has no type, which LTI Core makes optional", async () => {
    // Moodle passes the type of the context to a function that takes an array (tool_launch_service.php, line 132), so a launch
    // without it ends in an error page. The host of a platform that launches Moodle sends the type.
    const launched = await launch(
      new Browser(network.send),
      message({ context: { id: "course-2", label: "C2", title: "Course 2" } }),
    );
    expect(launched.status).toBe(404);
    expect(launched.text).toContain("Error");
  });

  it("is told the members by the platform, and posts the grades to its line item", async () => {
    await setup("run-task", { class: SYNC_MEMBERS });
    const users = await usersOfMoodle();
    // The members of the resource link are enrolled; the instructor is not a member of the link.
    const members = Object.entries(users).filter(([, user]) => user.auth === "lti" && user.enrolled);
    expect(members.map(([, user]) => user.first).sort()).toEqual(["Ana", "Budi"]);
    const ana = members.find(([, user]) => user.first === "Ana");

    const course = await setup<{ total: number; max: number }>("set-grade", { username: ana?.[0], grade: 77 });
    await setup("run-task", { class: SYNC_GRADES });
    const done = await setup("run-adhoc", { class: SYNC_TOOL_GRADES });
    expect(done.output).toContain("sent 1 grades");
    const kept = platform.gradebook.scores.get("course-1/quiz-1")?.get("ana");
    expect(kept).toMatchObject({
      scoreGiven: course.total,
      scoreMaximum: course.max,
      activityProgress: "Completed",
      gradingProgress: "FullyGraded",
    });
    // Moodle writes the timestamp as PHP does, with an offset of +hhmm.
    expect(kept?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/u);
  });
});
