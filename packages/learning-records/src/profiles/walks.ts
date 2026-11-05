import { LimitError } from "@interopkit/core";
import { MAX_JSON_PATH_WALKS, parseJsonPath } from "./json-path.js";
import type { Profile } from "./profile.js";

/** The walks of a value that a JSONPath makes: one for each path that `|` joins, and one for a text that is no JSONPath. */
function walksOf(text: string | undefined): number {
  if (text === undefined) return 0;
  try {
    return parseJsonPath(text).length;
  } catch {
    // The reader lists a text that is no JSONPath as a finding of its own.
    return 1;
  }
}

/**
 * Checks that the JSONPaths of the rules of a profile make at most `MAX_JSON_PATH_WALKS` walks in all, counting the paths that
 * `|` joins in each `location` and `selector`.
 *
 * @param what - Names the profile in the sentence, such as `The profile`.
 * @throws `LimitError` with the limit `MAX_JSON_PATH_WALKS` when they make more.
 */
export function checkJsonPathWalks(profile: Profile, what: string): void {
  let walks = 0;
  for (const template of profile.templates ?? []) {
    for (const { location, selector } of template.rules ?? []) {
      walks += walksOf(location) + walksOf(selector);
      if (walks > MAX_JSON_PATH_WALKS) {
        throw new LimitError(
          `${what} has rules whose JSONPaths make more than ${MAX_JSON_PATH_WALKS} walks of a Statement, each path that | joins one.`,
          "MAX_JSON_PATH_WALKS",
          MAX_JSON_PATH_WALKS,
        );
      }
    }
  }
}
