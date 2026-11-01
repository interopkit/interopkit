import { DataError } from "@interopkit/core";
import type { HttpRequest } from "@interopkit/core/http";
import type { LrsDocument } from "../../model/index.js";
import type { WriteCondition } from "../ports.js";
import { attempt, refused, type Verdict } from "../verdict.js";
import { readIfMatch, readIfNoneMatch, type Tags, tagsName } from "./etag.js";

/** The preconditions of a request to change a document. */
export interface Preconditions {
  /** The tags of `If-Match`. */
  readonly ifMatch?: Tags;
  /** Whether the request has `If-None-Match: *`. */
  readonly ifNoneMatch?: true;
}

/** Reads `If-Match` and `If-None-Match` from a request, and refuses a request that has both. */
export function readPreconditions(request: HttpRequest): Verdict<Preconditions> {
  return attempt(() => {
    const match = request.headers["if-match"];
    const noneMatch = request.headers["if-none-match"];
    if (match !== undefined && noneMatch !== undefined) {
      throw new DataError("A request cannot have both If-Match and If-None-Match.");
    }
    if (match !== undefined) return { ifMatch: readIfMatch(match) };
    if (noneMatch !== undefined) {
      readIfNoneMatch(noneMatch);
      return { ifNoneMatch: true } as const;
    }
    return {};
  });
}

/**
 * Judges the preconditions of a write against the document that exists, and says what the store must check when it writes
 * (4.1.4): `If-Match` needs a document with one of the tags, `If-None-Match: *` needs none, and a write with neither is
 * refused with 409 when the document exists.
 */
export function judge(preconditions: Preconditions, current: LrsDocument | undefined): Verdict<WriteCondition> {
  if (preconditions.ifMatch !== undefined) {
    if (current === undefined || !tagsName(preconditions.ifMatch, current.etag)) {
      return refused(412, "The document is not the version that If-Match names.");
    }
    return { value: { ifMatch: current.etag } };
  }
  if (preconditions.ifNoneMatch === true) {
    if (current !== undefined) return refused(412, "The document exists, and If-None-Match: * asks that it does not.");
    return { value: { ifNoneMatch: "*" } };
  }
  if (current !== undefined) {
    return refused(
      409,
      "The document exists: send If-Match with its ETag to change it, or If-None-Match: * to create it.",
    );
  }
  return { value: { none: true } };
}
