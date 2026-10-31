/**
 * An entity of an event (Caliper 1.2 section 2.2). It always has an `id`, an IRI, and a `type`. The entities that it refers to
 * are named by their IRIs, which Caliper allows for any entity (section 4.3).
 */
export interface CaliperEntity {
  /** The IRI of the entity. */
  readonly id: string;
  /** The term of the entity's type. */
  readonly type: "Person" | "SoftwareApplication" | "Assessment" | "AssessmentItem" | "Attempt" | "Score";
  /** What the entity is called, such as the identifier of an item. */
  readonly name?: string;
  /** The IRI of the assessment that an item belongs to, or of the attempt that an attempt of an item belongs to. */
  readonly isPartOf?: string;
  /** The IRI of the person who made an attempt. */
  readonly assignee?: string;
  /** The IRI of the assessment or item that an attempt is of. */
  readonly assignable?: string;
  /** The time an attempt started, as `YYYY-MM-DDTHH:mm:ss.SSSZ`. */
  readonly startedAtTime?: string;
  /** The time an attempt ended, in the same form. */
  readonly endedAtTime?: string;
  /** The IRI of the attempt that a score is for. */
  readonly attempt?: string;
  /** The greatest score possible. */
  readonly maxScore?: number;
  /** The score awarded. */
  readonly scoreGiven?: number;
  /** The IRI of the agent who scored the attempt. */
  readonly scoredBy?: string;
  /** The time a score was created, in the same form as `startedAtTime`. */
  readonly dateCreated?: string;
}
