import type { HttpResponse } from "@interopkit/core/http";
import type { DocumentTarget, LrsDocument, StateScope } from "../../model/index.js";
import { attempt, type Context, isRefusal, type Refusal, refused } from "../verdict.js";
import { readTags, refuseIfNoneMatch, type Tags, tagsName } from "./etag.js";
import { removeAll, removeDocument } from "./port.js";
import { retryLostRaces } from "./races.js";

const NOT_THE_VERSION = "The document is not the version that If-Match names.";
const GONE = { status: 204, headers: {}, body: "" } as const;

/** Reads `If-Match` of a DELETE, which is optional; the header `If-None-Match` has no meaning here. */
function readTagsOf(context: Context) {
  return attempt(() => {
    const { headers } = context.request;
    refuseIfNoneMatch(headers["if-none-match"]);
    const match = headers["if-match"];
    return match === undefined ? undefined : readTags(match);
  });
}

/** What a removal does against the document that exists: nothing, since it is not there; a refusal; or the document to remove. */
function judgeRemoval(tags: Tags | undefined, current: LrsDocument | undefined): "gone" | Refusal | LrsDocument {
  if (current === undefined) return tags === undefined ? "gone" : refused(412, NOT_THE_VERSION);
  if (tags !== undefined && !tagsName(tags, current.etag)) return refused(412, NOT_THE_VERSION);
  return current;
}

/**
 * Removes one document (4.1.6.2): with `If-Match`, the document must exist and have one of its tags, or the answer is 412; with
 * none, whatever document exists is removed. A document that does not exist is already removed, so a `DELETE` with no
 * `If-Match` answers 204. A removal that loses a race is made again, within three tries, and refused with 409
 * after them.
 */
export async function deleteDocument(context: Context, target: DocumentTarget): Promise<HttpResponse> {
  const tags = readTagsOf(context);
  if (isRefusal(tags)) return context.refuse(tags.status, tags.message);
  return retryLostRaces(context, target, "removed", async (current) => {
    const judged = judgeRemoval(tags.value, current);
    if (judged === "gone") return GONE;
    if ("status" in judged) return context.refuse(judged.status, judged.message);
    const outcome = await removeDocument(context, target, judged.etag);
    if (isRefusal(outcome)) return context.refuse(outcome.status, outcome.message);
    // A document that changed or went between the read and the removal is judged again, as the headers say.
    return outcome.value === "deleted" ? GONE : undefined;
  });
}

/** Removes every State document of a context, with no precondition, since the documents have no common tag (4.1.6.2). */
export async function deleteStates(context: Context, scope: StateScope): Promise<HttpResponse> {
  const removed = await removeAll(context, scope);
  if (isRefusal(removed)) return context.refuse(removed.status, removed.message);
  return GONE;
}
