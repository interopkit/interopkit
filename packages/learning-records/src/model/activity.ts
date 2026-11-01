import type { Extensions } from "./json.js";
import type { LanguageMap } from "./language-map.js";
import type { InteractionType } from "./terms.js";

/** One choice, step, source or target of an interaction (4.2.2.3). */
export interface InteractionComponent {
  /** Identifies the component within its list. It should not have white space. */
  readonly id: string;
  /** A description of the component, such as the text of a choice. */
  readonly description?: LanguageMap;
}

/**
 * The metadata of an Activity (4.2.2.3). The last seven properties belong to an interaction: `interactionType` is required
 * when any of them is present, and `interactionType` decides which lists of components it may have.
 */
export interface ActivityDefinition {
  /** The human-readable name of the Activity. */
  readonly name?: LanguageMap;
  /** A description of the Activity. */
  readonly description?: LanguageMap;
  /** The type of the Activity, an IRI. */
  readonly type?: string;
  /** Resolves to a document with human-readable information about the Activity, an IRL. */
  readonly moreInfo?: string;
  /** A map of other properties, whose keys are IRIs. */
  readonly extensions?: Extensions;
  /** The type of the interaction. */
  readonly interactionType?: InteractionType;
  /** The patterns of a correct response; a response is correct when it matches any of them. Their form depends on `interactionType`. */
  readonly correctResponsesPattern?: readonly string[];
  /** The options of a `choice` or `sequencing` interaction. */
  readonly choices?: readonly InteractionComponent[];
  /** The options on the scale of a `likert` interaction. */
  readonly scale?: readonly InteractionComponent[];
  /** The items of the source set of a `matching` interaction. */
  readonly source?: readonly InteractionComponent[];
  /** The items of the target set of a `matching` interaction. */
  readonly target?: readonly InteractionComponent[];
  /** The elements of a `performance` interaction. */
  readonly steps?: readonly InteractionComponent[];
}

/** An Activity, the thing a Statement is about or a context of it (4.2.2.3): a unit that a learner can do. */
export interface Activity {
  /** The type of the object: `Activity`, or absent. */
  readonly objectType?: "Activity";
  /** An identifier of the Activity, an IRI. */
  readonly id: string;
  /** The metadata of the Activity. */
  readonly definition?: ActivityDefinition;
}
