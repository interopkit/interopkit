import { describe, expect, it } from "vitest";
import {
  CMI5_ACTIVITY_TYPES,
  CMI5_CATEGORIES,
  CMI5_EXTENSIONS,
  readCourseStructure,
  readLaunchUrl,
} from "../src/index.js";
import { abandonSession, deriveCourseProgress, importCourse, prepareLaunch, waiveAu } from "../src/lms/index.js";
import { AU1, AU2, AU3, LEARNER, NAMESPACE, ORIGIN, testHost } from "./lms-host.js";
import {
  jsonOf,
  launchUnit,
  postFetch,
  register,
  sendStatement,
  statementsOf,
  unitStatement,
  verbsOf,
} from "./lms-session.js";

const PUBLISHER_BLOCK = "https://publisher.example.org/block";
const PUBLISHER_COURSE = "https://publisher.example.org/course";

describe("a session from launch to satisfaction", () => {
  it("writes launched, takes the statements of the unit, and satisfies its block before terminated", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    for (const [verb, result] of [
      ["initialized", undefined],
      ["completed", { completion: true, duration: "PT1M" }],
      ["passed", { success: true, duration: "PT2M", score: { scaled: 0.9 } }],
      ["terminated", { duration: "PT3M" }],
    ] as const) {
      expect((await sendStatement(host, launched, unitStatement(launched, verb, result))).status).toBe(204);
    }
    const statements = await statementsOf(host, registration.id);
    expect(verbsOf(statements)).toStrictEqual([
      "launched",
      "initialized",
      "completed",
      "passed",
      "satisfied",
      "terminated",
    ]);
    const satisfied = statements[4];
    expect(satisfied?.object).toStrictEqual({
      objectType: "Activity",
      id: host.course.blocks[0]?.lmsId,
      definition: { type: CMI5_ACTIVITY_TYPES.block },
    });
    expect(satisfied?.context?.contextActivities?.grouping).toStrictEqual([{ id: PUBLISHER_BLOCK }]);
    expect(satisfied?.context?.contextActivities?.category).toStrictEqual([{ id: CMI5_CATEGORIES.cmi5 }]);
    expect(satisfied?.context?.extensions?.[CMI5_EXTENSIONS.sessionId]).toBe(launched.launch.session);
    expect(satisfied?.actor).toStrictEqual(LEARNER);
    expect(satisfied?.authority).toStrictEqual({ objectType: "Agent", account: { homePage: ORIGIN, name: "lms" } });
    expect(
      deriveCourseProgress((await host.store.registration(registration.id)) ?? expect.unreachable(), host.course),
    ).toStrictEqual({
      satisfied: false,
      blocks: [{ id: PUBLISHER_BLOCK, satisfied: true }],
      aus: [
        { id: AU1, completed: true, passed: true, waived: false, satisfied: true },
        { id: AU2, completed: false, passed: false, waived: false, satisfied: true },
        { id: AU3, completed: false, passed: false, waived: false, satisfied: false },
      ],
    });
  });

  it("satisfies the course once its last member is, with the session id of the launch that did it", async () => {
    const host = testHost();
    const registration = await register(host);
    await waiveAu({ registration: registration.id, au: AU1, reason: "Tested Out" }, host.options);
    const launched = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    await sendStatement(host, launched, unitStatement(launched, "completed", { completion: true, duration: "PT1M" }));
    const statements = await statementsOf(host, registration.id);
    expect(verbsOf(statements)).toStrictEqual([
      "waived",
      "satisfied",
      "launched",
      "initialized",
      "completed",
      "satisfied",
    ]);
    const course = statements[5];
    expect(course?.object).toStrictEqual({
      objectType: "Activity",
      id: host.course.lmsId,
      definition: { type: CMI5_ACTIVITY_TYPES.course },
    });
    expect(course?.context?.contextActivities?.grouping).toStrictEqual([{ id: PUBLISHER_COURSE }]);
    expect(course?.context?.extensions?.[CMI5_EXTENSIONS.sessionId]).toBe(launched.launch.session);
  });

  it("satisfies at registration every unit whose moveOn is NotApplicable, and the blocks and course they fill", async () => {
    const host = testHost();
    const xml = `<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
      <course id="https://publisher.example.org/c2"><title><langstring>C</langstring></title><description><langstring>C</langstring></description></course>
      <block id="https://publisher.example.org/c2/b"><title><langstring>B</langstring></title><description><langstring>B</langstring></description>
        <au id="https://publisher.example.org/c2/au" moveOn="NotApplicable"><title><langstring>A</langstring></title><description><langstring>A</langstring></description><url>https://content.example.org/a.html</url></au>
      </block>
    </courseStructure>`;
    const course = importCourse(readCourseStructure(xml), {
      courseId: "c2",
      idBase: `${ORIGIN}/a/`,
      idNamespace: NAMESPACE,
    });
    host.store.courses.set("c2", course);
    const { createRegistration } = await import("../src/lms/index.js");
    const registration = await createRegistration({ courseId: "c2", actor: LEARNER }, host.options);
    expect(registration.satisfied).toBe(true);
    expect(registration.satisfiedBlocks).toStrictEqual(["https://publisher.example.org/c2/b"]);
    const launched = await launchUnit(host, {
      registration: registration.id,
      au: "https://publisher.example.org/c2/au",
    });
    expect(launched.launchData.launchMode).toBe("Normal");
    const statements = await statementsOf(host, registration.id);
    expect(verbsOf(statements)).toStrictEqual(["satisfied", "satisfied", "launched"]);
    expect(statements[0]?.context?.extensions?.[CMI5_EXTENSIONS.sessionId]).toBe(
      statements[1]?.context?.extensions?.[CMI5_EXTENSIONS.sessionId],
    );
  });
});

