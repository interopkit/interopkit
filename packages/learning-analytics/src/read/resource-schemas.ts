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
    LearningObjective: entityRecord(to, "LearningObjective", base),
    Link: entityRecord(to, "Link", base),
    DigitalResource: entityRecord(to, "DigitalResource", resource),
    AssignableDigitalResource: entityRecord(to, "AssignableDigitalResource", assignable),
    Chapter: entityRecord(to, "Chapter", resource),
    Document: entityRecord(to, "Document", resource),
    Frame: entityRecord(to, "Frame", { ...resource, index: v.optional(position) }),
    LtiLink: entityRecord(to, "LtiLink", {
      ...resource,
      messageType: v.optional(term(LTI_MESSAGE_TYPES, "an LTI message type")),
    }),
    MediaLocation: entityRecord(to, "MediaLocation", { ...resource, currentTime: v.optional(duration) }),
    MediaObject: entityRecord(to, "MediaObject", media),
    AudioObject: entityRecord(to, "AudioObject", {
      ...media,
      volumeLevel: v.optional(text),
      volumeMin: v.optional(text),
      volumeMax: v.optional(text),
      muted: v.optional(flag),
    }),
    ImageObject: entityRecord(to, "ImageObject", media),
    VideoObject: entityRecord(to, "VideoObject", media),
    Message: entityRecord(to, "Message", {
      ...resource,
      replyTo: v.optional(to(["Message"])),
      body: v.optional(text),
      attachments: v.optional(v.array(to(DIGITAL_RESOURCE_TYPES))),
    }),
    Page: entityRecord(to, "Page", resource),
    WebPage: entityRecord(to, "WebPage", resource),
    Collection: entityRecord(to, "Collection", { ...base, items: v.optional(v.array(to(ENTITY_TYPES))) }),
    AggregateMeasureCollection: entityRecord(to, "AggregateMeasureCollection", {
      ...base,
      items: v.optional(v.array(to(["AggregateMeasure"]))),
    }),
    DigitalResourceCollection: entityRecord(to, "DigitalResourceCollection", { ...resource, ...collection }),
    Forum: entityRecord(to, "Forum", { ...resource, items: v.optional(v.array(to(["Thread"]))) }),
    Thread: entityRecord(to, "Thread", { ...resource, items: v.optional(v.array(to(["Message"]))) }),
    Questionnaire: entityRecord(to, "Questionnaire", { ...resource, items: v.array(to(["QuestionnaireItem"])) }),
    Survey: entityRecord(to, "Survey", { ...base, items: v.optional(v.array(to(["Questionnaire"]))) }),
  };
}
