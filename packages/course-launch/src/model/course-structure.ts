import type { LaunchMethod, MoveOn } from "./vocabularies.js";

/**
 * A text in one language: a `langstring` of a title or a description.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_structure_data_model | cmi5, 13.1 Course Structure Data Model}
 */
export interface LangString {
  /**
   * The language of the text, an `xs:language`.
   *
   * @defaultValue none
   */
  readonly lang?: string;
  /** The text, without the white space that leads or trails it. */
  readonly text: string;
}

/**
 * An element of another namespace than that of cmi5, an extension of a vendor, kept as written so that a writer emits it
 * again.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#vendor_meta_data | cmi5, 13.1.5 Vendor Specific Metadata}
 */
export interface ExtensionElement {
  /** The namespace of the element. */
  readonly namespace: string;
  /** The local name of the element. */
  readonly name: string;
  /**
   * The element as one well-formed piece of XML: its text as the structure wrote it, with a declaration of each namespace
   * that it uses from the elements around it.
   */
  readonly xml: string;
}

/** The course of a course structure: what describes the course as a whole. */
export interface Course {
  /** The IRI that identifies the course. */
  readonly id: string;
  /** The title, in one or more languages. */
  readonly title: readonly LangString[];
  /** The description, in one or more languages. */
  readonly description: readonly LangString[];
  /** The extensions of the course. */
  readonly extensions: readonly ExtensionElement[];
}

/**
 * A learning objective that blocks and assignable units name by its id.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#objective_meta_data | cmi5, 13.1.3 Objective Metadata}
 */
export interface Objective {
  /** The IRI that identifies the objective. */
  readonly id: string;
  /** The title, in one or more languages. */
  readonly title: readonly LangString[];
  /** The description, in one or more languages. */
  readonly description: readonly LangString[];
}

/**
 * An assignable unit: the content that an LMS launches, and what it needs to launch it.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#au_meta_data | cmi5, 13.1.4 AU Metadata}
 */
export interface AssignableUnit {
  /** What the member is. */
  readonly kind: "au";
  /** The IRI that the publisher gave the assignable unit. */
  readonly id: string;
  /** The title, in one or more languages. */
  readonly title: readonly LangString[];
  /** The description, in one or more languages. */
  readonly description: readonly LangString[];
  /** The ids of the objectives that it names. */
  readonly objectives: readonly string[];
  /** The URL of its launch point, fully qualified or relative to the root of its package. */
  readonly url: string;
  /** The window it runs in. */
  readonly launchMethod: LaunchMethod;
  /** What satisfies it. */
  readonly moveOn: MoveOn;
  /**
   * The scaled score, from 0 to 1, at which the learner passes.
   *
   * @defaultValue none
   */
  readonly masteryScore?: number;
  /**
   * The IRI of the type of its activity, which an LMS can show before the first launch.
   *
   * @defaultValue none
   */
  readonly activityType?: string;
  /**
   * The static parameters of its launch, which the LMS hands it in `LMS.LaunchData`.
   *
   * @defaultValue none
   */
  readonly launchParameters?: string;
  /**
   * What the assignable unit reads to decide whether the LMS may use it.
   *
   * @defaultValue none
   */
  readonly entitlementKey?: string;
  /** Its extensions. */
  readonly extensions: readonly ExtensionElement[];
}

/**
 * A block: a group of assignable units and blocks, satisfied when all of them are.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#block_meta_data | cmi5, 13.1.2 Block Metadata}
 */
export interface Block {
  /** What the member is. */
  readonly kind: "block";
  /** The IRI that identifies the block. */
  readonly id: string;
  /** The title, in one or more languages. */
  readonly title: readonly LangString[];
  /** The description, in one or more languages. */
  readonly description: readonly LangString[];
  /** The ids of the objectives that it names. */
  readonly objectives: readonly string[];
  /** Its assignable units and blocks, at least one, in order. */
  readonly children: readonly (AssignableUnit | Block)[];
  /** Its extensions. */
  readonly extensions: readonly ExtensionElement[];
}

/**
 * The course structure of cmi5: the course, its objectives, and its assignable units and blocks in order.
 *
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#course_structure_data_model | cmi5, 13.1 Course Structure Data Model}
 */
export interface CourseStructure {
  /** The course. */
  readonly course: Course;
  /** The objectives that blocks and assignable units name. */
  readonly objectives: readonly Objective[];
  /** The assignable units and blocks of the course, at least one, in order. */
  readonly children: readonly (AssignableUnit | Block)[];
  /** The extensions of the structure as a whole. */
  readonly extensions: readonly ExtensionElement[];
}
