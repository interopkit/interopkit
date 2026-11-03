import { readCourseStructure } from "@interopkit/course-launch";
import type { Recorded } from "@interopkit/course-launch/au";
import { type CourseProgress, deriveCourseProgress } from "@interopkit/course-launch/lms";
import { readCoursePackage, writeCoursePackage } from "@interopkit/course-launch/package";
import type { Agent } from "@interopkit/learning-records";
import { openUnit, playLesson } from "./src/au.ts";
import { CONTENT, GEOLOGY, GLOSSARY, MINERALS, ROCKS } from "./src/course.ts";
import { createLms, type Lms } from "./src/lms.ts";

/** The address of the campus LMS. */
const ORIGIN = "https://lms.campus.example";

/** The time that the LMS and the units start at: each read of a clock is one second later. */
const START = Date.parse("2026-03-02T08:00:00.000Z");

/** The learners: cmi5 names a learner by an account (9.2). */
const ANA: Agent = { objectType: "Agent", account: { homePage: ORIGIN, name: "ana" } };
const BUDI: Agent = { objectType: "Agent", account: { homePage: ORIGIN, name: "budi" } };

/** What the scenario shows, in plain data. */
export interface ScenarioResult {
  /** The course package that the publisher wrote and the LMS read back: its source and its files. */
  readonly imported: { readonly source: "zip" | "xml"; readonly paths: readonly string[] };
  /** Whether the glossary, which needs nothing, was satisfied when Ana registered. */
  readonly satisfiedAtRegistration: boolean;
  /** Ana's lesson of rocks: what the session recorded, and where the page sends her next. */
  readonly rocks: { readonly recorded: readonly Recorded[]; readonly returnUrl: string | undefined };
  /** What the session of the unit skips by the rules of cmi5: a failed after a passed, and anything after terminated. */
  readonly skipped: { readonly failedAfterPassed: Recorded; readonly afterTerminated: Recorded };
  /** What a second start of the same launch URL gets: the fetch URL is of one use. */
  readonly secondStart: string;
  /** The verbs of Ana's registration in the order that the LRS stored them, as the administrator reads them. */
  readonly anaVerbs: readonly string[];
  /** Budi's minerals unit: completed after a reload of its page, which resumes the session without a second fetch. */
  readonly resumed: Recorded;
  /** Budi reviews the rocks unit: the session skips completed, passed and failed in Review. */
  readonly review: readonly Recorded[];
  /** Budi left the rocks unit open and launched it again: the old session is refused, and its abandoned statement timed. */
  readonly abandoned: { readonly oldSession: Recorded; readonly duration: string | undefined };
  /** What Ana's and Budi's registrations hold at the end, a waived unit satisfied. */
  readonly progress: { readonly ana: CourseProgress; readonly budi: CourseProgress };
}

/** The verbs of the Statements of a registration, in the order the LRS stored them, as the administrator reads them. */
async function verbsOf(lms: Lms, registration: string): Promise<readonly string[]> {
  const query = new URLSearchParams({ registration, ascending: "true" });
  const answer = await lms.handle({
    method: "GET",
    url: `${ORIGIN}/xapi/statements?${query}`,
    headers: { authorization: lms.adminAuthorization, "x-experience-api-version": "1.0.3" },
    body: new Uint8Array(),
  });
  const body = typeof answer.body === "string" ? answer.body : new TextDecoder().decode(answer.body);
  const { statements } = JSON.parse(body) as {
    readonly statements: readonly { readonly verb: { readonly id: string } }[];
  };
  return statements.map(({ verb }) => verb.id.slice(verb.id.lastIndexOf("/") + 1));
}

/** Opens a unit, which the scenario expects to start. */
async function open(lms: Lms, url: string, resume?: Parameters<typeof openUnit>[2]) {
  const session = await openUnit(url, lms.fetch, resume);
  if (typeof session === "string") throw new Error(`The unit did not start: ${session}.`);
  return session;
}

/** Writes the course as a package, imports it, registers Ana and Budi, and plays their units. */
export async function runScenario(): Promise<ScenarioResult> {
  let tick = 0;
  const lms = createLms({
    origin: ORIGIN,
    lmsPassword: "lms-secret",
    adminPassword: "admin-secret",
    clock: {
      now: () => {
        tick += 1;
        return START + tick * 1000;
      },
    },
  });
  const files = new Map([
    ["rocks/index.html", new TextEncoder().encode("<!doctype html><title>Rocks</title>")],
    ["glossary/index.html", new TextEncoder().encode("<!doctype html><title>Glossary</title>")],
    ["minerals/index.html", new TextEncoder().encode("<!doctype html><title>Minerals</title>")],
  ]);
  const archive = await writeCoursePackage(readCourseStructure(GEOLOGY, { packaged: true }), files);
  const read = await readCoursePackage(archive);
  lms.importCourse(read.structure, "geology", CONTENT);

  const ana = await lms.register("geology", ANA);
  const rocksUrl = (await lms.launch({ registration: ana.id, au: ROCKS, returnUrl: `${ORIGIN}/courses/geology` })).url;
  const rocks = await open(lms, rocksUrl);
  const lesson = await playLesson(rocks, 0.9);
  const skipped = { failedAfterPassed: await rocks.fail({ scaled: 0.5 }), afterTerminated: await rocks.initialize() };
  const second = await openUnit(rocksUrl, lms.fetch);

  const budi = await lms.register("geology", BUDI);
  const mineralsUrl = (await lms.launch({ registration: budi.id, au: MINERALS })).url;
  const minerals = await open(lms, mineralsUrl);
  await minerals.initialize();
  const reloaded = await open(lms, mineralsUrl, minerals.resume);
  const resumed = await reloaded.complete();
  await reloaded.terminate();

  const reviewUrl = (await lms.launch({ registration: budi.id, au: ROCKS, launchMode: "Review" })).url;
  const reviewing = await open(lms, reviewUrl);
  const review = (await playLesson(reviewing, 0.9)).recorded;

  const firstUrl = (await lms.launch({ registration: budi.id, au: ROCKS })).url;
  const first = await open(lms, firstUrl);
  await first.initialize();
  await lms.launch({ registration: budi.id, au: ROCKS });
  const oldSession = await first.complete();
  const abandoned = lms.statements.all().find(({ statement }) => statement.verb.id.endsWith("/abandoned"));
  await lms.waive(budi.id, ROCKS, "Equivalent AU");

  const records = { ana: await lms.store.registration(ana.id), budi: await lms.store.registration(budi.id) };
  const course = await lms.store.course("geology");
  if (records.ana === undefined || records.budi === undefined || course === undefined) {
    throw new Error("The store lost a record of the scenario.");
  }
  return {
    imported: { source: read.source, paths: read.paths },
    satisfiedAtRegistration: ana.aus[GLOSSARY]?.satisfied === true,
    rocks: lesson,
    skipped,
    secondStart: typeof second === "string" ? second : "started",
    anaVerbs: await verbsOf(lms, ana.id),
    resumed,
    review,
    abandoned: { oldSession, duration: abandoned?.statement.result?.duration },
    progress: { ana: deriveCourseProgress(records.ana, course), budi: deriveCourseProgress(records.budi, course) },
  };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
