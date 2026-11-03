import { DataError, InteropkitError, readClock } from "@interopkit/core";
import { isUuid, nonEmptyStringSchema, parseWith, strictRecord } from "@interopkit/core/checks";
import type { Context } from "@interopkit/learning-records";
import * as v from "valibot";
import {
  CMI5_EXTENSIONS,
  LAUNCH_DATA_STATE_ID,
  LAUNCH_MODES,
  type LaunchData,
  type LaunchMode,
  MOVE_ON_VALUES,
  type MoveOn,
} from "../model/index.js";
import { checkXapiPart } from "../rules/internal.js";
import { abandon } from "./abandon-session.js";
import { courseOf, registrationOf } from "./create-registration.js";
import { launchedStatement } from "./lms-statements.js";
import { type LmsOptions, type LmsSettings, newIdOf, readLmsOptions, signalOf, withRetries } from "./options.js";
import { auOf } from "./progress.js";
import type { ImportedAu, Registration, Session } from "./records.js";
import { writeOnce } from "./satisfy.js";
import { hashOf, newSecret } from "./secrets.js";

/** What a host gives to launch an assignable unit. */
export interface LaunchInput {
  /** The registration of the learner. */
  readonly registration: string;
  /** The publisher id of the assignable unit. */
  readonly au: string;
  /**
   * The launch mode.
   *
   * @defaultValue `"Normal"`
   */
  readonly launchMode?: LaunchMode;
  /**
   * The https or http address that the unit sends the learner to when it terminates, `returnURL` in the launch data.
   *
   * @defaultValue none
   */
  readonly returnUrl?: string;
  /**
   * The mastery score of this launch, from 0 to 1.
   *
   * @defaultValue the course structure's
   */
  readonly masteryScore?: number;
  /**
   * What satisfies the unit from this launch on.
   *
   * @defaultValue the course structure's
   */
  readonly moveOn?: MoveOn;
  /**
   * The static parameters of this launch.
   *
   * @defaultValue the course structure's
   */
  readonly launchParameters?: string;
  /**
   * The `alternate` of the entitlement key, from a source that the LMS and the unit agree on; the unit must have an
   * `entitlementKey` in the course structure.
   *
   * @defaultValue none
   */
  readonly entitlementAlternate?: string;
  /**
   * What the host adds to the context template: activities and extensions that every statement of the session keeps. The LMS
   * adds the publisher id to `grouping` and the session id to the extensions.
   *
   * @defaultValue none
   */
  readonly contextTemplate?: Context;
}

/** A launch that the host opens: the URL, the window it asks for, and the session id. */
export interface Launch {
  /** The URL of the unit with the five parameters of the launch, which holds a fetch code to keep from logs. */
  readonly url: string;
  /** `"own"` for a unit whose `launchMethod` is `OwnWindow`, which needs a window of its own, and `"any"` for `AnyWindow`. */
  readonly window: "own" | "any";
  /** The session id, for `abandonSession`. */
  readonly session: string;
}

/** The names of the parameters of a launch URL, which the URL of a unit may not hold (8.1). */
const LAUNCH_PARAMETERS = ["endpoint", "fetch", "actor", "registration", "activityid"];

const inputSchema = strictRecord({
  registration: v.pipe(
    v.string(),
    v.check(isUuid, (issue) => `expected a UUID, found ${issue.received}`),
  ),
  au: nonEmptyStringSchema,
  launchMode: v.optional(v.picklist(LAUNCH_MODES)),
  returnUrl: v.optional(
    v.pipe(
      v.string(),
      v.check(
        (text) => URL.canParse(text) && /^https?:$/u.test(new URL(text).protocol),
        (issue) => `expected an https or http address, found ${issue.received}`,
      ),
    ),
  ),
  masteryScore: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1))),
  moveOn: v.optional(v.picklist(MOVE_ON_VALUES)),
  launchParameters: v.optional(v.string()),
  entitlementAlternate: v.optional(v.string()),
  contextTemplate: v.optional(v.unknown()),
});

type ReadInput = v.InferOutput<typeof inputSchema>;

/**
 * Checks again that the URL of a unit names none of the parameters of a launch in its query, in any case and decoded: the
 * reader refused such a URL at import, and a course from an older import is read from the store (8.1).
 */
