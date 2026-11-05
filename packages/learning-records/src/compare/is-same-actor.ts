import { DataError } from "@interopkit/core";
import { parseWith } from "@interopkit/core/checks";
import type { Actor } from "../model/index.js";
import { actorSchema, identifierIssues, item } from "../read/internal.js";
import { sameIdentity } from "./canonical.js";

/**
 * Reads an Agent or a Group as an LRS reads an Actor: its shape, and exactly one identifier, or for a Group none and its
 * members, each an Agent with one.
 */
function readActor(value: unknown, label: string): Actor {
  const actor = parseWith(actorSchema, value, label);
  const members = actor.objectType === "Group" ? (actor.member ?? []) : [];
  const [issue] = [
    ...identifierIssues(actor, ""),
    ...members.flatMap((agent, index) => identifierIssues(agent, item("member", index))),
  ];
  if (issue === undefined) return actor;
  throw new DataError(`${label} is invalid${issue.path === "" ? "" : ` at ${issue.path}`}: ${issue.message}`);
}

/**
 * Tells whether two Agents or Groups are the same Actor by the identifier of xAPI (4.1.6.1): the same `mbox`, `mbox_sha1sum`,
 * `openid` or `account`, with the case of an email address and a hash, and of the scheme and the host of an IRI, folded; for two
 * anonymous Groups, the same members in any order. The name and the type of a value that has an identifier make no difference.
 *
 * @param a - An Agent or a Group.
 * @param b - Another Agent or Group.
 * @returns Whether they are the same Actor.
 * @throws `DataError` when either is not an Agent or a Group, as an LRS reads an Actor.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function isSameActor(a: Actor, b: Actor): boolean {
  return sameIdentity(readActor(a, "The first Actor"), readActor(b, "The second Actor"));
}
