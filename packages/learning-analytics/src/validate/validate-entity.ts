import type { CaliperFinding } from "./finding.js";
import { findingSink } from "./finding.js";
import { inspectEntity } from "./inspect.js";
import { readValidateOptions, type ValidateOptions } from "./options.js";

/**
 * Judges an entity describe: lists what is wrong with its shape, and, when the shape is right, the properties that Caliper
 * advises its class to define, as findings with their severity.
 *
 * @remarks
 * The shape is that of `readEntity`. The profiles advise an attempt to define `assignee`, `assignable` and `count`, a score
 * `attempt`, `maxScore` and `scoreGiven`, and a result `attempt`, `maxResultScore` and `resultScore`: a missing one is a warning.
 * The input is not changed. The list stops at `maxFindings` and ends with a finding whose rule is `findings-stopped`.
 *
 * @param value - The entity describe: parsed text, or an entity in the model.
 * @param options - The most findings to list.
 * @returns The findings. An empty list means that the entity follows every rule that this function knows.
 * @throws `DataError` when the options are not an object with a `maxFindings` that is a positive integer.
 * @see {@link https://www.imsglobal.org/spec/caliper/v1p2#profiles-0 | Caliper Analytics 1.2, Profiles}
 */
export function validateEntity(value: unknown, options?: ValidateOptions): CaliperFinding[] {
  const { version, maxFindings } = readValidateOptions(options);
  const sink = findingSink(maxFindings);
  inspectEntity(value, sink, version);
  return sink.list();
}
