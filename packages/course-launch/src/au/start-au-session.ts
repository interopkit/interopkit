import { DataError, requestService, ServiceError } from "@interopkit/core";
import { hasMoreTokensThan, isRecord } from "@interopkit/core/checks";
import type { DocumentTarget, LrsDocument } from "@interopkit/learning-records";
import { createLrsClient, type LrsClient } from "@interopkit/learning-records/client";
import {
  CMI5_EXTENSIONS,
  CMI5_VERBS,
  LAUNCH_DATA_STATE_ID,
  type LaunchParameters,
  LEARNER_PREFERENCES_PROFILE_ID,
  type LearnerPreferences,
} from "../model/index.js";
import { readLaunchData, readLaunchUrl, readLearnerPreferences } from "../rules/index.js";
import { type AuSession, createAuSession, type PriorOutcome } from "./au-session.js";
import { type AuOptions, type AuSettings, readAuOptions, signalOf } from "./options.js";

/** The most bytes of the answer of the fetch URL: a token needs far fewer. */
const MAX_FETCH_BYTES = 65_536;

/** The most tokens of JSON of the answer of the fetch URL: an object of two strings has eight. */
const MAX_FETCH_TOKENS = 1000;

/** The most bytes of an answer of the LRS that the runtime reads, the launch data among them. */
const MAX_LAUNCH_DATA_BYTES = 1_048_576;

/** The most bytes of the preferences document that the runtime reads: two short properties need far fewer (11.0). */
const MAX_PREFERENCES_BYTES = 4096;

/** Why a session does not start: what the fetch URL answered, or what the launch lacks. */
export type AuRefusal = "used-or-expired" | "security" | "application" | "no-launch-data" | "untrusted-origin";

/** The refusal of each error code of the fetch URL (8.2.3.2). */
const REFUSALS: Readonly<Record<string, AuRefusal>> = { "1": "used-or-expired", "2": "security", "3": "application" };

const decoder = new TextDecoder();

