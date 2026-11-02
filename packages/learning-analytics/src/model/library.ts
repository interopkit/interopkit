import type { CaliperEntityType, CaliperEventType } from "./terms.js";

/** The terms of the events of the Library Use Profile, whose documents name the context of that profile. */
export const LIBRARY_EVENT_TYPES = [
  "LibraryParticipationEvent",
  "LibraryResourceUseEvent",
  "LibraryUseEvent",
] as const satisfies readonly CaliperEventType[];

/** The terms of the entities of the Library Use Profile, whose documents name the context of that profile. */
export const LIBRARY_ENTITY_TYPES = [
  "Library",
  "LibraryActivity",
  "LibraryResource",
  "LibrarySpace",
] as const satisfies readonly CaliperEntityType[];
