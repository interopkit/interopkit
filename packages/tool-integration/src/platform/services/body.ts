import { DataError } from "@interopkit/core";
import { buildJsonResponse, type HttpRequest, type HttpResponse, readJson } from "@interopkit/core/http";
import { errorBody } from "../../protocol/internal.js";
import { refusal, tooLarge } from "../answers.js";

/** Returns the media type of a request without its parameters, in lower case. */
function mediaTypeOf(request: HttpRequest): string | undefined {
  return request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
}

/**
 * Reads the JSON body of a request to a service into a model: 415 for another media type, 413 for a body above the limit,
 * measured before it is parsed, and 400 for a body that is not JSON or not the model, with the path of its first invalid member.
 *
 * @param mediaType - The media type of the body, such as `application/vnd.ims.lis.v1.score+json`.
 * @param read - The reader of the model, which throws `DataError`.
 * @param invalid - The error code of a body that is not the model.
 * @returns The model, or the answer to send.
 */
export function readBody<T>(
  request: HttpRequest,
  mediaType: string,
  maxBytes: number,
  read: (value: unknown) => T,
  invalid = "invalid_request",
): { readonly value: T } | HttpResponse {
  if (mediaTypeOf(request) !== mediaType) {
    return buildJsonResponse(415, errorBody("unsupported_media_type", `The body must be ${mediaType}.`), {
      headers: {
        accept: mediaType,
      },
    });
  }
  if (request.body.byteLength > maxBytes) return tooLarge(request.body.byteLength, maxBytes);
  try {
    return { value: read(readJson(request, { maxBytes })) };
  } catch (error) {
    if (error instanceof DataError) return refusal(400, invalid, error.message);
    throw error;
  }
}
