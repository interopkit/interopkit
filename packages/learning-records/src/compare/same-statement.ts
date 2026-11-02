import type { Statement } from "../model/index.js";
import { readEitherVersion } from "../read/internal.js";
import { equivalenceKey } from "./canonical.js";

/**
 * Tells whether two Statements are the same Statement by the rules of immutability (4.2): the Actor, the Verb without its
 * display, the Object, the Result and the context are equal, and the duration is equal to 0.01 second.
 *
 * @remarks
 * Not compared: the id, the timestamp, `stored`, the authority, the version, the Attachments, the order of the members of a
 * Group, and the definitions of the Activities. The case of a value counts only where its data type ignores case: the scheme
 * and the host of an IRI, an email address, a UUID, a hash and a language tag. An LRS uses it to answer 204 or 409 for a
 * Statement whose id it holds. A Statement with an error is not compared: both are read as an LRS reads them.
 *
 * @param a - A Statement.
 * @param b - Another Statement.
 * @returns Whether they are the same Statement.
 * @throws `DataError` when either is not a Statement, as `readStatement` says.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function sameStatement(a: Statement, b: Statement): boolean {
  return equivalenceKey(readEitherVersion(a)) === equivalenceKey(readEitherVersion(b));
}
