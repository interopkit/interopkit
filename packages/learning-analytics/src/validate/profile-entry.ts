import {
  AGENT_TYPES,
  ASSIGNABLE_TYPES,
  type CaliperAction,
  type CaliperEntityType,
  type CaliperEventType,
  type CaliperProfile,
  DIGITAL_RESOURCE_TYPES,
  ENTITY_TYPES,
  MEDIA_OBJECT_TYPES,
  RESPONSE_TYPES,
  SESSION_TYPES,
} from "../model/index.js";

/**
 * The classes that a table of a profile names with subtypes, each with the terms of the class and of every class below it. A
 * class that is not here has no subtype, so a table that names it means that class alone.
 */
export const SUBTYPES: ReadonlyMap<CaliperEntityType, readonly CaliperEntityType[]> = new Map<
  CaliperEntityType,
  readonly CaliperEntityType[]
>([
  ["Entity", ENTITY_TYPES],
  ["Agent", AGENT_TYPES],
  ["DigitalResource", DIGITAL_RESOURCE_TYPES],
  ["AssignableDigitalResource", ASSIGNABLE_TYPES],
  ["MediaObject", MEDIA_OBJECT_TYPES],
  ["Session", SESSION_TYPES],
  ["Response", RESPONSE_TYPES],
]);

/** What a table of a profile says of the actions of one event: who acts, on what, and what the action makes. */
export interface ProfileEntry {
  /** The profile that the table belongs to. */
  readonly profile: CaliperProfile;
  /** The event. */
  readonly event: CaliperEventType;
  /** The actions of the event that the entry covers. */
  readonly actions: readonly CaliperAction[];
  /** The classes of the actor, as the table names them. */
  readonly actor: readonly CaliperEntityType[];
  /** The classes of the object, as the table names them. */
  readonly object: readonly CaliperEntityType[];
  /** The classes of the recommended generated entity; none when the table names none. */
  readonly generated: readonly CaliperEntityType[];
  /** The classes of the target that the table names; none when it names none. */
  readonly target: readonly CaliperEntityType[];
  /** Whether the text of the profile says that the generated entity SHOULD be given. */
  readonly advised: boolean;
}

/** What an entry says beside its profile, its event and its actions. */
export interface ProfileCells {
  readonly actor?: readonly CaliperEntityType[];
  readonly object: readonly CaliperEntityType[];
  readonly generated?: readonly CaliperEntityType[];
  readonly target?: readonly CaliperEntityType[];
  readonly advised?: boolean;
}

/** Writes an entry: a Person acts unless the cells say otherwise, and no generated entity or target is named unless they do. */
export function entry(
  profile: CaliperProfile,
  event: CaliperEventType,
  actions: readonly CaliperAction[],
  cells: ProfileCells,
): ProfileEntry {
  return {
    profile,
    event,
    actions,
    actor: cells.actor ?? ["Person"],
    object: cells.object,
    generated: cells.generated ?? [],
    target: cells.target ?? [],
    advised: cells.advised ?? false,
  };
}

/** Tells whether a class is one of the classes that a cell names, or below one of them. */
export function isNamed(type: string, named: readonly CaliperEntityType[]): boolean {
  return named.some((name) => (SUBTYPES.get(name) ?? [name]).some((term) => term === type));
}
