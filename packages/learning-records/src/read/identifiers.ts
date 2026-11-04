import type { Issue } from "@interopkit/core/checks";
import type { Actor } from "../model/index.js";
import { error } from "./finding.js";
import { member } from "./path.js";

/** The properties of which an Agent or an identified Group has exactly one (4.2.2.1). */
const IDENTIFIERS = ["mbox", "mbox_sha1sum", "openid", "account"] as const;

/** Writes two or more names as a list: `mbox and openid`, `mbox, openid and account`. */
function listOf(names: readonly string[]): string {
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Judges the identifiers of an Agent or a Group: an LRS shall reject an Actor with more than one (4.2.4.2), and an Agent
 * needs one (4.2.2.1). A Group with none is anonymous and needs its members.
 */
export function identifierIssues(actor: Actor, path: string): Issue[] {
  const present = IDENTIFIERS.filter((name) => actor[name] !== undefined);
  const needs = `needs exactly one of ${listOf(IDENTIFIERS)}`;
  if (present.length > 1) return [error(path, "identifier-count", `${needs}, found ${listOf(present)}.`)];
  if (present.length === 1) return [];
  if (actor.objectType !== "Group") return [error(path, "identifier-count", `${needs}, found none.`)];
  if (actor.member !== undefined) return [];
  return [
    error(
      member(path, "member"),
      "missing-property",
      'missing the property "member", which a Group with no identifier needs.',
    ),
  ];
}
