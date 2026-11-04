import { DataError } from "@interopkit/core";
import {
  buildIssues,
  createIssueSink,
  DEFAULT_MAX_FINDINGS,
  describeRefusal,
  type Issue,
  type IssueSink,
  MAX_JSON_DEPTH,
  MAX_JSON_TOKENS,
  parseJsonText,
  parseWith,
  positiveIntegerSchema,
  safeParseBounded,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { conceptsIssues } from "./concept-rules.js";
import { documentIssues } from "./document-rules.js";
import { patternsIssues } from "./pattern-rules.js";
import type { Profile } from "./profile.js";
import { profileIssues } from "./profile-rules.js";
import { collectReferences } from "./references.js";
import { profileSchema } from "./schemas.js";
import { templatesIssues } from "./template-rules.js";

/** The options of `readProfile` and `validateProfile`. */
export interface ProfileReadOptions {
  /**
   * Other profiles whose concepts, Statement Templates and Patterns the profile names: the Patterns of another profile that it
   * reuses, the concepts of another that its matches name. Each is read by its shape; `validateProfile` judges it on its own.
   *
   * @defaultValue none
   */
  readonly profiles?: readonly unknown[];
  /**
   * The most findings that the call lists, or that `readProfile` counts errors up to before it stops.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
  /**
   * The most tokens of JSON in a profile given as text, counted before the text is parsed: a value, a bracket, a colon and a
   * comma are each a token. The largest profile that ADL publishes has about 30,000.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
}

const optionsSchema = strictRecord({
  profiles: v.optional(v.array(v.unknown())),
  maxFindings: v.optional(positiveIntegerSchema),
  maxTokens: v.optional(positiveIntegerSchema),
});

/** What the options of a read ask for. */
interface ProfileReadSettings {
  readonly others: readonly Profile[];
  readonly maxFindings: number;
  readonly maxTokens: number;
}

/** Checks the options of a read, reads the other profiles by their shape, and returns what the options ask for. */
function readSettings(options: unknown): ProfileReadSettings {
  const checked = parseWith(optionsSchema, options === undefined ? {} : options, "The options object");
  const maxTokens = checked.maxTokens ?? MAX_JSON_TOKENS;
  const others = (checked.profiles ?? []).map((other, index) =>
    parseWith(profileSchema, parseProfileText(other, maxTokens), `The option profiles at [${index}]`),
  );
  return { others, maxFindings: checked.maxFindings ?? DEFAULT_MAX_FINDINGS, maxTokens };
}

/** Parses a profile given as text within the limits, and returns any other value as it is. */
function parseProfileText(input: unknown, maxTokens: number): unknown {
  if (typeof input !== "string") return input;
  return parseJsonText(
    input,
    { maxDepth: MAX_JSON_DEPTH, maxTokens },
    {
      depth: `The profile nests deeper than ${MAX_JSON_DEPTH} levels.`,
      tokens: `The profile has more than ${maxTokens} tokens of JSON.`,
      syntax: (cause) => `The profile is not JSON: ${cause instanceof Error ? cause.message : String(cause)}.`,
    },
  );
}

/**
 * Reads a profile into the model and judges the rules between its objects when its shape is right.
 *
 * @returns The profile, a copy that shares nothing with the input, when its shape is right, whatever else is found.
 */
function inspectProfile(input: unknown, others: readonly Profile[], sink: IssueSink): Profile | undefined {
  const parse = safeParseBounded(profileSchema, input, sink.room);
  if (!parse.success) {
    sink.add(buildIssues(parse.issues));
    return undefined;
  }
  const profile = parse.output;
  const references = collectReferences(profile, others);
  sink.add(documentIssues(input));
  sink.add(profileIssues(profile, references));
  sink.add(conceptsIssues(profile.concepts ?? [], references));
  sink.add(templatesIssues(profile.templates ?? [], references));
  sink.add(patternsIssues(profile.patterns ?? [], references));
  return profile;
}

/**
 * Reads an xAPI Profile into the model: checks every object against the tables of the specification and the rules between
 * them, and returns a copy.
 *
 * @remarks
 * The profile is a value, such as parsed JSON-LD, or the text of its JSON, which is parsed within `maxTokens` and 64 levels. A
 * profile with an error is not returned, and warnings are not reported: `validateProfile` lists the findings with their
 * severity. A Pattern member that neither the profile nor the option `profiles` defines is a warning, since the specification
 * lets a Pattern reuse those of other profiles. The check stops after `maxFindings` errors, and the error says that there may
 * be more.
 *
 * @param input - The profile, or the text of its JSON.
 * @param options - Other profiles that it names, the most errors to count, and the most tokens of a text.
 * @returns The profile.
 * @throws `LimitError` with the limit `maxTokens`, or `maxDepth` for more than 64 levels, when the text passes it.
 * @throws `DataError` that names the path of the first error and counts the others, when the profile has an error or the text is
 * not JSON, or when the options are not an object with `profiles` as a list of profiles of the right shape, and `maxFindings`
 * and `maxTokens` as positive integers.
 * @see {@link https://github.com/adlnet/xapi-profiles/blob/master/xapi-profiles-structure.md | xAPI Profiles 1.0, Part Two}
 */
export function readProfile(input: unknown, options?: ProfileReadOptions): Profile {
  return readProfileAndOthers(input, options).profile;
}

/** Reads a profile as `readProfile` does, and returns it with the other profiles of the options, read by their shape. */
export function readProfileAndOthers(
  input: unknown,
  options: unknown,
): { readonly profile: Profile; readonly others: readonly Profile[] } {
  const { others, maxFindings, maxTokens } = readSettings(options);
  const sink = createIssueSink(maxFindings, true);
  const profile = inspectProfile(parseProfileText(input, maxTokens), others, sink);
  const errors = sink.list();
  if (profile === undefined || errors.length > 0) {
    throw new DataError(describeRefusal("The profile", errors, "validateProfile"));
  }
  return { profile, others };
}

/**
 * Judges an xAPI Profile: lists what breaks the rules that the specification sets for a profile, and what departs from its
 * recommendations.
 *
 * @remarks
 * The findings are those that `readProfile` bases its refusal on, the warnings among them; the guide's table lists each rule.
 * When the shape is wrong, the findings are about the shape alone: the rules between objects are judged once it is right. A
 * value that is not a profile gives findings and does not throw; a text that is not JSON throws, as `readProfile` does. The list
 * holds at most `maxFindings` findings, and a last finding with the rule `findings-stopped` says that the check stopped there.
 *
 * @param input - The profile, or the text of its JSON.
 * @param options - Other profiles that it names, the most findings to list, and the most tokens of a text.
 * @returns The findings, errors and warnings. An empty list means that the profile is sound.
 * @throws `LimitError` with the limit `maxTokens`, or `maxDepth` for more than 64 levels, when the text passes it.
 * @throws `DataError` when the text is not JSON, or when the options are not an object with `profiles` as a list of profiles of
 * the right shape, and `maxFindings` and `maxTokens` as positive integers.
 * @see {@link https://github.com/adlnet/xapi-profiles/blob/master/xapi-profiles-structure.md | xAPI Profiles 1.0, Part Two}
 */
export function validateProfile(input: unknown, options?: ProfileReadOptions): readonly Issue[] {
  const { others, maxFindings, maxTokens } = readSettings(options);
  const sink = createIssueSink(maxFindings, false);
  inspectProfile(parseProfileText(input, maxTokens), others, sink);
  return sink.list();
}