describe("a course of more than 1,000 units", () => {
  it("imports it, satisfies at registration the blocks its units fill, and launches its last unit", async () => {
    const host = testHost();
    const texts = "<title><langstring>T</langstring></title><description><langstring>D</langstring></description>";
    const unit = (index: number) =>
      `<au id="https://publisher.example.org/many/au/${index}" moveOn="${index === 1000 ? "Completed" : "NotApplicable"}">${texts}<url>https://content.example.org/${index}.html</url></au>`;
    const blocks = Array.from(
      { length: 77 },
      (_, block) =>
        `<block id="https://publisher.example.org/many/b/${block}">${texts}${Array.from({ length: 13 }, (_, at) => unit(block * 13 + at)).join("")}</block>`,
    ).join("");
    const xml = `<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd"><course id="https://publisher.example.org/many">${texts}</course>${blocks}</courseStructure>`;
    const course = importCourse(readCourseStructure(xml), {
      courseId: "many",
      idBase: `${ORIGIN}/m/`,
      idNamespace: NAMESPACE,
    });
    expect(course.aus).toHaveLength(1001);
    host.store.courses.set("many", course);
    const { createRegistration } = await import("../src/lms/index.js");
    const registration = await createRegistration({ courseId: "many", actor: LEARNER }, host.options);
    // Every block but the last, which holds the unit that needs completed, is satisfied at registration.
    expect(registration.satisfiedBlocks).toHaveLength(76);
    expect(registration.satisfied).toBe(false);
    const launched = await launchUnit(host, {
      registration: registration.id,
      au: "https://publisher.example.org/many/au/1000",
    });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    await sendStatement(host, launched, unitStatement(launched, "completed", { completion: true, duration: "PT1M" }));
    expect(verbsOf(await statementsOf(host, registration.id)).slice(-3)).toStrictEqual([
      "completed",
      "satisfied",
      "satisfied",
    ]);
  });
});

