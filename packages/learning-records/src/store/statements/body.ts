import { describe } from "@interopkit/core/checks";
import { type HttpRequest, readText } from "@interopkit/core/http";
import { readMultipart } from "../../attachments/index.js";
import type { AttachmentData } from "../../model/index.js";
import { mediaTypeOf } from "../../model/internal.js";
import { readStatementJson } from "../../read/index.js";
import type { LrsSettingsLimits } from "../options.js";
import { attempt, isRefusal, refused, type Verdict } from "../verdict.js";

/** The body of a request that stores Statements: their JSON, and the data of the Attachments that came with it. */
export interface StatementsBody {
  /** The parsed JSON: a Statement or a list of them. */
  readonly json: unknown;
  /** The data of the Attachments by their hash in lower case. */
  readonly parts: ReadonlyMap<string, AttachmentData>;
}

/** Reads the body of a PUT or a POST: JSON, or a `multipart/mixed` message of Statements and Attachment data (4.1.3). */
export function readBody(request: HttpRequest, limits: LrsSettingsLimits): Verdict<StatementsBody> {
  const contentType = request.headers["content-type"];
  const type = contentType === undefined ? undefined : mediaTypeOf(contentType);
  if (contentType !== undefined && type === "multipart/mixed") {
    const read = attempt(() =>
      readMultipart(contentType, request.body, {
        maxParts: limits.maxParts,
        maxPartBytes: limits.maxPartBytes,
        maxTotalBytes: limits.maxBodyBytes,
        maxDepth: limits.maxDepth,
        maxTokens: limits.maxTokens,
      }),
    );
    return isRefusal(read) ? read : { value: { json: read.value.statements, parts: read.value.parts } };
  }
  if (type !== "application/json") {
    return refused(
      400,
      `The content type must be application/json or multipart/mixed, found ${describe(contentType)}.`,
    );
  }
  const read = attempt(() =>
    readStatementJson(readText(request), {
      maxBytes: limits.maxBodyBytes,
      maxDepth: limits.maxDepth,
      maxTokens: limits.maxTokens,
    }),
  );
  return isRefusal(read) ? read : { value: { json: read.value, parts: new Map() } };
}
