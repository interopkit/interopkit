import { buildEvent, type CaliperEvent, caliperTime, mintUrn } from "@interopkit/learning-analytics";
import type { AttemptRecord } from "./attempt.ts";

/**
 * Returns the Caliper events that an attempt has so far: Started, then Submitted once it is submitted, then Graded once it
 * has a grade.
 *
 * The identifier of an event is the URN of its kind and the attempt, so reporting an attempt again gives the same identifiers
 * and an endpoint that keeps an event once by its `id` holds each one once. The events carry no response and no answer
 * key, and the actor is the opaque IRI of the learner.
 *
 * @param attempt - The record of the host.
 * @param edApp - The IRI of the application that delivers the assessment.
 */
export function attemptEvents(attempt: AttemptRecord, edApp: string): readonly CaliperEvent[] {
  const attemptId = mintUrn(["attempt", attempt.id]);
  const person = { id: attempt.learner, type: "Person" } as const;
  const assessment = { id: attempt.assessment, type: "Assessment" } as const;
  const started = caliperTime(attempt.startedAt, "The start of the attempt");
  const events: CaliperEvent[] = [
    buildEvent({
      id: mintUrn(["event", attempt.id, "started"]),
      type: "AssessmentEvent",
      profile: "AssessmentProfile",
      actor: person,
      action: "Started",
      object: assessment,
      generated: {
        id: attemptId,
        type: "Attempt",
        assignee: attempt.learner,
        assignable: attempt.assessment,
        startedAtTime: started,
      },
      eventTime: started,
      edApp,
    }),
  ];
  if (attempt.submittedAt !== undefined) {
    const submitted = caliperTime(attempt.submittedAt, "The submission of the attempt");
    events.push(
      buildEvent({
        id: mintUrn(["event", attempt.id, "submitted"]),
        type: "AssessmentEvent",
        profile: "AssessmentProfile",
        actor: person,
        action: "Submitted",
        object: assessment,
        generated: {
          id: attemptId,
          type: "Attempt",
          assignee: attempt.learner,
          assignable: attempt.assessment,
          startedAtTime: started,
          endedAtTime: submitted,
        },
        eventTime: submitted,
        edApp,
      }),
    );
  }
  if (attempt.grade !== undefined) {
    const { given, maximum, scoredBy, at } = attempt.grade;
    const graded = caliperTime(at, "The time of the grade");
    events.push(
      buildEvent({
        id: mintUrn(["event", attempt.id, "graded"]),
        type: "GradeEvent",
        profile: "GradingProfile",
        actor: { id: scoredBy, type: "SoftwareApplication" },
        action: "Graded",
        object: { id: attemptId, type: "Attempt", assignee: attempt.learner, assignable: attempt.assessment },
        generated: {
          id: mintUrn(["score", attempt.id]),
          type: "Score",
          attempt: attemptId,
          maxScore: maximum,
          scoreGiven: given,
          scoredBy,
          dateCreated: graded,
        },
        eventTime: graded,
        edApp,
      }),
    );
  }
  return events;
}
