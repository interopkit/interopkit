import { DataError } from "@interopkit/core";
import { describeRefusal } from "@interopkit/core/checks";
import { type StatementIssue, validateStatement } from "@interopkit/learning-records";
import { CMI5_VERBS } from "../model/index.js";

/** A Statement that holds a part to judge, valid in everything else, so that the rules of xAPI judge the part alone. */
const HOLDER = {
  actor: { objectType: "Agent", account: { homePage: "https://lms.example.org", name: "holder" } },
  verb: { id: CMI5_VERBS.launched },
  object: { objectType: "Activity", id: "https://lms.example.org/activities/holder" },
} as const;

/**
 * Judges the Actor or the Context of a document of cmi5 by the rules of xAPI 1.0.3 for an LRS, which `learning-records` holds:
 * the part goes into a Statement that is valid in everything else, and the findings of the part are its errors.
 *
 * @returns The errors, with paths in the part.
 */
function partErrors(part: "actor" | "context", value: unknown): StatementIssue[] {
  const statement = { ...HOLDER, [part]: value };
  return validateStatement(statement, { role: "lrs", version: "1.0.3" })
    .filter(({ severity }) => severity === "error")
    .map((finding) => ({ ...finding, path: finding.path.slice(part.length).replace(/^\./u, "") }));
}

/**
 * Checks an Actor or a Context of a document of cmi5 by the rules of xAPI 1.0.3.
 *
 * @param label - Names the value in the message, such as `The actor of the launch URL`.
 * @throws `DataError` that names the path of the first error and counts the others.
 */
export function checkXapiPart(part: "actor" | "context", value: unknown, label: string): void {
  const errors = partErrors(part, value);
  if (errors.length > 0) throw new DataError(describeRefusal(label, errors, "validateStatement"));
}
