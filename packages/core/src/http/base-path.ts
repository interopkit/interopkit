import * as v from "valibot";
import type { Schema } from "../checks.js";

/** A path whose segments each start with `/` and are not empty, so that it is not `/` and does not end with one. */
const BASE_PATH = /^(?:\/[^/?#\s]+)*$/u;

/** The base against which a path alone is parsed as `URL` parses the path of a request; only the path of the result is read. */
const PATH_BASE = "https://handler.invalid";

const basePathMessage = (issue: v.BaseIssue<unknown>): string =>
  `expected "" or a path that starts with / and does not end with /, found ${issue.received}`;

/**
 * The schema of the path that a handler is mounted at: `""`, or a path that starts with `/` and does not end with one, given as
 * it is, then written as the URL of a request writes its path, percent-encoded and without segments of dots, and checked again.
 *
 * @remarks
 * A handler compares the result with the `pathname` of the URL of a request, which `URL` writes in the same form, so `/café` and
 * `/caf%C3%A9` are one path, and a path whose dot segments leave `/`, such as `/xapi/..`, is refused, since no request path
 * keeps it.
 */
export const basePathSchema: Schema<string> = v.pipe(
  v.string(),
  v.regex(BASE_PATH, basePathMessage),
  v.transform((path) => (path === "" ? "" : new URL(path, PATH_BASE).pathname)),
  v.regex(BASE_PATH, basePathMessage),
);
