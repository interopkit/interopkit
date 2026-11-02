import type { AttemptStatus, ControlStatus } from "@interopkit/tool-integration";
import type { AssessmentControl } from "@interopkit/tool-integration/platform";

/** The state of one attempt that the platform keeps: its status and the extra time of the candidate. */
interface Attempt {
  /** The proctoring tool that the attempt was sent to; another tool cannot control it. */
  readonly clientId: string;
  status: AttemptStatus;
  extraTime?: number;
}

/** The attempts of the platform's assessments in memory, and the store over them. */
export interface Attempts {
  /** The store behind the Assessment Control Service. */
  readonly store: AssessmentControl;
  /** Starts an attempt of a user at an assessment, as the platform does when the Start Assessment message arrives. */
  start(clientId: string, subject: string, resourceLinkId: string, attemptNumber: number): void;
  /** Returns the status of an attempt. */
  statusOf(subject: string, resourceLinkId: string, attemptNumber: number): ControlStatus | undefined;
}

/** The status that each action leads to, from the statuses it applies to; any other leaves the attempt as it is. */
const NEXT: Readonly<Record<string, Partial<Record<AttemptStatus, AttemptStatus>>>> = {
  pause: { running: "paused" },
  resume: { paused: "running" },
  terminate: { running: "terminated", paused: "terminated" },
};

/**
 * Creates the attempts in memory. A real host maps an action to its delivery, such as pausing the clock of the session, and keeps
 * a flag for its reviewers.
 */
export function createAttempts(): Attempts {
  const attempts = new Map<string, Attempt>();
  const keyOf = (subject: string, resourceLinkId: string, attemptNumber: number) =>
    `${subject} ${resourceLinkId} ${attemptNumber}`;
  const statusOf = (attempt: Attempt): ControlStatus =>
    attempt.extraTime === undefined
      ? { status: attempt.status }
      : { status: attempt.status, extraTime: attempt.extraTime };
  return {
    store: {
      async control(caller, request) {
        const attempt = attempts.get(keyOf(request.user.subject, request.resourceLink.id, request.attemptNumber));
        // An attempt that the caller does not proctor is as unknown as one that does not exist: the platform answers 404.
        if (attempt === undefined || attempt.clientId !== caller.clientId) return undefined;
        attempt.status = NEXT[request.action]?.[attempt.status] ?? attempt.status;
        if (request.extraTime !== undefined) attempt.extraTime = request.extraTime;
        return statusOf(attempt);
      },
    },
    start(clientId, subject, resourceLinkId, attemptNumber) {
      attempts.set(keyOf(subject, resourceLinkId, attemptNumber), { clientId, status: "running" });
    },
    statusOf(subject, resourceLinkId, attemptNumber) {
      const attempt = attempts.get(keyOf(subject, resourceLinkId, attemptNumber));
      return attempt === undefined ? undefined : statusOf(attempt);
    },
  };
}
