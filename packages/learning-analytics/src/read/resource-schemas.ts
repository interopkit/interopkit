import * as v from "valibot";
import { DIGITAL_RESOURCE_TYPES, ENTITY_TYPES, LTI_MESSAGE_TYPES } from "../model/index.js";
import { entityEntries, entityRecord } from "./entity-record.js";
import { duration, flag, position, term, text } from "./primitives.js";
import type { RangeFactory } from "./range.js";
import { resourceEntries } from "./resource-entries.js";

/**
 * Makes the schemas of the digital resources and the collections of entities.
 *
 * @param to - Makes the schema of a range of entities.
 */
export function resourceSchemas(to: RangeFactory) {
  const base = entityEntries(to);
  const { resource, assignable } = resourceEntries(to);
  const media = { ...resource, duration: v.optional(duration) };
  const collection = { ...base, items: v.optional(v.array(to(DIGITAL_RESOURCE_TYPES))) };
  return {
    LearningObjective: entityRecord("LearningObjective", base),
    Link: entityRecord("Link", base),
    DigitalResource: entityRecord("DigitalResource", resource),
    AssignableDigitalResource: entityRecord("AssignableDigitalResource", assignable),
    Chapter: entityRecord("Chapter", resource),
    Document: entityRecord("Document", resource),
    Frame: entityRecord("Frame", { ...resource, index: v.optional(position) }),
    LtiLink: entityRecord("LtiLink", {
      ...resource,
      messageType: v.optional(term(LTI_MESSAGE_TYPES, "an LTI message type")),
    }),
    MediaLocation: entityRecord("MediaLocation", { ...resource, currentTime: v.optional(duration) }),
    MediaObject: entityRecord("MediaObject", media),
    AudioObject: entityRecord("AudioObject", {
      ...media,
      volumeLevel: v.optional(text),
      volumeMin: v.optional(text),
      volumeMax: v.optional(text),
      muted: v.optional(flag),
    }),
    ImageObject: entityRecord("ImageObject", media),
    VideoObject: entityRecord("VideoObject", media),
    Message: entityRecord("Message", {
      ...resource,
      replyTo: v.optional(to(["Message"])),
      body: v.optional(text),
      attachments: v.optional(v.array(to(DIGITAL_RESOURCE_TYPES))),
    }),
    Page: entityRecord("Page", resource),
    WebPage: entityRecord("WebPage", resource),
    Collection: entityRecord("Collection", { ...base, items: v.optional(v.array(to(ENTITY_TYPES))) }),
    AggregateMeasureCollection: entityRecord("AggregateMeasureCollection", {
      ...base,
      items: v.optional(v.array(to(["AggregateMeasure"]))),
    }),
    DigitalResourceCollection: entityRecord("DigitalResourceCollection", { ...resource, ...collection }),
    Forum: entityRecord("Forum", { ...resource, items: v.optional(v.array(to(["Thread"]))) }),
    Thread: entityRecord("Thread", { ...resource, items: v.optional(v.array(to(["Message"]))) }),
    Questionnaire: entityRecord("Questionnaire", { ...resource, items: v.array(to(["QuestionnaireItem"])) }),
    Survey: entityRecord("Survey", { ...base, items: v.optional(v.array(to(["Questionnaire"]))) }),
  };
}
