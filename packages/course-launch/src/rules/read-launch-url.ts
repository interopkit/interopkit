import { DataError } from "@interopkit/core";
import { checkHttpsUrl, describe, hasMoreTokensThan, isAbsoluteUri, isUuid } from "@interopkit/core/checks";
import type { Agent } from "@interopkit/learning-records";
import type { LaunchParameters } from "../model/index.js";
import { checkXapiPart } from "./xapi-parts.js";

/** The most characters of a launch URL that an assignable unit reads. */
const MAX_LAUNCH_URL_LENGTH = 65_536;

/** The most tokens of JSON of the actor of a launch URL: an Agent with an account has about twenty. */
const MAX_ACTOR_TOKENS = 1_000;

/** Reads the one value of a parameter of a launch URL. */
function parameterOf(query: URLSearchParams, name: string): string {
  const values = query.getAll(name);
  if (values.length !== 1) {
    throw new DataError(
      values.length === 0
        ? `The launch URL has no parameter ${name}, which the LMS gives every launch (8.1).`
        : `The launch URL has the parameter ${name} ${values.length} times, and an assignable unit reads it once (8.1).`,
    );
  }
  const [value] = values;
  return value ?? "";
}

/** Reads the actor of a launch URL: the JSON of an Agent with an account, as cmi5 identifies the learner (8.1.3, 9.2). */
function actorOf(text: string): Agent {
  const label = "The actor of the launch URL";
  if (hasMoreTokensThan(text, MAX_ACTOR_TOKENS)) {
    throw new DataError(`${label} has more than ${MAX_ACTOR_TOKENS} tokens of JSON, more than an Agent needs.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DataError(`${label} is not JSON: an assignable unit reads it as the JSON of an Agent (8.1.3).`);
  }
  checkXapiPart("actor", parsed, label);
  // The rules of xAPI took it as an Actor, and JSON.parse made it, so it shares nothing with the input.
  const agent = parsed as Agent;
  if (agent.objectType !== undefined && agent.objectType !== "Agent") {
    throw new DataError(`${label} is a ${agent.objectType}, and cmi5 launches an Agent (9.2).`);
  }
  if (agent.account === undefined)
    throw new DataError(`${label} has no account, by which cmi5 identifies the learner (9.2).`);
  return agent;
}

/**
 * Reads the launch URL of an assignable unit: the endpoint of xAPI, the fetch URL, the actor, the registration and the id of
 * the activity, in any order, each once.
 *
 * @remarks
 * The endpoint and the fetch URL are https, as the client of an LRS and the fetch of a token require; the actor is an Agent with
 * an account, read by the rules of xAPI 1.0.3 within 1,000 tokens of JSON; the registration is a UUID; and the activity id is a
 * fully qualified IRI. The values are decoded as a query decodes them. The rest of the URL, the address of the content and its
 * own parameters, is the content's.
 *
 * @param url - The address that the assignable unit was opened with, at most 65,536 characters.
 * @returns The parameters, a copy that shares nothing with the input.
 * @throws `DataError` that names the parameter that is missing, repeated or not valid, or the fault of the URL.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#launch_method | cmi5, 8.1 Launch Method}
 */
export function readLaunchUrl(url: string): LaunchParameters {
  if (typeof url !== "string") throw new DataError(`The launch URL must be a string, found ${describe(url)}.`);
  if (url.length > MAX_LAUNCH_URL_LENGTH) {
    throw new DataError(`The launch URL has more than ${MAX_LAUNCH_URL_LENGTH} characters, more than a launch needs.`);
  }
  if (!URL.canParse(url)) throw new DataError("The launch URL is not an absolute URL.");
  const query = new URL(url).searchParams;
  const endpoint = parameterOf(query, "endpoint");
  const fetch = parameterOf(query, "fetch");
  const actor = actorOf(parameterOf(query, "actor"));
  const registration = parameterOf(query, "registration");
  const activityId = parameterOf(query, "activityId");
  checkHttpsUrl(endpoint, "The parameter endpoint of the launch URL");
  checkHttpsUrl(fetch, "The parameter fetch of the launch URL");
  if (!isUuid(registration)) {
    throw new DataError(
      `The parameter registration of the launch URL must be a UUID, found ${describe(registration)}.`,
    );
  }
  if (!isAbsoluteUri(activityId)) {
    throw new DataError(
      `The parameter activityId of the launch URL must be a fully qualified IRI, found ${describe(activityId)}.`,
    );
  }
  return { endpoint, fetch, actor, registration, activityId };
}
