import * as v from "valibot";
import { AGENT_TYPES, DIGITAL_RESOURCE_TYPES, METRICS } from "../model/index.js";
import { entityEntries, entityRecord } from "./entity-record.js";
import { count, decimal, duration, flag, term, text, texts, time } from "./primitives.js";
import type { RangeFactory } from "./range.js";
import { resourceEntries } from "./resource-entries.js";

/**
 * Makes the schemas of the assessments, the attempts, the responses and the scores: what a person does with an assessment and
 * what comes of it.
 *
 * @param to - Makes the schema of a range of entities.
 */
export function assessmentSchemas(to: RangeFactory) {
  const base = entityEntries(to);
  const { assignable } = resourceEntries(to);
  const response = {
    ...base,
    attempt: v.optional(to(["Attempt"])),
    startedAtTime: v.optional(time),
    endedAtTime: v.optional(time),
    duration: v.optional(duration),
  };
  const scored = {
    ...base,
    attempt: v.optional(to(["Attempt"])),
    scoredBy: v.optional(to(AGENT_TYPES)),
    comment: v.optional(text),
  };
  return {
    Assessment: entityRecord("Assessment", { ...assignable, items: v.optional(v.array(to(["AssessmentItem"]))) }),
    AssessmentItem: entityRecord("AssessmentItem", { ...assignable, isTimeDependent: v.optional(flag) }),
    Attempt: entityRecord("Attempt", {
      ...base,
      isPartOf: v.optional(to(["Attempt"])),
      assignee: v.optional(to(["Person"])),
      assignable: v.optional(to(DIGITAL_RESOURCE_TYPES)),
      count: v.optional(count),
      startedAtTime: v.optional(time),
      endedAtTime: v.optional(time),
      duration: v.optional(duration),
    }),
    Response: entityRecord("Response", response),
    DateTimeResponse: entityRecord("DateTimeResponse", { ...response, dateTimeSelected: v.optional(time) }),
    FillinBlankResponse: entityRecord("FillinBlankResponse", { ...response, values: v.optional(texts) }),
    MultipleChoiceResponse: entityRecord("MultipleChoiceResponse", { ...response, value: v.optional(text) }),
    MultipleResponseResponse: entityRecord("MultipleResponseResponse", { ...response, values: v.optional(texts) }),
    MultiselectResponse: entityRecord("MultiselectResponse", { ...response, selections: v.optional(texts) }),
    OpenEndedResponse: entityRecord("OpenEndedResponse", { ...response, value: v.optional(text) }),
    RatingScaleResponse: entityRecord("RatingScaleResponse", { ...response, selections: v.optional(texts) }),
    SelectTextResponse: entityRecord("SelectTextResponse", { ...response, values: v.optional(texts) }),
    TrueFalseResponse: entityRecord("TrueFalseResponse", { ...response, value: v.optional(text) }),
    Result: entityRecord("Result", {
      ...scored,
      maxResultScore: v.optional(decimal),
      resultScore: v.optional(decimal),
    }),
    Score: entityRecord("Score", { ...scored, maxScore: v.optional(decimal), scoreGiven: v.optional(decimal) }),
    AggregateMeasure: entityRecord("AggregateMeasure", {
      ...base,
      metricValue: decimal,
      maxMetricValue: v.optional(decimal),
      metric: term(METRICS, "a metric"),
      startedAtTime: v.optional(time),
      endedAtTime: v.optional(time),
    }),
  };
}
