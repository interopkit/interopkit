import type { Concept } from "./concepts.js";
import type { Pattern } from "./patterns.js";
import type { Profile } from "./profile.js";
import type { StatementTemplate } from "./templates.js";

/** What the ids of a profile and of the other profiles that it uses name, for the rules between objects. */
export interface ProfileReferences {
  /** The concepts of the profile, by id; the first of a repeated id. */
  readonly concepts: ReadonlyMap<string, Concept>;
  /** The Statement Templates of the profile, by id. */
  readonly templates: ReadonlyMap<string, StatementTemplate>;
  /** The Patterns of the profile, by id. */
  readonly patterns: ReadonlyMap<string, Pattern>;
  /** The concepts of the other profiles, by id. */
  readonly otherConcepts: ReadonlyMap<string, Concept>;
  /** The Statement Templates of the other profiles, by id. */
  readonly otherTemplates: ReadonlyMap<string, StatementTemplate>;
  /** The Patterns of the other profiles, by id. */
  readonly otherPatterns: ReadonlyMap<string, Pattern>;
  /** The other profiles, by the id of each of their versions. */
  readonly otherVersions: ReadonlyMap<string, Profile>;
}

/** Adds objects to a map by id, keeping the first of an id. */
function addById<TObject extends { readonly id: string }>(
  map: Map<string, TObject>,
  objects: readonly TObject[] | undefined,
): void {
  for (const object of objects ?? []) if (!map.has(object.id)) map.set(object.id, object);
}

/** Collects what the ids of a profile and of other profiles name. */
export function collectReferences(profile: Profile, others: readonly Profile[]): ProfileReferences {
  const concepts = new Map<string, Concept>();
  const templates = new Map<string, StatementTemplate>();
  const patterns = new Map<string, Pattern>();
  addById(concepts, profile.concepts);
  addById(templates, profile.templates);
  addById(patterns, profile.patterns);
  const otherConcepts = new Map<string, Concept>();
  const otherTemplates = new Map<string, StatementTemplate>();
  const otherPatterns = new Map<string, Pattern>();
  const otherVersions = new Map<string, Profile>();
  for (const other of others) {
    addById(otherConcepts, other.concepts);
    addById(otherTemplates, other.templates);
    addById(otherPatterns, other.patterns);
    for (const version of other.versions) if (!otherVersions.has(version.id)) otherVersions.set(version.id, other);
  }
  return { concepts, templates, patterns, otherConcepts, otherTemplates, otherPatterns, otherVersions };
}

/** Returns the concept that an id names in the profile or in the other profiles. */
export function findConcept(references: ProfileReferences, id: string): Concept | undefined {
  return references.concepts.get(id) ?? references.otherConcepts.get(id);
}
