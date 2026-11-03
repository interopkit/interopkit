import type { HttpResponse } from "@interopkit/core/http";
import { readCourseStructure, readLaunchUrl } from "@interopkit/course-launch";
import { type CourseProgress, progressOf } from "@interopkit/course-launch/lms";
import type { Agent, Statement } from "@interopkit/learning-records";
import { CONTENT, GEOLOGY, MINERALS, ROCKS } from "./src/course.ts";
import { createLms, type Lms } from "./src/lms.ts";

/** The address of the campus LMS. */
const ORIGIN = "https://lms.campus.example";

/** The time that the LMS starts at: each read of its clock is one second later. */
const START = Date.parse("2026-03-02T08:00:00.000Z");

/** The learners: cmi5 names a learner by an account (9.2). */
const ANA: Agent = { objectType: "Agent", account: { homePage: ORIGIN, name: "ana" } };
const BUDI: Agent = { objectType: "Agent", account: { homePage: ORIGIN, name: "budi" } };

/** The verbs that a unit sends. */
const VERB = {
  initialized: "http://adlnet.gov/expapi/verbs/initialized",
  completed: "http://adlnet.gov/expapi/verbs/completed",
  passed: "http://adlnet.gov/expapi/verbs/passed",
  failed: "http://adlnet.gov/expapi/verbs/failed",
  terminated: "http://adlnet.gov/expapi/verbs/terminated",
} as const;

/** What the scenario shows, in plain data. */
export interface ScenarioResult {
  /** Whether the glossary, which needs nothing, was satisfied when Ana registered. */
  readonly satisfiedAtRegistration: boolean;
  /** The statuses of the statements of Ana's session of the rocks unit, in order. */
  readonly session: readonly number[];
  /** What the LMS refuses: a failed after a passed, a second POST to the fetch URL, and a statement after terminated. */
  readonly refused: {
    readonly failedAfterPassed: number;
    readonly secondFetch: string;
    readonly afterTerminated: number;
  };
  /** The verbs of Ana's registration in the order that the LRS stored them, as the administrator reads them. */
  readonly anaVerbs: readonly string[];
  /** Budi left the minerals unit open and launched it again: the duration of the abandoned statement. */
  readonly abandonedDuration: string | undefined;
  /** What Ana's and Budi's registrations hold after Budi's minerals unit is waived. */
  readonly progress: { readonly ana: CourseProgress; readonly budi: CourseProgress };
}

/** Sends a request to the LMS in the same process. */
function call(
  lms: Lms,
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Promise<HttpResponse> {
  return lms.handle({
    method,
    url,
    headers: { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body)),
  });
}

/** Reads the JSON of an answer. */
function jsonOf<T>(response: HttpResponse): T {
  return JSON.parse(typeof response.body === "string" ? response.body : new TextDecoder().decode(response.body)) as T;
}

/** A unit of the scenario: it reads its launch URL, fetches its token and reads its launch data, as cmi5 asks at its start. */
class Unit {
  private readonly lms: Lms;
  private readonly launch: ReturnType<typeof readLaunchUrl>;
  private authorization = "";
  private template: NonNullable<Statement["context"]> = {};
  private masteryScore: number | undefined;
  private sent = 0;

  constructor(lms: Lms, url: string) {
    this.lms = lms;
    this.launch = readLaunchUrl(url);
  }

  /** Requests the LRS with the token of the session. */
  private request(method: string, path: string, body?: unknown): Promise<HttpResponse> {
    const headers = { authorization: this.authorization, "x-experience-api-version": "1.0.3" };
    return call(this.lms, method, `${this.launch.endpoint}/${path}`, headers, body);
  }

  /** Posts to the fetch URL and returns its answer. */
  async fetchToken(): Promise<Record<string, string>> {
    return jsonOf(await call(this.lms, "POST", this.launch.fetch));
  }

  /** Fetches the token, then reads the launch data and the preferences of the learner. */
  async start(): Promise<void> {
    this.authorization = `Basic ${(await this.fetchToken())["auth-token"]}`;
    const { actor, activityId, registration } = this.launch;
    const state = new URLSearchParams({
      stateId: "LMS.LaunchData",
      activityId,
      agent: JSON.stringify(actor),
      registration,
    });
    const launchData = jsonOf<{
      readonly contextTemplate: NonNullable<Statement["context"]>;
      readonly masteryScore?: number;
    }>(await this.request("GET", `activities/state?${state}`));
    this.template = launchData.contextTemplate;
    this.masteryScore = launchData.masteryScore;
    const preferences = new URLSearchParams({ profileId: "cmi5LearnerPreferences", agent: JSON.stringify(actor) });
    await this.request("GET", `agents/profile?${preferences}`);
  }