function checkUnitUrl(au: ImportedAu): void {
  for (const name of new URL(au.url).searchParams.keys()) {
    if (LAUNCH_PARAMETERS.includes(name.toLowerCase())) {
      throw new DataError(
        `The URL of the assignable unit ${au.publisherId} names the parameter ${name} of a launch (8.1).`,
      );
    }
  }
}

/** Builds the context template of a session: the host's, with the publisher id in `grouping` and the session id. */
function templateOf(host: Context | undefined, au: ImportedAu, session: string): Context {
  const grouping = (host?.contextActivities?.grouping ?? []).filter(({ id }) => id !== au.publisherId);
  return {
    ...host,
    contextActivities: { ...host?.contextActivities, grouping: [{ id: au.publisherId }, ...grouping] },
    extensions: { ...host?.extensions, [CMI5_EXTENSIONS.sessionId]: session },
  };
}

/** Builds the launch data of a session from the course structure and what the input sets for this launch. */
function launchDataOf(read: ReadInput, au: ImportedAu, contextTemplate: Context): LaunchData {
  if (read.entitlementAlternate !== undefined && au.entitlementKey === undefined) {
    throw new DataError(
      `The assignable unit ${au.publisherId} has no entitlementKey in the course structure, so a launch has no alternate.`,
    );
  }
  const launchParameters = read.launchParameters ?? au.launchParameters;
  const masteryScore = read.masteryScore ?? au.masteryScore;
  return {
    contextTemplate,
    launchMode: read.launchMode ?? "Normal",
    moveOn: read.moveOn ?? au.moveOn,
    ...(launchParameters === undefined ? {} : { launchParameters }),
    ...(masteryScore === undefined ? {} : { masteryScore }),
    ...(read.returnUrl === undefined ? {} : { returnUrl: read.returnUrl }),
    ...(au.entitlementKey === undefined
      ? {}
      : {
          entitlementKey: {
            courseStructure: au.entitlementKey,
            ...(read.entitlementAlternate === undefined ? {} : { alternate: read.entitlementAlternate }),
          },
        }),
  };
}

/** Writes the launch data as the document `LMS.LaunchData` names them, `returnUrl` as `returnURL` (10.0). */
function documentOf(launchData: LaunchData): Uint8Array {
  const { returnUrl, ...rest } = launchData;
  return new TextEncoder().encode(
    JSON.stringify({ ...rest, ...(returnUrl === undefined ? {} : { returnURL: returnUrl }) }),
  );
}

/**
 * Builds the launch URL: the URL of the unit with its own query as it is, then the five parameters (8.1). The endpoint goes
 * without its final slash: the units built on Rustici's library and those of CATAPULT append `/statements` to it, and the
 * others add the slash that is missing.
 */
function launchUrlOf(settings: LmsSettings, au: ImportedAu, registration: Registration, code: string): string {
  const fetch = new URL(settings.fetchEndpoint);
  fetch.searchParams.set("code", code);
  const parameters = new URLSearchParams({
    endpoint: settings.endpoint.slice(0, -1),
    fetch: fetch.href,
    actor: JSON.stringify(registration.actor),
    registration: registration.id,
    activityId: au.lmsId,
  });
  const hash = au.url.indexOf("#");
  const before = hash < 0 ? au.url : au.url.slice(0, hash);
  const fragment = hash < 0 ? "" : au.url.slice(hash);
  const joint = !before.includes("?") ? "?" : before.endsWith("?") || before.endsWith("&") ? "" : "&";
  return `${before}${joint}${parameters}${fragment}`;
}

/**
 * Marks a session launched. Nothing else writes a session that is preparing: it has no token, and its fetch code was never
 * given, so its first revision is the one stored.
 */
async function markLaunched(settings: LmsSettings, session: Session): Promise<void> {
  await withRetries(settings, "launched a session", async () => {
    const put = await settings.store.putSession(
      { ...session, state: "launched", revision: session.revision + 1 },
      session.revision,
      signalOf(settings),
    );
    return put === "written" ? "done" : "conflict";
  });
}

