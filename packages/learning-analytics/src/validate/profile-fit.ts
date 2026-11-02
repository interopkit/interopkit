import { isRecord } from "@interopkit/core/checks";
import type { CaliperEvent } from "../model/index.js";
import { isNamed, type ProfileEntry } from "./profile-entry.js";

/** What a table says of an event: the entries that it fits, or the first place where it does not fit. */
export type Fit =
  | {
      /** The event fits the table. */
      readonly fits: true;
      /** The entries of the table that the event fits: the profiles and actions that allow it. */
      readonly rows: readonly ProfileEntry[];
    }
  | {
      /** The event does not fit the table. */
      readonly fits: false;
      /** The rule that the event breaks. */
      readonly rule: "profile-event" | "profile-action" | "profile-actor" | "profile-object";
      /** Where the event breaks it. */
      readonly path: string;
      /** What is wrong, as a sentence that reads after the path. */
      readonly message: string;
    };

/** Words a list of terms for a message: `A`, `A or B`, `A, B or C`. */
export function namesOf(terms: readonly string[]): string {
  const unique = [...new Set(terms)];
  const last = unique.pop();
  return unique.length === 0 ? `${last}` : `${unique.join(", ")} or ${last}`;
}

/** The class of an entity that an event gives as an object, and `undefined` for an IRI, which names no class. */
export function classOf(entity: unknown): string | undefined {
  return isRecord(entity) && typeof entity.type === "string" ? entity.type : undefined;
}

/**
 * Judges an event against the entries of a table, in the order that the tables read: the event in its profile (or in any profile
 * when the event names none), the action, the actor and the object. Each step keeps the entries that fit and the next looks only at
 * them, so the actor and the object are judged together with the action that they go with.
 */
export function judge(table: readonly ProfileEntry[], event: CaliperEvent): Fit {
  const { profile, type, action } = event;
  const ofEvent = table.filter((entry) => entry.event === type);
  const inProfile = profile === undefined ? ofEvent : ofEvent.filter((entry) => entry.profile === profile);
  if (inProfile.length === 0) {
    // An event of no profile is in some profile of the specification's table, so this is an event whose profile does not have it.
    return {
      fits: false,
      rule: "profile-event",
      path: "profile",
      message: `expected a profile that has ${type}, found ${profile}; ${type} is in ${namesOf(ofEvent.map((entry) => entry.profile))}.`,
    };
  }
  const byAction = inProfile.filter((entry) => entry.actions.includes(action));
  if (byAction.length === 0) {
    const allowed = namesOf(inProfile.flatMap((entry) => entry.actions));
    return { fits: false, rule: "profile-action", path: "action", message: `expected ${allowed}, found ${action}.` };
  }
  const actor = classOf(event.actor);
  const byActor = actor === undefined ? byAction : byAction.filter((entry) => isNamed(actor, entry.actor));
  if (byActor.length === 0) {
    const allowed = namesOf(byAction.flatMap((entry) => entry.actor));
    return {
      fits: false,
      rule: "profile-actor",
      path: "actor",
      message: `expected ${allowed} to ${action}, found an entity of type ${actor}.`,
    };
  }
  const object = classOf(event.object);
  const byObject = object === undefined ? byActor : byActor.filter((entry) => isNamed(object, entry.object));
  if (byObject.length === 0) {
    const allowed = namesOf(byActor.flatMap((entry) => entry.object));
    return {
      fits: false,
      rule: "profile-object",
      path: "object",
      message: `expected ${allowed} for ${action}, found an entity of type ${object}.`,
    };
  }
  return { fits: true, rows: byObject };
}
