import type { AccessForm, Synchronicity } from "../internal.js";
import type { Entity, Ref } from "./entity.js";
import type { Library } from "./people.js";
import type { AnyCourseOffering } from "./ranges.js";
import type { LearningObjective } from "./resources.js";

/** An activity that library staff organize or lead, or that is held in a library space (Library Use Profile 5.2). */
export interface LibraryActivity extends Entity<"LibraryActivity"> {
  /** What kind of activity it is, such as reference, instruction, outreach or exhibit. */
  readonly activityType?: string;
  /** How the interaction took place, such as in person, chat or appointment. */
  readonly interactionMode?: string;
  /** How the activity was meant to be consumed. */
  readonly synchronicity?: Synchronicity;
  /** The library or library space in which the activity took place. */
  readonly location?: Ref<Library | LibrarySpace>;
  /** When the activity was scheduled, as `YYYY-MM-DDTHH:mm:ss.SSSZ` in UTC. */
  readonly scheduledTime?: string;
  /** When the activity actually took place, in the same form. */
  readonly actualTime?: string;
  /** How long the activity lasted, as an ISO 8601 duration. */
  readonly duration?: string;
  /** The course offering or section that the activity is for. */
  readonly forCourse?: Ref<AnyCourseOffering>;
  /** A readable name of the period in which the activity occurs. */
  readonly academicSession?: string;
  /** How an exhibit was presented, such as in person, online or traveling. */
  readonly exhibitMode?: string;
  /** The category by which the interaction is reported externally. */
  readonly reportingCategory?: string;
}

/** A resource that a library makes available (Library Use Profile 5.3). */
export interface LibraryResource extends Entity<"LibraryResource"> {
  /** Whether the resource is reached in person or online. */
  readonly physicalOrDigital?: AccessForm;
  /** The value of the resource's MARC 008 data elements. */
  readonly marc008?: string;
  /** What kind of resource it is, such as a database, a journal or a book. */
  readonly resourceType?: string;
  /** What a learner should comprehend or do after engaging with the resource. */
  readonly learningObjectives?: readonly Ref<LearningObjective>[];
}

/** A space that is used for library services, permanently or for a time (Library Use Profile 5.4). */
export interface LibrarySpace extends Entity<"LibrarySpace"> {
  /** The name of the building that holds the space. */
  readonly buildingName?: string;
  /** The number of the building that holds the space. */
  readonly buildingNumber?: string;
  /** The number of the room. */
  readonly roomNumber?: string;
  /** The floor of the space. */
  readonly floor?: string;
  /** Where the interaction happened, such as the circulation desk or the reference desk. */
  readonly servicePoint?: string;
  /** The library that the space belongs to. */
  readonly isPartOf?: Ref<Library>;
}
