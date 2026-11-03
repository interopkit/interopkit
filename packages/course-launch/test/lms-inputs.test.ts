import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { readCourseStructure } from "../src/index.js";
import {
  abandonSession,
  createRegistration,
  deriveCourseProgress,
  extendLrsOptions,
  handleFetchRequest,
  importCourse,
  prepareLaunch,
  waiveAu,
} from "../src/lms/index.js";
import { AU1, AU2, COURSE_XML, LEARNER, NAMESPACE, ORIGIN, testHost } from "./lms-host.js";
import { register } from "./lms-session.js";

const STRUCTURE = readCourseStructure(COURSE_XML, { packaged: true });
const IMPORT = {
  courseId: "c",
  idBase: `${ORIGIN}/a/`,
  idNamespace: NAMESPACE,
  contentBase: "https://content.example.org/",
};

describe("importCourse", () => {
  it("makes the same ids at every import of a course, and other ids in another course", () => {
    const first = importCourse(STRUCTURE, IMPORT);
    expect(importCourse(STRUCTURE, IMPORT)).toStrictEqual(first);
    const other = importCourse(STRUCTURE, { ...IMPORT, courseId: "d" });
    expect(other.lmsId).not.toBe(first.lmsId);
    expect(first.aus.map(({ blocks }) => blocks)).toStrictEqual([
      ["https://publisher.example.org/block"],
      ["https://publisher.example.org/block"],
      [],
    ]);
    expect(first.aus[0]?.url).toBe("https://content.example.org/au1/index.html?paramA=1");
  });

  it("refuses input that is not valid, a relative URL without a content base, and a base that makes no IRI", () => {
    for (const input of [
      null,
      { ...IMPORT, courseId: "" },
      { ...IMPORT, idNamespace: "x" },
      { ...IMPORT, contentBase: "https://content.example.org/no-slash" },
      { ...IMPORT, contentBase: "ftp://content.example.org/" },
      { ...IMPORT, extra: 1 },
    ]) {
      expect(() => importCourse(STRUCTURE, JSON.parse(JSON.stringify(input))), JSON.stringify(input)).toThrow(
        DataError,
      );
    }
    const { contentBase: _, ...absoluteOnly } = IMPORT;
    expect(() => importCourse(STRUCTURE, absoluteOnly)).toThrow("no contentBase");
    expect(() => importCourse(STRUCTURE, { ...IMPORT, idBase: "not an iri " })).toThrow("idBase");
    expect(() => importCourse(JSON.parse("null"), IMPORT)).toThrow(DataError);
  });

  it("imports and launches a unit of a scheme that the host names, as it read the structure", async () => {
    const xml = COURSE_XML.replace("https://content.example.org/glossary.html", "myapp://glossary");
    const read = readCourseStructure(xml, { packaged: true, launchSchemes: ["https", "myapp"] });
    expect(() => importCourse(read, IMPORT)).toThrow("does not start with a scheme that the LMS launches");
    const course = importCourse(read, { ...IMPORT, launchSchemes: ["https", "myapp"] });
    expect(course.aus[1]?.url).toBe("myapp://glossary");
    const host = testHost();
    host.store.courses.set("c", course);
    const registration = await createRegistration({ courseId: "c", actor: LEARNER }, host.options);
    const launch = await prepareLaunch({ registration: registration.id, au: AU2 }, host.options);
    expect(launch.url.startsWith("myapp://glossary?endpoint=")).toBe(true);
  });

  it("refuses an id of the LMS that is a publisher id of the structure", () => {
    const course = importCourse(STRUCTURE, IMPORT);
    const clash = { ...STRUCTURE, course: { ...STRUCTURE.course, id: course.aus[0]?.lmsId ?? "" } };
    expect(() => importCourse(clash, IMPORT)).toThrow("publisher id");
  });
});

describe("the options of the LMS", () => {
  it("refuses options that are not valid", async () => {
    const host = testHost();
    const cases: readonly Record<string, unknown>[] = [
      { endpoint: `${ORIGIN}/xapi` },
      { endpoint: "http://lms.example.org/xapi/" },
      { fetchEndpoint: `${ORIGIN}/fetch#a` },
      { authority: { name: "no identifier" } },
      { records: {} },
      { fetchLifetimeSeconds: 0 },
      { learnerPreferences: "never" },
      { unknown: true },
    ];
    for (const change of cases) {
      await expect(
        register({ ...host, options: { ...host.options, ...change } }),
        JSON.stringify(change),
      ).rejects.toThrow(DataError);
    }
    await expect(createRegistration({ courseId: "geology", actor: LEARNER }, JSON.parse("null"))).rejects.toThrow(
      DataError,
    );
  });

  it("refuses an id from newId that is no UUID", async () => {
    const host = testHost({ newId: () => "not-a-uuid" });
    await expect(register(host)).rejects.toThrow("newId must make a UUID");
    const numeric = testHost({ newId: () => 7 as unknown as string });
    await expect(register(numeric)).rejects.toThrow("newId must make a UUID");
  });
});

