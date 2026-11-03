import type { HttpResponse } from "@interopkit/core/http";
import { CMI5_CATEGORIES, CMI5_EXTENSIONS, CMI5_VERBS, readLaunchUrl } from "@interopkit/course-launch";
import {
  createRegistration,
  handleFetchRequest,
  type Launch,
  type LaunchInput,
  prepareLaunch,
  type Registration,
} from "@interopkit/course-launch/lms";
import type { Statement } from "@interopkit/learning-records";
import { LEARNER, type TestHost } from "./lms-host.js";

/** A launch that a unit of the tests fetched its token for: what it reads of the launch URL, and its Basic credential. */
export interface Launched {
  readonly launch: Launch;
  readonly registration: string;
  readonly activityId: string;
  readonly actor: Statement["actor"];
  readonly token: string;
  readonly authorization: string;
  readonly launchData: {
    readonly contextTemplate: NonNullable<Statement["context"]>;
    readonly masteryScore?: number;
    readonly launchMode: string;
  };
}

/** Registers the learner of the tests in the course of the tests. */
export function register(host: TestHost, registration?: string): Promise<Registration> {
  return createRegistration(
    { courseId: "geology", actor: LEARNER, ...(registration === undefined ? {} : { registration }) },
    host.options,
  );
}

/** Posts to the fetch URL of a launch. */
export function postFetch(host: TestHost, fetchUrl: string, method = "POST"): Promise<HttpResponse> {
  return handleFetchRequest({ method, url: fetchUrl, headers: {}, body: new Uint8Array() }, host.options);
}

/** Reads the JSON of an answer. */
export function jsonOf(response: HttpResponse): unknown {
  return JSON.parse(typeof response.body === "string" ? response.body : new TextDecoder().decode(response.body));
}

/** Launches a unit, fetches its token and reads its launch data, as a unit does at its start. */
export async function launchUnit(
  host: TestHost,
  input: Pick<LaunchInput, "registration" | "au"> & Partial<LaunchInput>,
  { readPreferences = true }: { readonly readPreferences?: boolean } = {},
): Promise<Launched> {
  const launch = await prepareLaunch(input, host.options);
  const parameters = readLaunchUrl(launch.url);
  const answer = jsonOf(await postFetch(host, parameters.fetch)) as { "auth-token": string };
  const token = answer["auth-token"];
  const authorization = `Basic ${token}`;
  const query = new URLSearchParams({
    stateId: "LMS.LaunchData",
    activityId: parameters.activityId,
    agent: JSON.stringify(parameters.actor),
    registration: parameters.registration,
  });
  const launchData = jsonOf(
    await host.xapi("GET", `activities/state?${query}`, { authorization }),
  ) as Launched["launchData"];
  if (readPreferences) {
    const agent = new URLSearchParams({ profileId: "cmi5LearnerPreferences", agent: JSON.stringify(parameters.actor) });
    await host.xapi("GET", `agents/profile?${agent}`, { authorization });
  }
  return {
    launch,
    registration: parameters.registration,
    activityId: parameters.activityId,
    actor: parameters.actor,
    token,
    authorization,
    launchData,
  };
}

/** The number of statements that a unit of the tests made, for their ids and their times. */
let made = 0;

/** Makes a statement of a unit from its launch data: the template, the registration and the categories of its verb. */
export function unitStatement(
  launched: Launched,
  verb: keyof typeof CMI5_VERBS | "experienced",
  result?: Statement["result"],
): Statement {
  made += 1;
  const defined = verb !== "experienced";
  const judged = result?.success !== undefined || result?.completion !== undefined;
  const template = launched.launchData.contextTemplate;
  const masteryScore = launched.launchData.masteryScore;
  return {
    id: `0b5c6d7e-8f90-4a1b-8c2d-${String(made).padStart(12, "0")}`,
    actor: launched.actor,
    verb: { id: defined ? CMI5_VERBS[verb] : "http://adlnet.gov/expapi/verbs/experienced" },
    object: { objectType: "Activity", id: launched.activityId },
    ...(result === undefined ? {} : { result }),
    context: {
      ...template,
      registration: launched.registration,
      contextActivities: {
        ...template.contextActivities,
        ...(defined
          ? {
              category: [{ id: CMI5_CATEGORIES.cmi5 }, ...(judged ? [{ id: CMI5_CATEGORIES.moveOn }] : [])],
            }
          : {}),
      },
      extensions: {
        ...template.extensions,
        ...(result?.score !== undefined && masteryScore !== undefined
          ? { [CMI5_EXTENSIONS.masteryScore]: masteryScore }
          : {}),
      },
    },
    timestamp: new Date(Date.parse("2026-01-15T10:00:00.000Z") + made * 1000).toISOString(),
  };
}

/** Sends a statement of a unit with PUT, as the units of CATAPULT do. */
export function sendStatement(host: TestHost, launched: Launched, statement: Statement): Promise<HttpResponse> {
  return host.xapi("PUT", `statements?statementId=${statement.id}`, {
    authorization: launched.authorization,
    body: statement,
  });
}

/** Reads the statements of a registration in the order of arrival, with the credential of the LMS. */
export async function statementsOf(host: TestHost, registration: string): Promise<readonly Statement[]> {
  return host.lrs.held().filter((statement) => statement.context?.registration === registration);
}

/** The verbs of statements, by their last segment. */
export function verbsOf(statements: readonly Statement[]): readonly string[] {
  return statements.map(({ verb }) => verb.id.slice(verb.id.lastIndexOf("/") + 1));
}
