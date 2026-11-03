import { callPort, DataError } from "@interopkit/core";
import { absoluteUriSchema, parseWith } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpResponse, readQuery } from "@interopkit/core/http";
import { iriKey } from "../compare/internal.js";
import { activitySchema } from "../read/internal.js";
import { checkNames } from "./parameters.js";
import { FAILED } from "./status.js";
import { attempt, type Context, isRefusal } from "./verdict.js";

/** Reads the parameter `activityId`. */
function readActivityId(context: Context): ReturnType<typeof attempt<string>> {
  return attempt(() => {
    const parameters = readQuery(context.request);
    checkNames(parameters, new Set(["activityId"]));
    return parseWith(absoluteUriSchema, parameters.get("activityId"), "The parameter activityId");
  });
}

/** Answers a GET or HEAD for the Activities resource (4.1.6.4): the Activity the LRS describes, or one with only its id. */
export async function handleActivities(context: Context): Promise<HttpResponse> {
  const id = readActivityId(context);
  if (isRefusal(id)) return context.refuse(id.status, id.message);
  const { activities, signal } = context.settings;
  const found = await callPort(() => activities.get(id.value, { signal }), signal);
  if (found === undefined) return context.refuse(500, FAILED);
  if (found.value === undefined) return buildJsonResponse(200, { objectType: "Activity", id: id.value });
  const activity = parseWith(activitySchema, found.value, "The answer of ActivityStore.get");
  if (iriKey(activity.id) !== iriKey(id.value)) {
    throw new DataError(
      `The answer of ActivityStore.get is the Activity ${activity.id}, and the request asked for ${id.value}.`,
    );
  }
  return buildJsonResponse(200, { ...activity, objectType: "Activity" });
}
