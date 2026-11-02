import * as v from "valibot";
import { ENTITY_TYPES, QUESTION_TYPES, SCALE_TYPES } from "../model/index.js";
import { entityEntries, entityRecord } from "./entity-record.js";
import { count, decimal, flag, text, texts, time } from "./primitives.js";
import type { RangeFactory } from "./range.js";
import { resourceEntries } from "./resource-entries.js";

/**
 * Makes the schemas of the questions, the questionnaire items, the survey invitations, the ratings, the comments and the
 * scales.
 *
 * @param to - Makes the schema of a range of entities.
 */
export function questionnaireSchemas(to: RangeFactory) {
  const base = entityEntries(to);
  const { resource } = resourceEntries(to);
  const question = { ...resource, questionPosed: v.optional(text) };
  const choices = {
    scalePoints: v.optional(count),
    itemLabels: v.optional(texts),
    itemValues: v.optional(texts),
  };
  return {
    Question: entityRecord(to, "Question", question),
    DateTimeQuestion: entityRecord(to, "DateTimeQuestion", {
      ...question,
      minDateTime: v.optional(time),
      minLabel: v.optional(text),
      maxDateTime: v.optional(time),
      maxLabel: v.optional(text),
    }),
    MultiselectQuestion: entityRecord(to, "MultiselectQuestion", {
      ...question,
      points: v.optional(count),
      itemLabels: v.optional(texts),
      itemValues: v.optional(texts),
    }),
    OpenEndedQuestion: entityRecord(to, "OpenEndedQuestion", question),
    RatingScaleQuestion: entityRecord(to, "RatingScaleQuestion", { ...question, scale: v.optional(to(SCALE_TYPES)) }),
    QuestionnaireItem: entityRecord(to, "QuestionnaireItem", {
      ...resource,
      question: v.optional(to(QUESTION_TYPES)),
      categories: v.optional(texts),
      weight: v.optional(decimal),
    }),
    SurveyInvitation: entityRecord(to, "SurveyInvitation", {
      ...resource,
      rater: v.optional(to(["Person"])),
      survey: v.optional(to(["Survey"])),
      sentCount: v.optional(count),
      dateSent: v.optional(time),
    }),
    Rating: entityRecord(to, "Rating", {
      ...base,
      rater: v.optional(to(["Person"])),
      rated: v.optional(to(ENTITY_TYPES)),
      question: v.optional(to(QUESTION_TYPES)),
      selections: v.optional(texts),
      ratingComment: v.optional(to(["Comment"])),
    }),
    Comment: entityRecord(to, "Comment", {
      ...base,
      commenter: v.optional(to(["Person"])),
      commentedOn: v.optional(to(ENTITY_TYPES)),
      value: v.optional(text),
    }),
    Scale: entityRecord(to, "Scale", base),
    LikertScale: entityRecord(to, "LikertScale", { ...base, ...choices }),
    MultiselectScale: entityRecord(to, "MultiselectScale", {
      ...base,
      ...choices,
      isOrderedSelection: v.optional(flag),
      minSelections: v.optional(count),
      maxSelections: v.optional(count),
    }),
    NumericScale: entityRecord(to, "NumericScale", {
      ...base,
      minValue: v.optional(decimal),
      minLabel: v.optional(text),
      maxValue: v.optional(decimal),
      maxLabel: v.optional(text),
      step: v.optional(decimal),
    }),
  };
}
