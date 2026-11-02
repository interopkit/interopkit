import type { LtiMessageType } from "../internal.js";
import type { Entity, Ref } from "./entity.js";
import type { CaliperEntity } from "./entity-map.js";
import type { AnyAgent, AnyDigitalResource } from "./ranges.js";

/** A statement of what a learner should know or be able to do after a period of learning (Caliper 1.2 B.27). */
export interface LearningObjective extends Entity<"LearningObjective"> {}

/**
 * Digital content (Caliper 1.2 B.18). A sender uses the generic type only when no subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface DigitalResource<TType extends string = "DigitalResource"> extends Entity<TType> {
  /** The entity that includes the resource as a part, such as the course section of a forum or the document of a chapter. */
  readonly isPartOf?: Ref<CaliperEntity>;
  /** The name of the resource in a file system. */
  readonly storageName?: string;
  /** The agents responsible for bringing the resource into being, typically persons. */
  readonly creators?: readonly Ref<AnyAgent>[];
  /** The IANA media type of the resource's file format. */
  readonly mediaType?: string;
  /** Tags or labels that identify the resource. */
  readonly keywords?: readonly string[];
  /** What a learner should comprehend or do after engaging with the resource. */
  readonly learningObjectives?: readonly Ref<LearningObjective>[];
  /** When the resource was published, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly datePublished?: string;
  /** The current form or version of the resource. */
  readonly version?: string;
}

/**
 * Digital content that belongs to an assignment, graded or not (Caliper 1.2 B.7).
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface AssignableDigitalResource<TType extends string = "AssignableDigitalResource">
  extends DigitalResource<TType> {
  /** When the resource was or is to be activated, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly dateToActivate?: string;
  /** When the resource is to be shown to learners, in the same form. */
  readonly dateToShow?: string;
  /** When the resource can be started, in the same form. */
  readonly dateToStartOn?: string;
  /** When the resource is to be submitted for evaluation, in the same form. */
  readonly dateToSubmit?: string;
  /** The number of attempts that are permitted. */
  readonly maxAttempts?: number;
  /** The number of submissions that are permitted. */
  readonly maxSubmits?: number;
  /** The greatest score that is permitted. */
  readonly maxScore?: number;
}

/** A major division of a piece of digital content (Caliper 1.2 B.11). */
export interface Chapter extends DigitalResource<"Chapter"> {}

/** Textual content (Caliper 1.2 B.20). */
export interface Document extends DigitalResource<"Document"> {}

/** A part, portion or segment of a digital resource (Caliper 1.2 B.23). */
export interface Frame extends DigitalResource<"Frame"> {
  /** The position of the frame, counted from 0. */
  readonly index?: number;
}

/** A resource that is reached through an LTI request message (Caliper 1.2 B.30). */
export interface LtiLink extends DigitalResource<"LtiLink"> {
  /** The LTI message type by which the resource was reached. */
  readonly messageType?: LtiMessageType;
}

/** The current playback position in an audio or video object (Caliper 1.2 B.32). */
export interface MediaLocation extends DigitalResource<"MediaLocation"> {
  /** The position measured from the start of the media, as an ISO 8601 duration. */
  readonly currentTime?: string;
}

/**
 * A piece of media content (Caliper 1.2 B.33). A sender uses the generic type only when no subtype fits.
 *
 * @typeParam TType - The term of the entity's type; a subtype fixes it.
 */
export interface MediaObject<TType extends string = "MediaObject"> extends DigitalResource<TType> {
  /** The time the media takes at normal speed, as an ISO 8601 duration. */
  readonly duration?: string;
}

/** An audio or sound file (Caliper 1.2 B.9). */
export interface AudioObject extends MediaObject<"AudioObject"> {
  /** The current volume. */
  readonly volumeLevel?: string;
  /** The lowest volume that is permitted. */
  readonly volumeMin?: string;
  /** The highest volume that is permitted. */
  readonly volumeMax?: string;
  /** Whether the audio is muted. */
  readonly muted?: boolean;
}

/** An image file (Caliper 1.2 B.26). */
export interface ImageObject extends MediaObject<"ImageObject"> {}

/** A visual recording in digital form (Caliper 1.2 B.68). */
export interface VideoObject extends MediaObject<"VideoObject"> {}

/** A written message sent to a recipient (Caliper 1.2 B.35). */
export interface Message extends DigitalResource<"Message"> {
  /** The message that this one answers. */
  readonly replyTo?: Ref<Message>;
  /** The body of the message as plain text. */
  readonly body?: string;
  /** The digital resources attached to the message. */
  readonly attachments?: readonly Ref<AnyDigitalResource>[];
}

/** An item of paginated content (Caliper 1.2 B.45). */
export interface Page extends DigitalResource<"Page"> {}

/** A document of markup that suits display in a web browser (Caliper 1.2 B.69). */
export interface WebPage extends DigitalResource<"WebPage"> {}

/** A URL that may be a step of a user interface or the address of a service, and not a digital resource (Caliper 1.2 B.29). */
export interface Link extends Entity<"Link"> {}
