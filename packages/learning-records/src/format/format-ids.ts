import type { Activity, Actor, Agent, Group, InverseFunctionalIdentifiers, Verb } from "../model/index.js";
import type { Mappers } from "./transform.js";

/** The identifiers of an Agent or a Group that it has, and nothing else. */
function identifiersOf(actor: Actor): InverseFunctionalIdentifiers {
  const { mbox, mbox_sha1sum, openid, account } = actor;
  return {
    ...(mbox === undefined ? {} : { mbox }),
    ...(mbox_sha1sum === undefined ? {} : { mbox_sha1sum }),
    ...(openid === undefined ? {} : { openid }),
    ...(account === undefined ? {} : { account }),
  };
}

/** An Agent with the identifier alone. */
function agentIds(agent: Agent): Agent {
  return identifiersOf(agent);
}

/**
 * A Group with the minimum that identifies it: the identifier of an identified Group, and the identifier of each member of an
 * anonymous Group.
 */
function groupIds(group: Group): Group {
  const identifiers = identifiersOf(group);
  return Object.keys(identifiers).length > 0
    ? { objectType: "Group", ...identifiers }
    : { objectType: "Group", member: (group.member ?? []).map(agentIds) };
}

/** An Activity with the id alone. */
function activityIds(activity: Activity): Activity {
  return { id: activity.id };
}

/** A Verb with the id alone. */
function verbIds(verb: Verb): Verb {
  return { id: verb.id };
}

/** The changes of the format `ids`: only what is necessary to identify an Agent, a Group, an Activity and a Verb (4.1.6.1). */
export const IDS: Mappers = { agent: agentIds, group: groupIds, activity: activityIds, verb: verbIds };