describe("the launch", () => {
  it("writes the launch data and the launched statement with what the structure and the input give", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, {
      registration: registration.id,
      au: AU1,
      launchMode: "Review",
      returnUrl: "https://lms.example.org/back",
      entitlementAlternate: "alt-1",
      contextTemplate: {
        contextActivities: { grouping: [{ id: AU1 }, { id: "https://lms.example.org/programs/p1" }] },
        extensions: { "https://lms.example.org/tenant": "t1" },
      },
    });
    expect(launched.launchData).toStrictEqual({
      contextTemplate: {
        contextActivities: { grouping: [{ id: AU1 }, { id: "https://lms.example.org/programs/p1" }] },
        extensions: { "https://lms.example.org/tenant": "t1", [CMI5_EXTENSIONS.sessionId]: launched.launch.session },
      },
      launchMode: "Review",
      moveOn: "CompletedAndPassed",
      launchParameters: "level=2",
      masteryScore: 0.8,
      returnURL: "https://lms.example.org/back",
      entitlementKey: { courseStructure: "key-1", alternate: "alt-1" },
    });
    const [statement] = await statementsOf(host, registration.id);
    expect(statement?.context?.extensions).toStrictEqual({
      [CMI5_EXTENSIONS.sessionId]: launched.launch.session,
      [CMI5_EXTENSIONS.launchMode]: "Review",
      [CMI5_EXTENSIONS.launchUrl]: "https://content.example.org/geology/au1/index.html?paramA=1",
      [CMI5_EXTENSIONS.moveOn]: "CompletedAndPassed",
      [CMI5_EXTENSIONS.launchParameters]: "level=2",
      [CMI5_EXTENSIONS.masteryScore]: 0.8,
    });
    expect(statement?.timestamp).toBe("2026-01-15T10:00:00.000Z");
  });

  it("builds the launch URL from the unit's own address, keeping its query and fragment, with the endpoint without its final slash", async () => {
    const host = testHost();
    const registration = await register(host);
    const launch = await prepareLaunch({ registration: registration.id, au: AU3 }, host.options);
    const url = new URL(launch.url);
    expect(`${url.origin}${url.pathname}${url.hash}`).toBe("https://content.example.org/minerals.html#start");
    expect(url.searchParams.get("endpoint")).toBe(`${ORIGIN}/xapi`);
    expect(url.searchParams.get("registration")).toBe(registration.id);
    expect(url.searchParams.get("activityId")).toBe(host.course.aus[2]?.lmsId);
    expect(JSON.parse(url.searchParams.get("actor") ?? "")).toStrictEqual(LEARNER);
    expect(new URL(url.searchParams.get("fetch") ?? "").pathname).toBe("/fetch");
    expect(launch.window).toBe("own");
    const first = await prepareLaunch({ registration: registration.id, au: AU1 }, host.options);
    expect(first.url.startsWith("https://content.example.org/geology/au1/index.html?paramA=1&endpoint=")).toBe(true);
    expect(first.window).toBe("any");
  });

  it("uses the same activity id for a unit in every launch and every registration, and never the publisher id", async () => {
    const host = testHost();
    const first = await launchUnit(host, { registration: (await register(host)).id, au: AU1 });
    const second = await launchUnit(host, { registration: (await register(host)).id, au: AU1 });
    expect(first.activityId).toBe(second.activityId);
    expect(first.activityId).not.toBe(AU1);
  });
});

describe("abandoned and terminated sessions", () => {
  it("abandons the open session of a unit when it is launched again, with the duration to its last statement", async () => {
    const host = testHost();
    const registration = await register(host);
    const first = await launchUnit(host, { registration: registration.id, au: AU1 });
    host.clock.advance(90_000);
    await sendStatement(host, first, unitStatement(first, "initialized"));
    host.clock.advance(60_000);
    const second = await launchUnit(host, { registration: registration.id, au: AU1 });
    const statements = await statementsOf(host, registration.id);
    expect(verbsOf(statements)).toStrictEqual(["launched", "initialized", "abandoned", "launched"]);
    expect(statements[2]?.result?.duration).toBe("PT1M30S");
    expect(statements[2]?.context?.extensions?.[CMI5_EXTENSIONS.sessionId]).toBe(first.launch.session);
    expect((await sendStatement(host, first, unitStatement(first, "experienced"))).status).toBe(401);
    expect((await sendStatement(host, second, unitStatement(second, "initialized"))).status).toBe(204);
  });

  it("abandons one of two launches of a unit made at once, so that one session of the unit stays open", async () => {
    const host = testHost();
    const registration = await register(host);
    const launches = await Promise.all([
      prepareLaunch({ registration: registration.id, au: AU1 }, host.options),
      prepareLaunch({ registration: registration.id, au: AU1 }, host.options),
    ]);
    const open = (await host.store.registration(registration.id))?.aus[AU1]?.session;
    const states = await Promise.all(launches.map(async ({ session }) => (await host.store.session(session))?.state));
    expect(states.toSorted()).toStrictEqual(["abandoned", "launched"]);
    expect((await host.store.session(open ?? ""))?.state).toBe("launched");
    expect(verbsOf(await statementsOf(host, registration.id))).toStrictEqual(["launched", "launched", "abandoned"]);
    const closed = launches.find(({ session }) => session !== open) ?? expect.unreachable();
    const answer = jsonOf(await postFetch(host, readLaunchUrl(closed.url).fetch));
    expect(answer).toStrictEqual(expect.objectContaining({ "error-code": "1" }));
  });

  it("abandons a session once, and tells a session that ended or never launched", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    expect(await abandonSession(launched.launch.session, host.options)).toBe("abandoned");
    expect(await abandonSession(launched.launch.session, host.options)).toBe("already-ended");
    expect(verbsOf(await statementsOf(host, registration.id))).toStrictEqual(["launched", "abandoned"]);
    const terminated = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, terminated, unitStatement(terminated, "initialized"));
    await sendStatement(host, terminated, unitStatement(terminated, "terminated", { duration: "PT1S" }));
    expect(await abandonSession(terminated.launch.session, host.options)).toBe("already-ended");
    expect((await sendStatement(host, terminated, unitStatement(terminated, "experienced"))).status).toBe(401);
  });

  it("refuses every request of a session from the moment its terminated statement is stored", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    const before = unitStatement(launched, "experienced");
    expect((await sendStatement(host, launched, before)).status).toBe(204);
    await sendStatement(host, launched, unitStatement(launched, "terminated", { duration: "PT1S" }));
    expect((await sendStatement(host, launched, before)).status).toBe(401);
    const query = new URLSearchParams({ registration: launched.registration });
    expect((await host.xapi("GET", `statements?${query}`, { authorization: launched.authorization })).status).toBe(401);
  });

  it("ends a token after maxSessionSeconds", async () => {
    const host = testHost({ maxSessionSeconds: 60 });
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 });
    host.clock.advance(61_000);
    expect((await sendStatement(host, launched, unitStatement(launched, "initialized"))).status).toBe(401);
  });
});

