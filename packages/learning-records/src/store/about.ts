import { type HttpResponse, jsonResponse, readQuery } from "@interopkit/core/http";
import { checkNames } from "./parameters.js";
import { attempt, type Context, isRefusal } from "./verdict.js";
import { VERSIONS } from "./version.js";

/** Answers a GET or HEAD for the About resource (4.1.6.7): the versions of xAPI the LRS speaks. */
export function handleAbout(context: Context): Promise<HttpResponse> {
  const checked = attempt(() => checkNames(readQuery(context.request), new Set()));
  if (isRefusal(checked)) return Promise.resolve(context.refuse(checked.status, checked.message));
  const { aboutExtensions } = context.settings;
  return Promise.resolve(
    jsonResponse(200, { version: VERSIONS, ...(aboutExtensions === undefined ? {} : { extensions: aboutExtensions }) }),
  );
}
