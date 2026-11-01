import { DataError } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import type { DocumentTarget, StateScope } from "../../model/index.js";
import { attempt, type Context, isRefusal } from "../verdict.js";
import { readIfMatch, tagsName } from "./etag.js";
import { fetchDocument, removeAll, removeDocument } from "./port.js";

const MISSING = "The LRS holds no such document.";

/** Reads `If-Match` of a DELETE; the header `If-None-Match` has no meaning here. */
function readTags(context: Context) {
  return attempt(() => {
    const { headers } = context.request;
    if (headers["if-none-match"] !== undefined) throw new DataError("A DELETE takes If-Match, not If-None-Match.");
    const match = headers["if-match"];
    return match === undefined ? undefined : readIfMatch(match);
  });
}

/**
 * Removes one document (4.1.6.2): 404 when none exists, 409 without `If-Match`, and 412 when its tag is not one the header
 * names. A removal that loses a race is made again, within `limits.mergeRetries` tries, and refused with 409 after them.
 */
export async function deleteDocument(context: Context, target: DocumentTarget): Promise<HttpResponse> {
  const tags = readTags(context);
  if (isRefusal(tags)) return context.refuse(tags.status, tags.message);
  for (let attempts = 0; attempts < context.settings.limits.mergeRetries; attempts += 1) {
    const current = await fetchDocument(context, target);
    if (isRefusal(current)) return context.refuse(current.status, current.message);
    if (current.value === undefined) return context.refuse(404, MISSING);
    if (tags.value === undefined) {
      return context.refuse(409, "A DELETE of a document needs If-Match with the ETag of the document.");
    }
    if (!tagsName(tags.value, current.value.etag)) {
      return context.refuse(412, "The document is not the version that If-Match names.");
    }
    const outcome = await removeDocument(context, target, current.value.etag);
    if (isRefusal(outcome)) return context.refuse(outcome.status, outcome.message);
    if (outcome.value === "deleted") return { status: 204, headers: {}, body: "" };
  }
  return context.refuse(
    409,
    "The document was changed by other requests while this one was removed: read it again and retry.",
  );
}

/** Removes every State document of a context, with no precondition, since the documents have no common tag (4.1.6.2). */
export async function deleteStates(context: Context, scope: StateScope): Promise<HttpResponse> {
  const removed = await removeAll(context, scope);
  if (isRefusal(removed)) return context.refuse(removed.status, removed.message);
  return { status: 204, headers: {}, body: "" };
}