describe("waivers", () => {
  it("waives a unit once per registration, with the reason, success, completion and a session id of its own", async () => {
    const host = testHost();
    const registration = await register(host);
    expect(await waiveAu({ registration: registration.id, au: AU3, reason: "Administrative" }, host.options)).toBe(
      "waived",
    );
    expect(await waiveAu({ registration: registration.id, au: AU3, reason: "Again" }, host.options)).toBe(
      "already-waived",
    );
    const [waived] = await statementsOf(host, registration.id);
    expect(waived?.result).toStrictEqual({
      success: true,
      completion: true,
      extensions: { [CMI5_EXTENSIONS.reason]: "Administrative" },
    });
    expect(waived?.context?.contextActivities?.category).toStrictEqual([
      { id: CMI5_CATEGORIES.cmi5 },
      { id: CMI5_CATEGORIES.moveOn },
    ]);
    expect(waived?.object).toStrictEqual({ objectType: "Activity", id: host.course.aus[2]?.lmsId });
    const record = await host.store.registration(registration.id);
    expect(record?.aus[AU3]?.waived?.reason).toBe("Administrative");
  });
});

describe("rules across the sessions of a registration", () => {
  it("refuses a second completed in a later session of the registration, and a failed after a passed", async () => {
    const host = testHost();
    const registration = await register(host);
    const first = await launchUnit(host, { registration: registration.id, au: AU1 });
    await sendStatement(host, first, unitStatement(first, "initialized"));
    await sendStatement(host, first, unitStatement(first, "completed", { completion: true, duration: "PT1M" }));
    await sendStatement(
      host,
      first,
      unitStatement(first, "passed", { success: true, duration: "PT1M", score: { scaled: 0.85 } }),
    );
    await sendStatement(host, first, unitStatement(first, "terminated", { duration: "PT2M" }));
    const second = await launchUnit(host, { registration: registration.id, au: AU1 });
    await sendStatement(host, second, unitStatement(second, "initialized"));
    const completed = await sendStatement(
      host,
      second,
      unitStatement(second, "completed", { completion: true, duration: "PT1M" }),
    );
    expect(completed.status).toBe(403);
    expect(String(completed.body)).toContain("a second completed in the registration");
    const failed = await sendStatement(
      host,
      second,
      unitStatement(second, "failed", { success: false, duration: "PT1M" }),
    );
    expect(failed.status).toBe(403);
    expect(String(failed.body)).toContain("a failed after a passed");
  });

  it("reserves nothing of a statement that it refuses, so the unit may send it again corrected", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU3 });
    await sendStatement(host, launched, unitStatement(launched, "initialized"));
    const completed = unitStatement(launched, "completed", { completion: true, duration: "PT1M" });
    expect((await sendStatement(host, launched, { ...completed, result: { completion: true } })).status).toBe(403);
    expect(
      (await sendStatement(host, launched, { ...completed, id: "0b5c6d7e-8f90-4a1b-8c2d-eeeeeeeeeeee" })).status,
    ).toBe(204);
  });

  it("refuses the initialized statement of a unit that did not read the preferences of the learner", async () => {
    const host = testHost();
    const registration = await register(host);
    const launched = await launchUnit(host, { registration: registration.id, au: AU1 }, { readPreferences: false });
    const refused = await sendStatement(host, launched, unitStatement(launched, "initialized"));
    expect(refused.status).toBe(403);
    expect(String(refused.body)).toContain("before the assignable unit read the preferences");
  });
});