describe("the inputs of the functions of the LMS", () => {
  it("refuses a registration of a learner that cmi5 cannot launch, or with an id that is no UUID", async () => {
    const host = testHost();
    const actors = [
      { mbox: "mailto:learner@example.org" },
      { objectType: "Group", member: [LEARNER] },
      { account: { name: "x" } },
    ];
    for (const actor of actors) {
      await expect(
        createRegistration({ courseId: "geology", actor: JSON.parse(JSON.stringify(actor)) }, host.options),
      ).rejects.toThrow(DataError);
    }
    await expect(
      createRegistration({ courseId: "geology", actor: LEARNER, registration: "r1" }, host.options),
    ).rejects.toThrow(DataError);
    await expect(createRegistration(JSON.parse("null"), host.options)).rejects.toThrow(DataError);
  });

  it("refuses a launch input that is not valid, or that names what the store does not hold", async () => {
    const host = testHost();
    const registration = (await register(host)).id;
    const invalid = [
      null,
      { registration: "r", au: AU1 },
      { registration, au: "" },
      { registration, au: AU1, launchMode: "Hidden" },
      { registration, au: AU1, masteryScore: 1.5 },
      { registration, au: AU1, returnUrl: "javascript:alert(1)" },
      { registration, au: AU1, moveOn: "Always" },
      { registration, au: AU1, contextTemplate: { registration: "nope" } },
      { registration, au: AU2, entitlementAlternate: "a" },
      { registration, au: "https://publisher.example.org/au/9" },
      { registration: "9f0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d", au: AU1 },
    ];
    for (const input of invalid) {
      await expect(
        prepareLaunch(JSON.parse(JSON.stringify(input)), host.options),
        JSON.stringify(input),
      ).rejects.toThrow(DataError);
    }
  });

  it("refuses a launch of a unit whose URL names a parameter of the launch", async () => {
    const host = testHost();
    const registration = (await register(host)).id;
    const course = host.store.courses.get("geology") ?? expect.unreachable();
    host.store.courses.set("geology", {
      ...course,
      aus: course.aus.map((au, index) => (index === 0 ? { ...au, url: `${au.url}&Endpoint=x` } : au)),
    });
    await expect(prepareLaunch({ registration, au: AU1 }, host.options)).rejects.toThrow("parameter Endpoint");
  });

  it("refuses a session that is no UUID or that the store does not hold, and waivers that are not valid", async () => {
    const host = testHost();
    await expect(abandonSession(JSON.parse("12"), host.options)).rejects.toThrow(DataError);
    await expect(abandonSession("9f0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d", host.options)).rejects.toThrow("no session");
    const registration = (await register(host)).id;
    for (const input of [
      null,
      { registration: "r", au: AU1, reason: "r" },
      { registration, au: AU1, reason: "" },
      { registration, au: "https://publisher.example.org/au/9", reason: "r" },
      { registration: "9f0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d", au: AU1, reason: "r" },
    ]) {
      await expect(waiveAu(JSON.parse(JSON.stringify(input)), host.options), JSON.stringify(input)).rejects.toThrow(
        DataError,
      );
    }
  });

  it("refuses a request, LRS options or progress arguments of the wrong type", async () => {
    const host = testHost();
    await expect(handleFetchRequest(JSON.parse("null"), host.options)).rejects.toThrow(DataError);
    expect(() => extendLrsOptions(JSON.parse("null"), host.options)).toThrow(DataError);
    expect(() => extendLrsOptions({ ...host.lrsOptions, access: JSON.parse("1") }, host.options)).toThrow(DataError);
    expect(() => extendLrsOptions({ ...host.lrsOptions, statements: JSON.parse("null") }, host.options)).toThrow(
      DataError,
    );
    expect(() => deriveCourseProgress(JSON.parse("null"), host.course)).toThrow(DataError);
    expect(() => deriveCourseProgress(JSON.parse("{}"), JSON.parse("[]"))).toThrow(DataError);
  });
});
