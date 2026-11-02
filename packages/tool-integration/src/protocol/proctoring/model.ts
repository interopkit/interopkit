import type { ResourceLink } from "../claims/index.js";

/**
 * The actions of an Assessment Control request (Proctoring Services 1.0 section 5.1.4).
 *
 * @see {@link https://www.imsglobal.org/spec/proctoring/v1p0#action-parameter | Proctoring Services 1.0, action}
 */
export const CONTROL_ACTIONS = ["pause", "resume", "terminate", "update", "flag"] as const;

/** An action of an Assessment Control request. */
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

/** The statuses of an attempt that an Assessment Control answer reports (Proctoring Services 1.0 section 5.2.1). */
export const ATTEMPT_STATUSES = ["none", "running", "paused", "terminated", "complete"] as const;

/** The status of an attempt. */
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/** The request that a proctoring tool sends to the Assessment Control Service (`application/vnd.ims.lti-ap.v1.control+json`). */
export interface ControlRequest {
  /** The candidate, as the Start Proctoring message named them. */
  readonly user: {
    /** The issuer of the platform that issued the identity. */
    readonly issuer: string;
    /** The `sub` of the candidate. */
    readonly subject: string;
  };
  /** The assessment; only `id` is required. */
  readonly resourceLink: ResourceLink;
  /** The attempt of the candidate, the first being 1. */
  readonly attemptNumber: number;
  /** What to do with the attempt. */
  readonly action: ControlAction;
  /** When the incident happened, which may differ from the time of the request. */
  readonly incidentTime?: string;
  /** The total extra time granted, in minutes. */
  readonly extraTime?: number;
  /** How severe the incident was, from 0 to 1. */
  readonly incidentSeverity?: number;
  /** A code for the reason, which the proctoring tool defines. */
  readonly reasonCode?: string;
  /** The reason in words. */
  readonly reasonMessage?: string;
}

/** What the Assessment Control Service answers: the status of the attempt. */
export interface ControlStatus {
  /** The status of the attempt. */
  readonly status: AttemptStatus;
  /** The total extra time given, in minutes. */
  readonly extraTime?: number;
}
