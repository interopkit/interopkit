import { type HttpResponse, jsonResponse, readQuery } from "@interopkit/core/http";
import { checkNames } from "./parameters.js";
import { attempt, type Context, isRefusal } from "./verdict.js";

/** Answers a GET or HEAD for the About resource (4.1.6.7; 1.0.3 Communication 2.8): the versions of xAPI the LRS serves. */
export function handleAbout(context: Context): Promise<HttpResponse> {
  const checked = attempt(() => checkNames(readQuery(context.request), new Set()));
  if (isRefusal(checked)) return Promise.resolve(context.refuse(checked.status, checked.message));
  const { aboutExtensions, versions } = context.settings;
  return Promise.resolve(
    jsonResponse(200, { version: versions, ...(aboutExtensions === undefined ? {} : { extensions: aboutExtensions }) }),
  );
}
