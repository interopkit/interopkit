import type { LanguageMap } from "../model/index.js";
import type { Concept } from "./concepts.js";
import type { Pattern } from "./patterns.js";
import type { StatementTemplate } from "./templates.js";

/** The JSON-LD context of a profile, which its `@context` is or holds. */
export const PROFILE_CONTEXT = "https://w3id.org/xapi/profiles/context";

/** The JSON-LD context of the Activity Definition of an Activity concept, which its `@context` is or holds. */
export const ACTIVITY_CONTEXT = "https://w3id.org/xapi/profiles/activity-context";

/** The canonical URI of xAPI Profiles 1.0, the `conformsTo` of a profile that follows it. */
export const PROFILES_SPECIFICATION = "https://w3id.org/xapi/profiles#1.0";

/**
 * The key of the context extension that tells apart the occurrences of the primary Patterns of several profiles that the
 * Statements of one registration follow.
 */
export const SUBREGISTRATION_EXTENSION = "https://w3id.org/xapi/profiles/extensions/subregistration";

/** One version of a profile: its IRI, the versions it revises, and when it was made. */
export interface ProfileVersion {
  /** The IRI of the version, which differs from the IRI of the profile and of every other version. */
  readonly id: string;
  /** The IRIs of the versions that this one revises, usually one; those of other profiles when it subsumes them. */
  readonly wasRevisionOf?: readonly string[];
  /** When the version was made, as a Timestamp. */
  readonly generatedAtTime: string;
}

/** The Organization or Person who wrote a profile. */
export interface ProfileAuthor {
  /** Whether the author is an `Organization` or a `Person`. */
  readonly type: "Organization" | "Person";
  /** The name of the organization or the person. */
  readonly name: string;
  /** A URL of the organization or the person. */
  readonly url?: string;
}

/**
 * An xAPI Profile: the concepts, Statement Templates and Patterns that implement xAPI for one use, with its metadata and its
 * versions.
 *
 * @remarks
 * A property of a profile object that the specification does not describe is an IRI or a JSON-LD keyword, and the reader
 * carries it as JSON; the types list the properties of the specification.
 *
 * @see {@link https://github.com/adlnet/xapi-profiles/blob/master/xapi-profiles-structure.md | xAPI Profiles 1.0, Part Two}
 */
export interface Profile {
  /** The JSON-LD context: {@link PROFILE_CONTEXT}, or a list that holds it. */
  readonly "@context": string | readonly string[];
  /** The IRI of the profile as a whole, not of a version. */
  readonly id: string;
  /** `Profile`. */
  readonly type: "Profile";
  /** The canonical URI of the version of the specification that the profile follows: {@link PROFILES_SPECIFICATION}. */
  readonly conformsTo: string;
  /** The names of the profile, by language. */
  readonly prefLabel: LanguageMap;
  /** What the profile is for, by language, with any rule for the profile as a whole that the structure cannot express. */
  readonly definition: LanguageMap;
  /** A URL with more about the profile. */
  readonly seeAlso?: string;
  /** Every version of the profile. */
  readonly versions: readonly ProfileVersion[];
  /** Who wrote the profile. */
  readonly author: ProfileAuthor;
  /** The verbs, activity types, attachment usage types, extensions, document resources and Activities it defines. */
  readonly concepts?: readonly Concept[];
  /** How a Statement that follows the profile is formed. */
  readonly templates?: readonly StatementTemplate[];
  /** How the Statements of a registration that follow the profile follow one another. */
  readonly patterns?: readonly Pattern[];
}