  /** Sends a statement that cmi5 defines, with the template of the session, and returns the status. */
  async send(verb: keyof typeof VERB, result?: Statement["result"]): Promise<number> {
    this.sent += 1;
    const judged = result?.success !== undefined || result?.completion !== undefined;
    const statement = {
      id: crypto.randomUUID(),
      actor: this.launch.actor,
      verb: { id: VERB[verb] },
      object: { objectType: "Activity", id: this.launch.activityId },
      ...(result === undefined ? {} : { result }),
      context: {
        ...this.template,
        registration: this.launch.registration,
        contextActivities: {
          ...this.template.contextActivities,
          category: [
            { id: "https://w3id.org/xapi/cmi5/context/categories/cmi5" },
            ...(judged ? [{ id: "https://w3id.org/xapi/cmi5/context/categories/moveon" }] : []),
          ],
        },
        extensions: {
          ...this.template.extensions,
          ...(result?.score === undefined || this.masteryScore === undefined
            ? {}
            : { "https://w3id.org/xapi/cmi5/context/extensions/masteryscore": this.masteryScore }),
        },
      },
      timestamp: new Date(START + this.sent * 60_000).toISOString(),
    };
    return (await this.request("PUT", `statements?statementId=${statement.id}`, statement)).status;
  }
}

/** The verbs of the Statements of a registration, in the order the LRS stored them, as the administrator reads them. */
async function verbsOf(lms: Lms, registration: string): Promise<readonly string[]> {
  const query = new URLSearchParams({ registration, ascending: "true" });
  const answer = await call(lms, "GET", `${ORIGIN}/xapi/statements?${query}`, {
    authorization: lms.adminAuthorization,
    "x-experience-api-version": "1.0.3",
  });
  const { statements } = jsonOf<{ readonly statements: readonly Statement[] }>(answer);
  return statements.map(({ verb }) => verb.id.slice(verb.id.lastIndexOf("/") + 1));
}

/** Imports the course, registers Ana and Budi, and plays their sessions. */
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
  lms.importCourse(readCourseStructure(GEOLOGY, { packaged: true }), "geology", CONTENT);
  const ana = await lms.register("geology", ANA);

  const rocks = new Unit(lms, (await lms.launch({ registration: ana.id, au: ROCKS })).url);
  await rocks.start();
  const session = [
    await rocks.send("initialized"),
    await rocks.send("completed", { completion: true, duration: "PT10M" }),
    await rocks.send("passed", { success: true, duration: "PT12M", score: { scaled: 0.9 } }),
  ];
  const failedAfterPassed = await rocks.send("failed", { success: false, duration: "PT13M", score: { scaled: 0.5 } });
  const secondFetch = (await rocks.fetchToken())["error-code"] ?? "";
  session.push(await rocks.send("terminated", { duration: "PT15M" }));
  const afterTerminated = await rocks.send("initialized");

  const budi = await lms.register("geology", BUDI);
  const first = new Unit(lms, (await lms.launch({ registration: budi.id, au: MINERALS })).url);
  await first.start();
  await first.send("initialized");
  const again = new Unit(lms, (await lms.launch({ registration: budi.id, au: MINERALS })).url);
  await again.start();
  const abandoned = lms.statements.all().find(({ statement }) => statement.verb.id.endsWith("/abandoned"));
  await lms.waive(budi.id, MINERALS, "Equivalent AU");

  const records = { ana: await lms.store.registration(ana.id), budi: await lms.store.registration(budi.id) };
  const course = await lms.store.course("geology");
  if (records.ana === undefined || records.budi === undefined || course === undefined) {
    throw new Error("The store lost a record of the scenario.");
  }
  return {
    satisfiedAtRegistration: ana.aus["https://publisher.example/geology/glossary"]?.satisfied === true,
    session,
    refused: { failedAfterPassed, secondFetch, afterTerminated },
    anaVerbs: await verbsOf(lms, ana.id),
    abandonedDuration: abandoned?.statement.result?.duration,
    progress: { ana: progressOf(records.ana, course), budi: progressOf(records.budi, course) },
  };
}

if (import.meta.main) console.log(JSON.stringify(await runScenario(), null, 2));
