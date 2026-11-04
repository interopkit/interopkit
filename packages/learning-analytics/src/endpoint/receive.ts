import { callPort, DataError, LimitError } from "@interopkit/core";
import { MAX_JSON_DEPTH } from "@interopkit/core/checks";
import { type HttpRequest, type HttpResponse, readJson } from "@interopkit/core/http";
import { assembleEnvelope, type EnvelopeFields, parseEnvelope, strictRefusal } from "./envelope.js";
import type { EndpointSettings } from "./options.js";
import { badRequest, internalError, received, tooLarge, unsupportedType, unsupportedVersion } from "./status.js";
import { contextOfVersion, versionOfContext } from "./versions.js";

/** Reads the media type of a body from its `Content-Type`, in lower case and without its parameters. */
function mediaTypeOf(request: HttpRequest): string | undefined {
  return request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
}

/** Checks the media type and then the size of a body, before anything reads it: 415 and 413. */
function bodyRefusal(request: HttpRequest, settings: EndpointSettings): HttpResponse | undefined {
  if (mediaTypeOf(request) !== "application/json") return unsupportedType();
  const size = request.body.byteLength;
  return size > settings.maxPayloadBytes
    ? tooLarge(`The body has ${size} bytes, above the limit of ${settings.maxPayloadBytes} bytes.`)
    : undefined;
}

/** Parses the body as JSON within the limits, and reads the fields of the envelope: 413 over a limit, 400 for another fault. */
function fieldsOf(
  request: HttpRequest,
  settings: EndpointSettings,
): { readonly fields: EnvelopeFields } | { readonly refusal: HttpResponse } {
  try {
    const value = readJson(request, {
      maxBytes: settings.maxPayloadBytes,
      maxDepth: MAX_JSON_DEPTH,
      maxTokens: settings.maxTokens,
    });
    return { fields: parseEnvelope(value) };
  } catch (error) {
    if (error instanceof LimitError) return { refusal: tooLarge(error.message) };
    if (error instanceof DataError) return { refusal: badRequest(error.message) };
    throw error;
  }
}

/**
 * Answers a POST of an envelope for the principal that `authorize` named, in the order that Caliper 1.2 section 6.1 allows and
 * that costs the least: the media type (415), the size (413), the JSON and the fields of the envelope (400), its version (422),
 * then its items, which `accept` receives.
 */
export async function receive(
  request: HttpRequest,
  principal: string,
  settings: EndpointSettings,
): Promise<HttpResponse> {
  const refusal = bodyRefusal(request, settings);
  if (refusal !== undefined) return refusal;
  const parsed = fieldsOf(request, settings);
  if ("refusal" in parsed) return parsed.refusal;
  const { fields } = parsed;
  const version = versionOfContext(fields.dataVersion, settings.versions);
  if (version === undefined) {
    return unsupportedVersion(fields.dataVersion, settings.versions.map(contextOfVersion));
  }
  // `readJson` parsed the body within the depth of `MAX_JSON_DEPTH`, so the items need no copy.
  const envelope = assembleEnvelope(fields, settings.maxFindings, version, true);
  const fault = settings.strict ? strictRefusal(envelope) : undefined;
  if (fault !== undefined) return badRequest(fault);
  const { accept, signal } = settings;
  const accepted = await callPort(() => accept({ principal, ...envelope }, { signal }), { signal });
  return accepted === undefined ? internalError() : received();
}
