import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { startAuSession } from "../src/au/index.js";
import { CMI5_CATEGORIES, CMI5_EXTENSIONS, readLaunchUrl } from "../src/index.js";
import { createRegistration, prepareLaunch } from "../src/lms/index.js";
import { launchFor, lmsFetch, startUnit, verbsIn } from "./au-host.js";
import { AU1, AU2, AU3, LEARNER, LMS_CREDENTIAL, ORIGIN, testHost } from "./lms-host.js";
import { jsonOf } from "./lms-session.js";

describe("a session of the runtime", () => {
  it("starts from its launch URL and sends its statements, which satisfy its block before terminated", async () => {
    const launch = await launchFor({ returnUrl: `${ORIGIN}/courses/geology` });
    const session = await startUnit(launch);
    expect(session.launch.registration).toBe(launch.registration);
    expect(session.launchData.masteryScore).toBe(0.8);
    expect(session.preferences).toStrictEqual({});
    expect(session.prior).toStrictEqual({ completed: false, passed: false });
    expect(await session.initialize()).toBe("recorded");
    expect(await session.complete()).toBe("recorded");
    expect(await session.judge({ scaled: 0.9, raw: 9, min: 0, max: 10 })).toBe("recorded");
    expect(await session.terminate()).toStrictEqual({ returnUrl: `${ORIGIN}/courses/geology` });
    expect(verbsIn(launch.host, launch.registration)).toStrictEqual([
      "launched",
      "initialized",
      "completed",
      "passed",
      "satisfied",
      "terminated",
    ]);
  });

  it("gives its statements the template, the categories of cmi5, the duration and the mastery score", async () => {
    const launch = await launchFor({
      contextTemplate: { contextActivities: { parent: [{ id: `${ORIGIN}/programs/p1` }] } },
    });
    const session = await startUnit(launch);
    await session.initialize();
    launch.host.clock.advance(90_000);
    await session.pass({ scaled: 0.85 });
    const passed = launch.host.lrs.held().at(-1);
    expect(passed?.result).toStrictEqual({ success: true, duration: "PT1M30S", score: { scaled: 0.85 } });
    expect(passed?.context?.contextActivities).toStrictEqual({
      parent: [{ id: `${ORIGIN}/programs/p1` }],
      grouping: [{ id: AU1 }],
      category: [{ id: CMI5_CATEGORIES.cmi5 }, { id: CMI5_CATEGORIES.moveOn }],
    });
    expect(passed?.context?.extensions?.[CMI5_EXTENSIONS.masteryScore]).toBe(0.8);
    expect(passed?.context?.extensions?.[CMI5_EXTENSIONS.sessionId]).toBe(
      session.launchData.contextTemplate.extensions?.[CMI5_EXTENSIONS.sessionId],
    );
  });

  it("skips what the rules or the launch mode forbid, without a request", async () => {
    const launch = await launchFor();
    const session = await startUnit(launch);
    expect(await session.complete()).toBe("skipped");
    await session.initialize();
    expect(await session.initialize()).toBe("skipped");
    expect(await session.pass({ scaled: 0.5 })).toBe("skipped");
    expect(await session.fail({ scaled: 0.5 })).toBe("recorded");
    expect(await session.pass({ scaled: 0.9 })).toBe("skipped");
    await session.terminate();
    expect(await session.progress(10)).toBe("skipped");
    expect(await session.terminate()).toStrictEqual({});
    const review = await startUnit(await launchFor({ launchMode: "Browse", au: AU3 }));
    await review.initialize();
    expect([await review.complete(), await review.pass(), await review.fail()]).toStrictEqual([
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  it("reads what the registration held at start, and skips a second completed of the registration", async () => {
    const host = testHost();
    const first = await launchFor({ au: AU3 }, host);
    const firstSession = await startUnit(first);
    await firstSession.initialize();
    await firstSession.complete();
    await firstSession.terminate();
    const second = await startUnit(await launchFor({ au: AU3 }, host, first.registration));
    expect(second.prior).toStrictEqual({ completed: true, passed: false });
    await second.initialize();
    expect(await second.complete()).toBe("skipped");
    const { waiveAu } = await import("../src/lms/index.js");
    await waiveAu({ registration: first.registration, au: AU1, reason: "Tested Out" }, host.options);
    const waived = await startUnit(await launchFor({}, host, first.registration));
    expect(waived.prior).toStrictEqual({ completed: false, passed: false, waived: { reason: "Tested Out" } });
  });

  it("sends progress and allowed statements with the template, and refuses a progress that is not a percentage", async () => {
    const launch = await launchFor();
    const session = await startUnit(launch);
    await session.initialize();
    expect(await session.progress(50)).toBe("recorded");
    const progressed = launch.host.lrs.held().at(-1);
    expect(progressed?.result?.extensions?.[CMI5_EXTENSIONS.progress]).toBe(50);
    expect(progressed?.context?.contextActivities?.category).toBeUndefined();
    for (const percent of [101, 1.5, -1, JSON.parse('"5"')]) expect(() => session.progress(percent)).toThrow(DataError);
    const id = "0b5c6d7e-8f90-4a1b-8c2d-123456789abc";
    const experienced = {
      id,
      verb: { id: "http://adlnet.gov/expapi/verbs/experienced" },
      context: { contextActivities: { other: [{ id: `${ORIGIN}/pages/2` }] }, extensions: { [`${ORIGIN}/page`]: 2 } },
    };
    expect(await session.send(experienced)).toBe("recorded");
    const sent = launch.host.lrs.held().at(-1);
    expect(sent?.id).toBe(id);
    expect(sent?.object).toStrictEqual({ objectType: "Activity", id: launch.host.course.aus[0]?.lmsId });
    expect(sent?.context?.contextActivities?.other).toStrictEqual([{ id: `${ORIGIN}/pages/2` }]);
    expect(await session.send({ verb: { id: "http://adlnet.gov/expapi/verbs/answered" } })).toBe("recorded");
    const definedLike = {
      verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
      context: { contextActivities: { category: [{ id: CMI5_CATEGORIES.cmi5 }] } },
    };
    expect(await session.send(definedLike)).toBe("skipped");
    expect(await session.send({ ...experienced, verb: { id: "http://adlnet.gov/expapi/verbs/attempted" } })).toBe(
      "refused",
    );
    expect(() => session.send(JSON.parse("null"))).toThrow(DataError);
    expect(() => session.send({ ...experienced, id: "x" })).toThrow(DataError);
  });

  it("judges a score by the mastery score, and refuses to judge without one or without a scaled score", async () => {
    const session = await startUnit(await launchFor());
    await session.initialize();
    expect(await session.judge({ scaled: 0.5 })).toBe("recorded");
    expect(() => session.judge({ raw: 5, min: 0, max: 10 })).toThrow(DataError);
    expect(() => session.judge(JSON.parse("null"))).toThrow(DataError);
    const free = await startUnit(await launchFor({ au: AU3 }));
    expect(() => free.judge({ scaled: 0.5 })).toThrow("no masteryScore");
  });

  it("keeps the State of its learner and never changes LMS.LaunchData", async () => {
    const session = await startUnit(await launchFor());
    const document = { contentType: "application/json", body: new TextEncoder().encode('{"page":3}') };
    expect(await session.state.put("bookmark", document)).toBe("written");
    expect(new TextDecoder().decode((await session.state.get("bookmark"))?.body)).toBe('{"page":3}');
    expect(await session.state.get("nothing")).toBeUndefined();
    expect(() => session.state.put("LMS.LaunchData", document)).toThrow(DataError);
  });

  it("saves the preferences of the learner, and takes a refusal of the LMS as a value", async () => {
    const launch = await launchFor();
    const session = await startUnit(launch);
    const preferences = { languagePreference: ["en-US", "fr-FR"], audioPreference: "on" } as const;
    expect(await session.savePreferences(preferences)).toBe("saved");
    expect(await session.savePreferences({ ...preferences, audioPreference: "off" })).toBe("saved");
    expect((await startUnit(await launchFor({ au: AU3 }, launch.host, launch.registration))).preferences).toStrictEqual(
      {
        languagePreference: ["en-US", "fr-FR"],
        audioPreference: "off",
      },
    );
    await expect(session.savePreferences(JSON.parse('{"audioPreference":"on"}'))).rejects.toThrow(DataError);
    const readOnly = testHost({ learnerPreferences: "read-only" });
    expect(await (await startUnit(await launchFor({}, readOnly))).savePreferences(preferences)).toBe("refused");
  });
});

describe("the start of a session", () => {
  it("refuses a second start of a launch URL, a code that the LMS did not make, and a store that fails", async () => {
    const launch = await launchFor();
    await startUnit(launch);
    expect(await startAuSession(launch.url, { fetch: launch.fetch })).toStrictEqual({
      refusal: "used-or-expired",
      message: "The authorization token has already been returned, or the launch expired.",
    });
    const forged = new URL(launch.url);
    const fetchUrl = new URL(readLaunchUrl(launch.url).fetch);
    fetchUrl.searchParams.set("code", `${fetchUrl.searchParams.get("code")}x`);
    forged.searchParams.set("fetch", fetchUrl.href);
    expect(await startAuSession(forged.href, { fetch: launch.fetch })).toMatchObject({ refusal: "security" });
    const failing = await launchFor();
    failing.host.store.failing.add("session");
    expect(await startAuSession(failing.url, { fetch: failing.fetch })).toMatchObject({ refusal: "application" });
  });

  it("refuses a launch whose LMS is not trusted, or that has no launch data", async () => {
    const launch = await launchFor();
    expect(
      await startAuSession(launch.url, { fetch: launch.fetch, trustedOrigins: ["https://other.example.org"] }),
    ).toStrictEqual({
      refusal: "untrusted-origin",
    });
    const host = launch.host;
    const empty = await launchFor({}, host, launch.registration);
    for (const key of [
      ...(await host.lrs.documents.list({ resource: "state", activityId: "", agent: LEARNER }, undefined)),
    ]) {
      expect(key).toBe("LMS.LaunchData");
    }
    await host.lrs.documents.deleteAll({
      resource: "state",
      activityId: host.course.aus[0]?.lmsId ?? "",
      agent: LEARNER,
    });
    expect(await startAuSession(empty.url, { fetch: empty.fetch, trustedOrigins: [ORIGIN] })).toStrictEqual({
      refusal: "no-launch-data",
    });
  });

  it("throws ServiceError for a fetch URL that answers what cmi5 does not define", async () => {
    const launch = await launchFor();
    const answering = (status: number, body: string) =>
      startAuSession(launch.url, {
        fetch: async (url, init) => (url.includes("/fetch") ? new Response(body, { status }) : launch.fetch(url, init)),
      });
    await expect(answering(200, "nope")).rejects.toThrow(ServiceError);
    await expect(answering(200, '{"error-code":"9"}')).rejects.toThrow(ServiceError);
    await expect(answering(200, `[${"0,".repeat(2000)}0]`)).rejects.toThrow(ServiceError);
    await expect(answering(500, "{}")).rejects.toThrow(ServiceError);
    expect(await answering(200, '{"error-code":"2"}')).toStrictEqual({ refusal: "security" });
  });

  it("adds the final slash that an endpoint lacks, and takes one that has it", async () => {
    const launch = await launchFor();
    const withSlash = new URL(launch.url);
    withSlash.searchParams.set("endpoint", `${ORIGIN}/xapi/`);
    const started = await startAuSession(withSlash.href, { fetch: launch.fetch });
    expect("session" in started).toBe(true);
  });

  it("refuses launch data or preferences that are not JSON or are larger than their limits", async () => {
    const launch = await launchFor();
    const { host } = launch;
    const parameters = readLaunchUrl(launch.url);
    const putDocument = async (path: string, body: string, contentType = "text/plain") =>
      host.xapi("PUT", path, {
        authorization: LMS_CREDENTIAL,
        body,
        headers: { "content-type": contentType, "if-none-match": "*" },
      });
    const preferences = `agents/profile?${new URLSearchParams({ profileId: "cmi5LearnerPreferences", agent: JSON.stringify(LEARNER) })}`;
    await putDocument(preferences, "not json");
    await expect(startUnit(launch)).rejects.toThrow("preferences of the learner is not JSON");
    const big = await launchFor({}, host, launch.registration);
    await host.xapi("DELETE", preferences, { authorization: LMS_CREDENTIAL });
    await putDocument(
      preferences,
      JSON.stringify({ languagePreference: "en-US", audioPreference: "on", pad: "x".repeat(5000) }),
      "application/json",
    );
    await expect(startUnit(big)).rejects.toThrow(ServiceError);
    await host.xapi("DELETE", preferences, { authorization: LMS_CREDENTIAL });
    const broken = await launchFor({}, host, launch.registration);
    const state = `activities/state?${new URLSearchParams({
      activityId: parameters.activityId,
      agent: JSON.stringify(LEARNER),
      registration: launch.registration,
      stateId: "LMS.LaunchData",
    })}`;
    await host.xapi("DELETE", state, { authorization: LMS_CREDENTIAL });
    await putDocument(state, "{");
    await expect(startUnit(broken)).rejects.toThrow("launch data is not JSON");
  });

  it("refuses options and a resume that are not valid", async () => {
    const launch = await launchFor();
    for (const options of [null, {}, { fetch: "f" }]) {
      await expect(startAuSession(launch.url, JSON.parse(JSON.stringify(options)))).rejects.toThrow(DataError);
    }
    const resume = {
      registration: launch.registration,
      activityId: readLaunchUrl(launch.url).activityId,
      token: "t",
      sent: [],
      ended: false,
    };
    for (const change of [
      { trustedOrigins: ["http://lms.example.org"] },
      { trustedOrigins: ["https://lms.example.org/path"] },
      { timeoutMs: 0 },
      { resume: { token: "t" } },
      { resume: { ...resume, registration: "r" } },
      { resume: { ...resume, activityId: "not an iri" } },
      { resume: { ...resume, sent: ["launched"] } },
    ]) {
      await expect(
        startAuSession(launch.url, { fetch: launch.fetch, ...JSON.parse(JSON.stringify(change)) }),
        JSON.stringify(change),
      ).rejects.toThrow(DataError);
    }
    await expect(startAuSession(JSON.parse("1"), { fetch: launch.fetch })).rejects.toThrow(DataError);
    const other = {
      registration: "9f0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d",
      activityId: readLaunchUrl(launch.url).activityId,
      token: "t",
      sent: [],
      ended: false,
    };
    await expect(startAuSession(launch.url, { fetch: launch.fetch, resume: other })).rejects.toThrow("another launch");
  });
});

describe("a reload and the failures of the LMS", () => {
  it("resumes a session after a reload without a second POST to the fetch URL", async () => {
    const launch = await launchFor();
    const session = await startUnit(launch);
    await session.initialize();
    const resume = JSON.parse(JSON.stringify(session.resume));
    expect(resume).toMatchObject({ registration: launch.registration, sent: ["initialized"], ended: false });
    const reloaded = await startUnit(launch, { resume });
    expect(await reloaded.initialize()).toBe("skipped");
    expect(await reloaded.complete()).toBe("recorded");
    expect(verbsIn(launch.host, launch.registration)).toStrictEqual(["launched", "initialized", "completed"]);
  });

  it("takes 401 and 403 of the LMS as refusals, and counts the session as ended on 401", async () => {
    const launch = await launchFor();
    const session = await startUnit(launch);
    await session.initialize();
    const { abandonSession } = await import("../src/lms/index.js");
    const status = { value: 403 };
    const refusing = await startUnit(launch, {
      resume: session.resume,
      fetch: async (url, init) =>
        init.method === "PUT" && url.includes("/statements")
          ? new Response("no", { status: status.value })
          : launch.fetch(url, init),
    });
    expect(await refusing.complete()).toBe("refused");
    status.value = 401;
    expect(await refusing.complete()).toBe("refused");
    expect(refusing.resume.ended).toBe(true);
    expect(await refusing.complete()).toBe("skipped");
    await abandonSession(
      String(session.launchData.contextTemplate.extensions?.[CMI5_EXTENSIONS.sessionId]),
      launch.host.options,
    );
    expect(await session.complete()).toBe("refused");
  });

  it("sends a statement again with its id after a failed request, and throws what the LRS fails with", async () => {
    const launch = await launchFor();
    let fail = 1;
    const session = await startUnit(launch, {
      fetch: async (url, init) => {
        if (init.method === "PUT" && url.includes("/statements") && fail > 0) {
          fail -= 1;
          return new Response("busy", { status: 503 });
        }
        return launch.fetch(url, init);
      },
    });
    await expect(session.initialize()).rejects.toThrow(ServiceError);
    expect(await session.initialize()).toBe("recorded");
    expect(verbsIn(launch.host, launch.registration)).toStrictEqual(["launched", "initialized"]);
  });

  it("refuses the save of preferences that the LMS answers with a failed precondition", async () => {
    const launch = await launchFor();
    const session = await startUnit(launch, {
      fetch: async (url, init) =>
        init.method === "PUT" && url.includes("/agents/profile")
          ? new Response("", { status: 412 })
          : launch.fetch(url, init),
    });
    expect(await session.savePreferences({ languagePreference: ["en-US"], audioPreference: "on" })).toBe("refused");
    const failing = await startUnit(await launchFor({}, launch.host, launch.registration), {
      fetch: async (url, init) =>
        init.method === "PUT" && url.includes("/agents/profile")
          ? new Response("", { status: 500 })
          : launch.fetch(url, init),
    });
    await expect(failing.savePreferences({ languagePreference: ["en-US"], audioPreference: "on" })).rejects.toThrow(
      ServiceError,
    );
  });

  it("returns only an http or https return URL from terminate", async () => {
    const host = testHost();
    const registration = await createRegistration({ courseId: "geology", actor: LEARNER }, host.options);
    const launch = await prepareLaunch({ registration: registration.id, au: AU2 }, host.options);
    const parameters = readLaunchUrl(launch.url);
    const state = `activities/state?${new URLSearchParams({
      activityId: parameters.activityId,
      agent: JSON.stringify(LEARNER),
      registration: registration.id,
      stateId: "LMS.LaunchData",
    })}`;
    const current = jsonOf(await host.xapi("GET", state, { authorization: LMS_CREDENTIAL })) as Record<string, unknown>;
    await host.xapi("PUT", state, {
      authorization: LMS_CREDENTIAL,
      body: { ...current, returnURL: "ftp://lms.example.org/back" },
    });
    const started = await startAuSession(launch.url, { fetch: lmsFetch(host) });
    if (!("session" in started)) throw new Error(started.refusal);
    await started.session.initialize();
    expect(await started.session.terminate()).toStrictEqual({});
  });
});