/** Posts to the fetch URL once and reads its token, or the refusal of its error code (8.2). */
async function fetchToken(
  settings: AuSettings,
  url: string,
): Promise<{ readonly token: string } | { readonly refusal: AuRefusal; readonly message?: string }> {
  const service = { fetch: settings.fetch, timeoutMs: settings.timeoutMs, ...signalOf(settings, undefined) };
  const answer = await requestService(
    service,
    "The fetch URL",
    url,
    { method: "POST", headers: {} },
    { maxBytes: MAX_FETCH_BYTES },
  );
  const text = decoder.decode(answer.body);
  let body: unknown;
  try {
    body = hasMoreTokensThan(text, MAX_FETCH_TOKENS) ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  const token = isRecord(body) ? body["auth-token"] : undefined;
  if (typeof token === "string" && token !== "") return { token };
  const code = isRecord(body) ? body["error-code"] : undefined;
  const refusal = typeof code === "string" && Object.hasOwn(REFUSALS, code) ? REFUSALS[code] : undefined;
  if (refusal === undefined || !isRecord(body)) {
    throw new ServiceError(
      "The fetch URL answered with neither an auth-token nor an error code of cmi5.",
      answer.status,
      text,
      {
        headers: answer.headers,
      },
    );
  }
  const errorText = body["error-text"];
  return { refusal, ...(typeof errorText === "string" ? { message: errorText } : {}) };
}

/** Reads a document of JSON within a size, or `undefined` when there is none. */
function documentJson(document: LrsDocument | undefined, maxBytes: number, what: string): unknown {
  if (document === undefined) return undefined;
  const text = decoder.decode(document.body);
  if (document.body.byteLength > maxBytes) {
    throw new ServiceError(`${what} has more than ${maxBytes} bytes.`, 200, text.slice(0, 200));
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DataError(`${what} is not JSON.`, { cause: error });
  }
}

/** Reads what the registration held for the unit before the session: its completed, passed and waived statements. */
async function priorOf(client: LrsClient, launch: LaunchParameters, settings: AuSettings): Promise<PriorOutcome> {
  const first = async (verb: string) => {
    const pages = client.queryStatements(
      { registration: launch.registration, activity: launch.activityId, verb, limit: 1 },
      signalOf(settings, undefined),
    );
    // The first page holds the one statement asked for, or none.
    const { value } = await pages[Symbol.asyncIterator]().next();
    return value?.statements[0];
  };
  const [completed, passed, waived] = [
    await first(CMI5_VERBS.completed),
    await first(CMI5_VERBS.passed),
    await first(CMI5_VERBS.waived),
  ];
  const reason = waived?.result?.extensions?.[CMI5_EXTENSIONS.reason];
  return {
    completed: completed !== undefined,
    passed: passed !== undefined,
    ...(waived === undefined ? {} : { waived: { reason: typeof reason === "string" ? reason : "" } }),
  };
}

/** Adds the final slash that a base endpoint of xAPI needs, which some LMSs leave out (8.1.1). */
function rootOf(endpoint: string): string {
  return endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
}

/**
 * Starts the session of an assignable unit from its launch URL: posts to the fetch URL once for the token, reads the launch
 * data, the preferences of the learner and what the registration holds, and returns the session that sends the statements.
 *
 * @remarks
 * The launch URL is read by `readLaunchUrl`: its endpoint and fetch URL are https, and on an origin of `trustedOrigins` when
 * the options list them. The fetch URL is posted to through `requestService` of `@interopkit/core`, with no redirect and within
 * `timeoutMs`; its error codes are refusals, so content goes on to tell the learner. With `resume`, the session goes on
 * without a second POST, with the token and what it sent before the reload. The endpoint gets the final slash that it lacks.
 * The launch data are read by `readLaunchData`, the preferences by `readLearnerPreferences`, at most 1 MiB and 4,096 bytes,
 * and the registration's completed, passed and waived statements by three queries of one statement each.
 *
 * @param launchUrl - The address that the unit was opened with.
 * @param options - The `fetch`, and the clock, resume, trusted origins, deadline and signal.
 * @returns The session, or a refusal with the `error-text` of the fetch URL when it gave one.
 * @throws `DataError` for a launch URL, options or a resume that are not valid, or launch data or preferences that cmi5 does
 * not take.
 * @throws `ServiceError` when the fetch URL or the LRS fails, answers with what cmi5 does not define, or with more than its limit.
 * @throws The reason of the `signal` when it aborts.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#content_launch | cmi5, 8.0 Content Launch Mechanisms}
 */
export async function startAuSession(
  launchUrl: string,
  options: AuOptions,
): Promise<
  | {
      /** The session that started. */
      readonly session: AuSession;
    }
  | {
      /** Why the session did not start. */
      readonly refusal: AuRefusal;
      /**
       * The `error-text` that the fetch URL gave.
       *
       * @defaultValue none
       */
      readonly message?: string;
    }
> {
  const settings = readAuOptions(options);
  const launch = readLaunchUrl(launchUrl);
  const { trustedOrigins, resume } = settings;
  if (
    trustedOrigins !== undefined &&
    [launch.endpoint, launch.fetch].some((url) => !trustedOrigins.includes(new URL(url).origin))
  ) {
    return { refusal: "untrusted-origin" };
  }
  if (
    resume !== undefined &&
    (resume.registration !== launch.registration || resume.activityId !== launch.activityId)
  ) {
    throw new DataError("The option resume is that of another launch: its registration or activity id differs.");
  }
  let token = resume?.token;
  if (token === undefined) {
    const fetched = await fetchToken(settings, launch.fetch);
    if ("refusal" in fetched) return fetched;
    token = fetched.token;
  }
  const authorization = `Basic ${token}`;
  const client = createLrsClient({
    endpoint: rootOf(launch.endpoint),
    fetch: settings.fetch,
    version: "1.0.3",
    authorization: async () => authorization,
    timeoutMs: settings.timeoutMs,
    maxBytes: MAX_LAUNCH_DATA_BYTES,
    ...signalOf(settings, undefined),
  });
  const state: DocumentTarget = {
    resource: "state",
    activityId: launch.activityId,
    agent: launch.actor,
    registration: launch.registration,
    stateId: LAUNCH_DATA_STATE_ID,
  };
  const launchDataJson = documentJson(
    await client.getDocument(state, signalOf(settings, undefined)),
    MAX_LAUNCH_DATA_BYTES,
    "The launch data",
  );
  if (launchDataJson === undefined) return { refusal: "no-launch-data" };
  const launchData = readLaunchData(launchDataJson);
  const preferencesJson = documentJson(
    await client.getDocument(
      { resource: "agent-profile", agent: launch.actor, profileId: LEARNER_PREFERENCES_PROFILE_ID },
      signalOf(settings, undefined),
    ),
    MAX_PREFERENCES_BYTES,
    "The preferences of the learner",
  );
  const preferences: LearnerPreferences = preferencesJson === undefined ? {} : readLearnerPreferences(preferencesJson);
  const prior = await priorOf(client, launch, settings);
  return { session: createAuSession({ settings, launch, launchData, preferences, prior, client, token }) };
}
