import { DataError } from "@interopkit/core";
import { checkProperties, checkRecord, checkString, describe, isUuid } from "@interopkit/core/checks";
import { type Actor, type Statement, VERB_VOIDED } from "../model/index.js";
import { buildStatement } from "./build-statement.js";

/** The display of the voided verb, which the standard recommends for a Verb (4.2.2.2). */
const VOIDED_DISPLAY = { "en-US": "voided" } as const;

/** What a Learning Record Provider gives to void a Statement. */
export interface VoidingInput {
  /** The id of the voiding Statement, a UUID. */
  readonly id: string;
  /** Who voids the Statement. */
  readonly actor: Actor;
  /** When the Statement was voided: an RFC 3339 date and time with any offset, which is written in UTC. */
  readonly timestamp: string;
}

/**
 * Builds the Statement that voids another: the voided verb, with a Statement Reference to the target as its Object.
 *
 * @remarks
 * The target need not exist (4.2.4.1). A Statement that voids another cannot be voided itself (4.2.5), which is a rule of the
 * LRS and not of the Statement.
 *
 * @param target - The id of the Statement to void, a UUID.
 * @param input - The id, the actor and the time of the voiding Statement.
 * @returns The Statement.
 * @throws `DataError` when the target is not a UUID, or the Statement cannot be built as `buildStatement` says.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function voidingStatement(target: string, input: VoidingInput): Statement {
  checkString(target, "The target");
  if (!isUuid(target)) {
    throw new DataError(`The target must be the id of the Statement to void, as a UUID, found ${describe(target)}.`);
  }
  checkRecord(input, "The voiding input must be an object");
  checkProperties(input, "The voiding input", ["id", "actor", "timestamp"]);
  return buildStatement({
    id: input.id,
    actor: input.actor,
    verb: { id: VERB_VOIDED, display: VOIDED_DISPLAY },
    object: { objectType: "StatementRef", id: target },
    timestamp: input.timestamp,
  });
}
