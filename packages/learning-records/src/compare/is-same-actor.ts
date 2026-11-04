import { parseWith } from "@interopkit/core/checks";
import type { Actor } from "../model/index.js";
import { actorSchema } from "../read/internal.js";
import { sameIdentity } from "./canonical.js";

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
  return sameIdentity(parseWith(actorSchema, a, "The first Actor"), parseWith(actorSchema, b, "The second Actor"));
}
