import * as v from "valibot";
import type { Actor, Agent, InverseFunctionalIdentifiers } from "../model/index.js";
import { actorSchema, agentSchema } from "../read/internal.js";

/** Tells whether an Agent or a Group has exactly one of the four identifiers, which a request needs to name it. */
function hasOneIdentifier(actor: InverseFunctionalIdentifiers): boolean {
  const { mbox, mbox_sha1sum: mboxSha1sum, openid, account } = actor;
  return [mbox, mboxSha1sum, openid, account].filter((identifier) => identifier !== undefined).length === 1;
}

const EXPECTED = (issue: { readonly received: string }): string =>
  `expected an Agent or identified Group with exactly one of mbox, mbox_sha1sum, openid and account, found ${issue.received}`;

/** An Agent that a request names: it has exactly one identifier. */
export const identifiedAgent = v.pipe(
  agentSchema,
  v.check((agent: Agent) => hasOneIdentifier(agent), EXPECTED),
);

/** An Agent or a Group that a request names: it has exactly one identifier, so an anonymous Group is not one. */
export const identifiedActor = v.pipe(
  actorSchema,
  v.check((actor: Actor) => hasOneIdentifier(actor), EXPECTED),
);
