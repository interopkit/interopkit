/**
 * What the host knows of one candidate's attempt at an assessment. It is the host's own record, not a Caliper entity: the
 * sensor turns it into events.
 */
export interface AttemptRecord {
  /** The host's identifier of the attempt. It is part of every event identifier, so it never changes. */
  readonly id: string;
  /** The IRI of the candidate: an opaque identifier of the host, never an email address or a name. */
  readonly learner: string;
  /** The IRI of the assessment. */
  readonly assessment: string;
  /** When the attempt started, in epoch milliseconds. */
  readonly startedAt: number;
  /**
   * When the attempt was submitted, in epoch milliseconds.
   *
   * @defaultValue none, while the attempt is open
   */
  readonly submittedAt?: number;
  /**
   * The grade of the attempt.
   *
   * @defaultValue none, until a scorer has graded it
   */
  readonly grade?: {
    /** The score awarded. */
    readonly given: number;
    /** The greatest score possible. */
    readonly maximum: number;
    /** The IRI of the application or person that scored. */
    readonly scoredBy: string;
    /** When the score was given, in epoch milliseconds. */
    readonly at: number;
  };
}
