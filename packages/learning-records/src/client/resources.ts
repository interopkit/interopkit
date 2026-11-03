import { DataError } from "@interopkit/core";
import { absoluteUriSchema, parseWith } from "@interopkit/core/checks";
import { iriKey } from "../compare/internal.js";
import type { About, Activity, Agent, Person } from "../model/index.js";
import { aboutSchema, activitySchema, identifiedAgentSchema, personSchema } from "../read/internal.js";
import type { Settings } from "./config.js";
import { callOptionsSchema, readCallOptions } from "./options.js";
import { jsonOf, readAnswer, send, urlOf } from "./request.js";

/** Fetches one resource that answers with JSON and reads the answer. */
async function fetchJson<TValue>(
  settings: Settings,
  path: string,
  parameters: URLSearchParams | undefined,
  options: unknown,
  read: (json: unknown) => TValue,
): Promise<TValue> {
  const { signal } = readCallOptions(callOptionsSchema, options);
  const url = urlOf(settings, path, parameters);
  const response = await send(settings, signal, url, { method: "GET", headers: { accept: "application/json" } }, [200]);
  return readAnswer(url, () => read(jsonOf(response, settings)));
}

/** Fetches the Activity with an id, as the LRS describes it. */
export async function getActivity(settings: Settings, activityId: string, options: unknown): Promise<Activity> {
  const id = parseWith(absoluteUriSchema, activityId, "The activity id");
  return await fetchJson(settings, "activities", new URLSearchParams({ activityId: id }), options, (json) => {
    const activity = parseWith(activitySchema, json, "The Activity");
    // The scheme and the host of an IRI have no case, as when Statements are compared.
    if (iriKey(activity.id) !== iriKey(id)) {
      throw new DataError(`The Activity has the id ${activity.id}, and the request asked for ${id}.`);
    }
    return activity;
  });
}

/** Fetches what the LRS knows of an Agent from outside services. */
export async function getPerson(settings: Settings, agent: Agent, options: unknown): Promise<Person> {
  const checked = parseWith(identifiedAgentSchema, agent, "The Agent");
  return await fetchJson(settings, "agents", new URLSearchParams({ agent: JSON.stringify(checked) }), options, (json) =>
    parseWith(personSchema, json, "The Person"),
  );
}

/** Fetches what the LRS says of itself. */
export function about(settings: Settings, options: unknown): Promise<About> {
  return fetchJson(settings, "about", undefined, options, (json) => parseWith(aboutSchema, json, "The answer"));
}
