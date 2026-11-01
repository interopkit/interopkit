import * as v from "valibot";
import type { Actor, Agent, InverseFunctionalIdentifiers } from "../model/index.js";
import { actorSchema, agentSchema } from "./schemas.js";

/** Tells whether an Agent or a Group has exactly one of the four identifiers, which a request needs to name it. */
function hasOneIdentifier(actor: InverseFunctionalIdentifiers): boolean {
  const { mbox, mbox_sha1sum: mboxSha1sum, openid, account } = actor;
  return [mbox, mboxSha1sum, openid, account].filter((identifier) => identifier !== undefined).length === 1;
}

/** Tells whether an Agent or a Group has none of the four identifiers. */
function hasNoIdentifier(actor: InverseFunctionalIdentifiers): boolean {
  const { mbox, mbox_sha1sum: mboxSha1sum, openid, account } = actor;
  return [mbox, mboxSha1sum, openid, account].every((identifier) => identifier === undefined);
}

const EXPECTED = (issue: { readonly received: string }): string =>
  `expected an Agent or identified Group with exactly one of mbox, mbox_sha1sum, openid and account, found ${issue.received}`;

/**
 * An Agent or a Group that the LRS gives as the authority of a Statement: one with exactly one identifier, or an anonymous
 * Group with its members, which is how an OAuth consumer and its user are written (4.2.2.1).
 */
export const authoritySchema = v.pipe(
  actorSchema,
  v.check(
    (actor: Actor) =>
      hasOneIdentifier(actor) || (actor.objectType === "Group" && hasNoIdentifier(actor) && actor.member !== undefined),
    (issue) =>
      `expected an Agent or Group with one identifier, or an anonymous Group with members, found ${issue.received}`,
  ),
);

/** An Agent that a request names: it has exactly one identifier. */
export const identifiedAgentSchema = v.pipe(
  agentSchema,
  v.check((agent: Agent) => hasOneIdentifier(agent), EXPECTED),
);

/** An Agent or a Group that a request names: it has exactly one identifier, so an anonymous Group is not one. */
export const identifiedActorSchema = v.pipe(
  actorSchema,
  v.check((actor: Actor) => hasOneIdentifier(actor), EXPECTED),
);
