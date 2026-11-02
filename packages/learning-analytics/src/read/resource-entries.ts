import * as v from "valibot";
import { AGENT_TYPES, ENTITY_TYPES } from "../model/index.js";
import { entityEntries } from "./entity-record.js";
import { count, decimal, text, texts, time } from "./primitives.js";
import type { RangeFactory } from "./range.js";

/**
 * Makes the entries of the digital resources, which the classes of several families extend: those of a digital resource, and
 * those of a resource that belongs to an assignment.
 *
 * @param to - Makes the schema of a range of entities.
 */
export function resourceEntries(to: RangeFactory) {
  const resource = {
    ...entityEntries(to),
    isPartOf: v.optional(to(ENTITY_TYPES)),
    storageName: v.optional(text),
    creators: v.optional(v.array(to(AGENT_TYPES))),
    mediaType: v.optional(text),
    keywords: v.optional(texts),
    learningObjectives: v.optional(v.array(to(["LearningObjective"]))),
    datePublished: v.optional(time),
    version: v.optional(text),
  };
  const assignable = {
    ...resource,
    dateToActivate: v.optional(time),
    dateToShow: v.optional(time),
    dateToStartOn: v.optional(time),
    dateToSubmit: v.optional(time),
    maxAttempts: v.optional(count),
    maxSubmits: v.optional(count),
    maxScore: v.optional(decimal),
  };
  return { resource, assignable };
}
