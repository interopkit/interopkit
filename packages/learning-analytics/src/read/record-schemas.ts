import { jsonObjectSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import {
  ACCESS_FORMS,
  AGENT_TYPES,
  COURSE_OFFERING_TYPES,
  DIGITAL_RESOURCE_TYPES,
  ENTITY_TYPES,
  SYNCHRONICITIES,
  SYSTEM_IDENTIFIER_TYPES,
} from "../model/index.js";
import { entityEntries, entityRecord } from "./entity-record.js";
import { count, duration, position, term, text, texts, time } from "./primitives.js";
import type { RangeFactory } from "./range.js";

/**
 * Makes the schemas of the annotations, the search, the identifiers and selectors, and the Library Use Profile.
 *
 * @param to - Makes the schema of a range of entities.
 */
export function recordSchemas(to: RangeFactory) {
  const base = entityEntries(to);
  const annotation = {
    ...base,
    annotator: v.optional(to(["Person"])),
    annotated: v.optional(to(DIGITAL_RESOURCE_TYPES)),
  };
  return {
    Annotation: entityRecord(to, "Annotation", annotation),
    BookmarkAnnotation: entityRecord(to, "BookmarkAnnotation", { ...annotation, bookmarkNotes: v.optional(text) }),
    HighlightAnnotation: entityRecord(to, "HighlightAnnotation", {
      ...annotation,
      selectionText: v.optional(text),
      selection: v.optional(to(["TextPositionSelector"])),
    }),
    SharedAnnotation: entityRecord(to, "SharedAnnotation", {
      ...annotation,
      withAgents: v.optional(v.array(to(AGENT_TYPES))),
    }),
    TagAnnotation: entityRecord(to, "TagAnnotation", { ...annotation, tags: v.optional(texts) }),
    Query: entityRecord(to, "Query", {
      ...base,
      creator: v.optional(to(["Person"])),
      searchTarget: v.optional(to(ENTITY_TYPES)),
      searchTerms: v.optional(text),
    }),
    SearchResponse: entityRecord(to, "SearchResponse", {
      ...base,
      searchProvider: v.optional(to(["SoftwareApplication"])),
      searchTarget: v.optional(to(ENTITY_TYPES)),
      query: v.optional(to(["Query"])),
      searchResultsItemCount: v.optional(count),
    }),
    TextPositionSelector: strictRecord({
      type: v.literal("TextPositionSelector"),
      start: position,
      end: position,
    }),
    SystemIdentifier: strictRecord({
      type: v.literal("SystemIdentifier"),
      identifierType: term(SYSTEM_IDENTIFIER_TYPES, "a type of system identifier"),
      identifier: text,
      source: v.optional(to(["SoftwareApplication"])),
      extensions: v.optional(jsonObjectSchema),
    }),
    LibraryActivity: entityRecord(to, "LibraryActivity", {
      ...base,
      activityType: v.optional(text),
      interactionMode: v.optional(text),
      synchronicity: v.optional(term(SYNCHRONICITIES, "a synchronicity")),
      location: v.optional(to(["Library", "LibrarySpace"])),
      scheduledTime: v.optional(time),
      actualTime: v.optional(time),
      duration: v.optional(duration),
      forCourse: v.optional(to(COURSE_OFFERING_TYPES)),
      academicSession: v.optional(text),
      exhibitMode: v.optional(text),
      reportingCategory: v.optional(text),
    }),
    LibraryResource: entityRecord(to, "LibraryResource", {
      ...base,
      physicalOrDigital: v.optional(term(ACCESS_FORMS, "a form of access")),
      marc008: v.optional(text),
      resourceType: v.optional(text),
      learningObjectives: v.optional(v.array(to(["LearningObjective"]))),
    }),
    LibrarySpace: entityRecord(to, "LibrarySpace", {
      ...base,
      isPartOf: v.optional(to(["Library"])),
      buildingName: v.optional(text),
      buildingNumber: v.optional(text),
      roomNumber: v.optional(text),
      floor: v.optional(text),
      servicePoint: v.optional(text),
    }),
    Entity: entityRecord(to, "Entity", base),
  };
}
