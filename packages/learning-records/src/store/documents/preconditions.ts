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
 * What a route does with a PUT that has neither `If-Match` nor `If-None-Match`: on 2.0 it makes a document that does not exist
 * and is refused with 409 over one that does (4.1.4); on 1.0.3 State it replaces whatever exists, and a profile needs the
 * header, so that the PUT is refused with 400 where no document exists and with 409 where one does (1.0.3 Communication 3.1).
 */
export type BarePut = "create" | "replace" | "refuse";

/**
 * Judges the preconditions of a write against the document that exists, and says what the store must check when it writes
 * (4.1.4, RFC 9110 13.2.2): `If-Match` needs a document with one of its tags, and `If-None-Match` needs that the document does
 * not exist or has none of its tags. A PUT with neither header is judged as the route says (`BarePut`), and a POST with neither
 * is a merge into the document that exists. The condition that comes back is what the document was when it was read, so a
 * write that another writer got in front of is not made.
 */
export function judge(
  preconditions: Preconditions,
  current: LrsDocument | undefined,
  method: "PUT" | "POST",
  barePut: BarePut,
): Verdict<WriteCondition> {
  const { ifMatch, ifNoneMatch } = preconditions;
  const bare = method === "PUT" && ifMatch === undefined && ifNoneMatch === undefined;
  if (bare && barePut === "replace") return { value: { unconditional: true } };
  if (ifMatch !== undefined && (current === undefined || !tagsName(ifMatch, current.etag))) {
    return refused(412, "The document is not the version that If-Match names.");
  }
  if (ifNoneMatch !== undefined && current !== undefined && tagsName(ifNoneMatch, current.etag)) {
    return refused(412, "The document is a version that If-None-Match names, and the write asks that it is not.");
  }
  if (bare && current !== undefined) {
    return refused(
      409,
      "The document exists: send If-Match with its ETag to change it, or check its current state with a GET first.",
    );
  }
  if (bare && barePut === "refuse") {
    return refused(
      400,
      'A PUT of a profile needs a precondition on xAPI 1.0.3: send If-None-Match: "*" to create the document, or If-Match with its ETag to change it.',
    );
  }
  if (current !== undefined) return { value: { ifMatch: current.etag } };
  return { value: ifNoneMatch === "*" ? { ifNoneMatch: "*" } : { none: true } };
}
