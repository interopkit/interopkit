import {
  type CaliperAction,
  type CaliperEntityType,
  type CaliperEventType,
  type CaliperRole,
  DIGITAL_RESOURCE_TYPES,
  ENTITY_TYPES,
  EVENT_TYPES,
  SESSION_TYPES,
} from "../model/index.js";
import { LIBRARY_ENTITY_TYPES, LIBRARY_EVENT_TYPES } from "../model/internal.js";

/**
 * The classes that Caliper 1.2 defines and Caliper 1.1 does not: the classes of the Library Use Profile, which extends 1.2, and
 * the `SystemIdentifier` that 1.2 added. A document of 1.1 that uses one is refused.
 */
export const NOT_IN_1_1 = {
  events: LIBRARY_EVENT_TYPES,
  entities: [...LIBRARY_ENTITY_TYPES, "SystemIdentifier"],
} as const satisfies {
  readonly events: readonly CaliperEventType[];
  readonly entities: readonly CaliperEntityType[];
};

/** Terms of a vocabulary that Caliper 1.2 added to a property, and that a document of 1.1 may not use as its value. */
interface AddedTerms {
  /** The name of the property whose value is the term, or a list of them. */
  readonly property: "action" | "roles";
  /** Says what the term is, for a message: `an action`. */
  readonly what: string;
  /** The terms of 1.2 that 1.1 lacks. */
  readonly terms: readonly (CaliperAction | CaliperRole)[];
}

/**
 * The actions of the Library Use Profile, which extends 1.2, and the role `Manager#Manager`, which Appendix F of 1.2 lists and
 * the roles of 1.1 and the context of 1.2 lack.
 */
export const TERMS_NOT_IN_1_1: readonly AddedTerms[] = [
  { property: "action", what: "an action", terms: ["Accessed", "Attended"] },
  { property: "roles", what: "a role", terms: ["Manager#Manager"] },
];

/** A property that Caliper 1.2 added to some classes, and Caliper 1.1 does not define for them. */
interface AddedProperty {
  /** The name of the property. */
  readonly property: string;
  /** The classes that have it in 1.2. */
  readonly classes: readonly (CaliperEntityType | CaliperEventType)[];
}

/**
 * The properties that Caliper 1.2 added to the classes that 1.1 has: `profile` of every event, `otherIdentifiers` of every entity,
 * `storageName` of the digital resources, `client` of the sessions, and what a `SoftwareApplication` says of its host.
 */
const ADDED_IN_1_2: readonly AddedProperty[] = [
  { property: "profile", classes: EVENT_TYPES },
  { property: "otherIdentifiers", classes: ENTITY_TYPES },
  { property: "storageName", classes: DIGITAL_RESOURCE_TYPES },
  { property: "client", classes: SESSION_TYPES },
  { property: "host", classes: ["SoftwareApplication"] },
  { property: "ipAddress", classes: ["SoftwareApplication"] },
  { property: "userAgent", classes: ["SoftwareApplication"] },
];

/**
 * The classes that Caliper 1.1 deprecated, which the readers do not take: the `OutcomeEvent` that the `GradeEvent` replaced and the
 * `ReadingEvent`, and the `Reading` and four Epub entities that `Document`, `Chapter` and `Page` replaced. The model has none of
 * them, so a document of any version that uses one is refused.
 */
export const DEPRECATED_IN_1_1 = {
  events: ["OutcomeEvent", "ReadingEvent"],
  entities: ["EpubChapter", "EpubPart", "EpubSubChapter", "EpubVolume", "Reading"],
} as const;

/**
 * Lists the properties that a class has in Caliper 1.2 and lacks in 1.1.
 *
 * @param type - The term of an event or an entity.
 * @returns The names of the properties; none for a class that 1.2 added no property to.
 */
export function propertiesNotIn1p1(type: string): readonly string[] {
  return ADDED_IN_1_2.filter(({ classes }) => classes.some((member) => member === type)).map(
    ({ property }) => property,
  );
}
