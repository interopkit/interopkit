import { DataError } from "@interopkit/core";
import { checkNonEmptyString, checkString, describe, isUuid } from "@interopkit/core/checks";
import { v5 } from "uuid";

/**
 * Returns the id of a Statement from what the event is, so that a resend of the event repeats the id and an LRS keeps the
 * first copy.
 *
 * @remarks
 * The id is a UUID of version 5 (RFC 9562 5.5): the same namespace and name always give the same id. The name should be what
 * makes the event this event and no other, such as the learner, the activity and the attempt; the namespace is a UUID that the
 * host keeps and never changes, since changing it changes every id.
 *
 * @param namespace - A UUID.
 * @param name - What identifies the event. At least one character.
 * @returns The UUID, in lower case.
 * @throws `DataError` when the namespace is not a UUID or the name is not a non-empty string.
 * @see {@link https://www.rfc-editor.org/rfc/rfc9562#section-5.5 | RFC 9562, UUID version 5}
 */
export function deriveStatementId(namespace: string, name: string): string {
  checkString(namespace, "The namespace");
  if (!isUuid(namespace)) throw new DataError(`The namespace must be a UUID, found ${describe(namespace)}.`);
  checkNonEmptyString(name, "The name");
  return v5(name, namespace);
}
