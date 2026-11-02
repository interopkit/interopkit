import type { HttpRequest } from "@interopkit/core/http";
import type { LrsDocument } from "../../model/index.js";
import type { WriteCondition } from "../ports.js";
import { refused, type Verdict } from "../verdict.js";
import { readTags, type Tags, tagsName } from "./etag.js";

/** The preconditions of a request to change a document. */
export interface Preconditions {
  /** The tags of `If-Match`. */
  readonly ifMatch?: Tags;
  /** The tags of `If-None-Match`. */
  readonly ifNoneMatch?: Tags;
}

/** Reads `If-Match` and `If-None-Match` from a request. A header that names no tag of the document is a precondition that fails, not an error. */
export function readPreconditions(request: HttpRequest): Preconditions {
  const match = request.headers["if-match"];
  const noneMatch = request.headers["if-none-match"];
  return {
    ...(match === undefined ? {} : { ifMatch: readTags(match) }),
    ...(noneMatch === undefined ? {} : { ifNoneMatch: readTags(noneMatch) }),
  };
}

/**
 * Judges the preconditions of a write against the document that exists, and says what the store must check when it writes
 * (4.1.4, RFC 9110 13.2.2): `If-Match` needs a document with one of its tags, and `If-None-Match` needs that the document does
 * not exist or has none of its tags. A PUT with neither header over a document that exists is refused with 409, and a POST with
 * neither is a merge into the document that exists. The condition that comes back is what the document was when it was read, so
 * a write that another writer got in front of is not made.
 */
export function judge(
  preconditions: Preconditions,
  current: LrsDocument | undefined,
  method: "PUT" | "POST",
): Verdict<WriteCondition> {
  const { ifMatch, ifNoneMatch } = preconditions;
  if (ifMatch !== undefined && (current === undefined || !tagsName(ifMatch, current.etag))) {
    return refused(412, "The document is not the version that If-Match names.");
  }
  if (ifNoneMatch !== undefined && current !== undefined && tagsName(ifNoneMatch, current.etag)) {
    return refused(412, "The document is a version that If-None-Match names, and the write asks that it is not.");
  }
  if (ifMatch === undefined && ifNoneMatch === undefined && method === "PUT" && current !== undefined) {
    return refused(
      409,
      "The document exists: send If-Match with its ETag to change it, or check its current state with a GET first.",
    );
  }
  if (current !== undefined) return { value: { ifMatch: current.etag } };
  return { value: ifNoneMatch === "*" ? { ifNoneMatch: "*" } : { none: true } };
}
