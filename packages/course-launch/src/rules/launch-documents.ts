import {
  isLanguageTag,
  type JsonObject,
  jsonObjectSchema,
  looseRecord,
  parseWith,
  strictRecord,
} from "@interopkit/core/checks";
import type { Context } from "@interopkit/learning-records";
import * as v from "valibot";
import {
  AUDIO_PREFERENCES,
  LAUNCH_MODES,
  type LaunchData,
  type LearnerPreferences,
  MOVE_ON_VALUES,
} from "../model/index.js";
import { checkXapiPart } from "./xapi-parts.js";

const scoreSchema = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1));

/**
 * The document `LMS.LaunchData` as JSON. CATAPULT's player writes `masteryScore: null` and `entitlementKey: {}` into the launch
 * data of every assignable unit that has neither, so both are read as absent.
 */
const launchDataSchema = looseRecord({
  contextTemplate: jsonObjectSchema,
  launchMode: v.picklist(LAUNCH_MODES),
  moveOn: v.picklist(MOVE_ON_VALUES),
  launchParameters: v.optional(v.string()),
  masteryScore: v.optional(v.nullable(scoreSchema)),
  returnURL: v.optional(v.string()),
  entitlementKey: v.optional(
    v.union([v.strictObject({}), strictRecord({ courseStructure: v.string(), alternate: v.optional(v.string()) })]),
  ),
});

/** Reads the launch data of a session, as `readLaunchData` does, with the label of the value in its messages. */
export function readLaunchDataAs(json: unknown, label: string): LaunchData {
  const read = parseWith(launchDataSchema, json, label);
  checkXapiPart("context", read.contextTemplate, `${label} at contextTemplate`);
  const { launchParameters, masteryScore, returnURL, entitlementKey } = read;
  return {
    // The rules of xAPI took it as a Context, and jsonObjectSchema made it a copy.
    contextTemplate: read.contextTemplate as Context,
    launchMode: read.launchMode,
    moveOn: read.moveOn,
    ...(launchParameters === undefined ? {} : { launchParameters }),
    ...(masteryScore === undefined || masteryScore === null ? {} : { masteryScore }),
    ...(returnURL === undefined ? {} : { returnUrl: returnURL }),
    ...(entitlementKey === undefined || !("courseStructure" in entitlementKey) ? {} : { entitlementKey }),
  };
}

/**
 * Reads the document `LMS.LaunchData` that an LMS writes before a launch: the context template, the launch mode, `moveOn`, and
 * when given the launch parameters, the mastery score, the return URL and the entitlement key.
 *
 * @remarks
 * The context template is read by the rules of a Context of xAPI 1.0.3. A `masteryScore` of `null` and an `entitlementKey` of
 * `{}` are read as absent, as CATAPULT's player writes them for a unit that has neither. Members that cmi5 does not define are
 * dropped.
 *
 * @param json - The document, parsed.
 * @returns The launch data, a copy that shares nothing with the input; `returnURL` becomes `returnUrl`.
 * @throws `DataError` that names the path of the first fault.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_state | cmi5, 10.0 xAPI State Data Model}
 */
export function readLaunchData(json: unknown): LaunchData {
  return readLaunchDataAs(json, "The launch data");
}

/** A list of language tags, separated by commas without spaces, the preferred first (11.1). */
const languagesSchema = v.pipe(
  v.string(),
  v.transform((text) => (text === "" ? [] : text.split(","))),
  v.check(
    (tags) => tags.every((tag) => isLanguageTag(tag)),
    (issue) => `expected language tags of RFC 5646 separated by commas, found ${issue.received}`,
  ),
);

const preferencesSchema = looseRecord({
  languagePreference: v.optional(languagesSchema),
  audioPreference: v.optional(v.picklist(AUDIO_PREFERENCES)),
});

/**
 * Reads the preferences of a learner, the Agent Profile document `cmi5LearnerPreferences`: the languages, the preferred first,
 * and the audio, on or off.
 *
 * @remarks
 * `languagePreference` is a list of RFC 5646 tags separated by commas, and an empty text is no language. Either property may be
 * absent, and then the assignable unit chooses. Members that cmi5 does not define are dropped.
 *
 * @param json - The document, parsed.
 * @returns The preferences.
 * @throws `DataError` that names the property that is not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_agent_profile | cmi5, 11.0 xAPI Agent Profile Data Model}
 */
export function readLearnerPreferences(json: unknown): LearnerPreferences {
  const { languagePreference, audioPreference } = parseWith(preferencesSchema, json, "The preferences document");
  return {
    ...(languagePreference === undefined ? {} : { languagePreference }),
    ...(audioPreference === undefined ? {} : { audioPreference }),
  };
}

const writtenPreferencesSchema = strictRecord({
  languagePreference: v.array(
    v.pipe(
      v.string(),
      v.check(isLanguageTag, (issue) => `expected a language tag of RFC 5646, found ${issue.received}`),
    ),
  ),
  audioPreference: v.picklist(AUDIO_PREFERENCES),
});

/**
 * Writes the preferences of a learner as the document `cmi5LearnerPreferences`, with both properties that cmi5 asks the
 * document to have.
 *
 * @param preferences - The languages, the preferred first, and the audio.
 * @returns The document: `languagePreference` as tags separated by commas, and `audioPreference`.
 * @throws `DataError` that names the property that is missing or not valid.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#xapi_agent_profile | cmi5, 11.0 xAPI Agent Profile Data Model}
 */
export function writeLearnerPreferences(preferences: Required<LearnerPreferences>): JsonObject {
  // A language tag holds no comma, so the tags join into the list of the document without ambiguity.
  const { languagePreference, audioPreference } = parseWith(
    writtenPreferencesSchema,
    preferences,
    "The preferences document",
  );
  return { languagePreference: languagePreference.join(","), audioPreference };
}