/** Points the unit of a registration at its new session, with the `moveOn` of the launch. */
async function pointAt(settings: LmsSettings, session: Session): Promise<void> {
  await withRetries(settings, "launched a session", async () => {
    const registration = await registrationOf(settings, session.registration);
    const au = { ...auOf(registration, session.au), session: session.id, moveOn: session.launchData.moveOn };
    const put = await settings.store.putRegistration(
      { ...registration, aus: { ...registration.aus, [session.au]: au }, revision: registration.revision + 1 },
      registration.revision,
      signalOf(settings),
    );
    return put === "written" ? "done" : "conflict";
  });
}

/**
 * Prepares the launch of an assignable unit: abandons the session that the unit has open in the registration, makes a new
 * session, writes `LMS.LaunchData` and the launched statement, and returns the launch URL with a fetch code of one use.
 *
 * @remarks
 * The launch data hold the context template, with the publisher id in `grouping` and the session id, the launch mode, `moveOn`,
 * and the launch parameters, the mastery score, the return URL and the entitlement key when there are any; the input overrides
 * the course structure for this launch. The launched statement carries the launch mode, the URL of the unit without the
 * parameters of the launch, `moveOn`, and the launch parameters and mastery score when given. The session becomes launched only
 * once both are written: a failure leaves it preparing, so its fetch code is never answered, and returns no URL. The launch URL
 * keeps the unit's own query, and its endpoint has no final slash. The fetch code expires after `fetchLifetimeSeconds`.
 *
 * @param input - The registration, the unit, and what this launch sets.
 * @param options - The options of the LMS.
 * @returns The launch URL, the window it needs and the session id.
 * @throws `DataError` for an input that is not valid, or a registration, course or unit that the store does not hold.
 * @throws What the store or the client of the LRS rejects with, and `InteropkitError` when the store keeps a conflict or the
 * LRS does not write the launch data.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#content_launch | cmi5, 8.0 Content Launch Mechanisms}
 */
export async function prepareLaunch(input: LaunchInput, options: LmsOptions): Promise<Launch> {
  const settings = readLmsOptions(options);
  const read = parseWith(inputSchema, input, "The input of the launch");
  if (read.contextTemplate !== undefined) {
    checkXapiPart("context", read.contextTemplate, "The input of the launch at contextTemplate");
  }
  const { store } = settings;
  const registration = await registrationOf(settings, read.registration.toLowerCase());
  const course = await courseOf(settings, registration.course);
  const au = course.aus.find(({ publisherId }) => publisherId === read.au);
  if (au === undefined)
    throw new DataError(`The course ${course.id} has no assignable unit ${JSON.stringify(read.au)}.`);
  checkUnitUrl(au);
  const active = auOf(registration, au.publisherId).session;
  if (active !== undefined) await abandon(settings, active);

  const id = newIdOf(settings);
  const secret = newSecret();
  // The rules of xAPI took it as a Context, and the parse made it a copy.
  const template = templateOf(read.contextTemplate as Context | undefined, au, id);
  const launchData = launchDataOf(read, au, template);
  const session: Session = {
    id,
    registration: registration.id,
    au: au.publisherId,
    activityId: au.lmsId,
    actor: registration.actor,
    revision: 1,
    state: "preparing",
    launchData,
    fetchCode: await hashOf(secret),
    launchedAt: readClock(settings.clock),
    reserved: [],
    preferencesRead: false,
  };
  if ((await store.putSession(session, "absent", signalOf(settings))) !== "written") {
    throw new DataError(`The option newId made the session id ${id}, which the store holds already.`);
  }
  const written = await settings.records.putDocument(
    {
      resource: "state",
      activityId: au.lmsId,
      agent: registration.actor,
      registration: registration.id,
      stateId: LAUNCH_DATA_STATE_ID,
    },
    { contentType: "application/json", body: documentOf(launchData) },
    signalOf(settings),
  );
  if (written !== "written")
    throw new InteropkitError(`The LRS did not write the launch data of the session ${id}: ${written}.`);
  await writeOnce(settings, launchedStatement(course, au, session, launchData, au.url));
  await markLaunched(settings, session);
  await pointAt(settings, session);
  return {
    url: launchUrlOf(settings, au, registration, `${id}.${secret}`),
    window: au.launchMethod === "OwnWindow" ? "own" : "any",
    session: id,
  };
}
