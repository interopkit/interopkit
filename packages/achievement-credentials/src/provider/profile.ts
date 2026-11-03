import { callPort, DataError } from "@interopkit/core";
import { isRecord, parseWith } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpRequest, type HttpResponse, readJson } from "@interopkit/core/http";
import type { Profile } from "../model/index.js";
import { readEntity } from "../read/index.js";
import { bodyTypeOf } from "./body.js";
import type { ProviderSettings } from "./options.js";
import { failure, internalError, invalidData, unreadable } from "./status.js";
import { foundProfileSchema, profileSchema } from "./store.js";

/** The media type of a profile in a request (OB 6.2.5.1). */
const PROFILE_TYPE = "application/json";

/** Answers getProfile (OB 6.2.4, CLR 5.2.4): the owner's profile, or 404 when the store holds none. */
export async function answerProfile(owner: string, settings: ProviderSettings): Promise<HttpResponse> {
  const { signal } = settings;
  const asked = await callPort(() => settings.profiles.get(owner, { signal }), { signal });
  if (asked === undefined) return internalError();
  const profile = parseWith(foundProfileSchema, asked.value, "The answer of ProfileStore.get");
  return profile === undefined ? failure(404, "There is no profile.", "not_found") : buildJsonResponse(200, profile);
}

/** Reads the whole profile that a request to replace it carries, or the answer that refuses it. */
function profileOfBody(
  request: HttpRequest,
  settings: ProviderSettings,
): { readonly profile: Profile } | { readonly refusal: HttpResponse } {
  const body = bodyTypeOf(request, settings, [PROFILE_TYPE]);
  if ("refusal" in body) return body;
  let json: unknown;
  try {
    json = readJson(request, { maxBytes: settings.maxBodyBytes, maxTokens: settings.maxTokens });
  } catch (error) {
    return { refusal: unreadable(error instanceof DataError ? error.message : "The body is not JSON.") };
  }
  if (!isRecord(json)) return { refusal: invalidData("The body must be a profile as a JSON object.") };
  try {
    return { profile: readEntity("Profile", json) };
  } catch (error) {
    return { refusal: invalidData(error instanceof DataError ? error.message : "The body is not a profile.") };
  }
}

/**
 * Answers putProfile (OB 6.2.5, CLR 5.2.5): reads the whole profile, asks the store to replace the owner's, and answers 200
 * with the profile that the store returns.
 */
export async function answerProfileUpdate(
  request: HttpRequest,
  owner: string,
  settings: ProviderSettings,
): Promise<HttpResponse> {
  const read = profileOfBody(request, settings);
  if ("refusal" in read) return read.refusal;
  const { signal } = settings;
  const asked = await callPort(() => settings.profiles.put(owner, read.profile, { signal }), { signal });
  if (asked === undefined) return internalError();
  return buildJsonResponse(200, parseWith(profileSchema, asked.value, "The answer of ProfileStore.put"));
}
