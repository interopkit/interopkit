import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { ProviderSettings } from "./options.js";
import { tooLarge, unsupportedType } from "./status.js";

/** Reads the media type of a body from its `Content-Type`, in lower case and without its parameters. */
function mediaTypeOf(request: HttpRequest): string | undefined {
  const type = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  return type === "" ? undefined : type;
}

/**
 * Checks the size and the media type of a body before anything reads it: at most `maxBodyBytes`, and one of the media types
 * that the operation takes.
 *
 * @returns The media type, or the answer that refuses the body: 413 or 415.
 */
export function bodyTypeOf(
  request: HttpRequest,
  settings: ProviderSettings,
  accepted: readonly string[],
): { readonly type: string } | { readonly refusal: HttpResponse } {
  const size = request.body.byteLength;
  if (size > settings.maxBodyBytes) return { refusal: tooLarge(size, settings.maxBodyBytes) };
  const type = mediaTypeOf(request);
  return type !== undefined && accepted.includes(type) ? { type } : { refusal: unsupportedType(type, accepted) };
}
