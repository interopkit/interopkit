import type { CaliperFinding } from "./finding.js";
import { findingSink } from "./finding.js";
import { inspectEvent } from "./inspect.js";
import { readMaxFindings, type ValidateOptions } from "./options.js";

/**
 * Judges an event: lists what is wrong with its shape, and, when the shape is right, where it departs from the rules of its
 * profile, as findings with their severity.
 *
 * @remarks
 * The shape is that of `readEvent`. The profile is the `profile` of the event, or every profile that has its type when it names
 * none. The tables of section 3 of Caliper 1.2 and of the Library Use Profile say which actions, actors and objects an event of
 * a profile allows: what they do not allow and the certification guide does not either is an error, and what only the guide
 * allows is a warning. The recommendations that follow are warnings: the governing profile, the generated entity that the profile
 * advises, the classes of the generated entity and of the target, the properties that an attempt, a score, a result and the
 * session of a timeout should define, and the generic `Event` for an interaction that a profile models. A `MediaLocation` that a
 * media event gives as its target must have a `currentTime`, and its absence is an error. An entity given as an IRI is not
 * judged, since it names no class. The input is not changed. The list stops at `maxFindings` and ends with a finding whose rule is
 * `findings-stopped`.
 *
 * @param value - The event: parsed text, or an event in the model.
 * @param options - The most findings to list.
 * @returns The findings, errors and warnings. An empty list means that the event follows every rule that this function knows.
 * @throws `DataError` when the options are not an object with a `maxFindings` that is a positive integer.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#profiles-0 | Caliper Analytics 1.2, Profiles}
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2/cert | Caliper Analytics 1.2 Conformance and Certification Guide}
 */
export function validateEvent(value: unknown, options?: ValidateOptions): CaliperFinding[] {
  const sink = findingSink(readMaxFindings(options));
  inspectEvent(value, sink);
  return sink.list();
}
