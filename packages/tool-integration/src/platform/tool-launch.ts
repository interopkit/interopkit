import { DataError } from "@interopkit/core";
import { checkHttpsUrl, checkNonEmptyString, checkRecord, describe, isRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { MAX_IDENTIFIER_LENGTH, POSITIVE_NUMBER } from "../protocol/internal.js";

/** The most characters of `ToolLaunch.resource`, because it travels in the query of the login URL. */
const MAX_RESOURCE_LENGTH = 1_024;
/** The most characters of `ToolLaunch.target`, because it travels in the login URL twice: as a parameter and in the hint. */
const MAX_TARGET_LENGTH = 2_048;
/** The most characters of `ToolLaunch.title`, because it travels in the login URL. */
const MAX_TITLE_LENGTH = 255;
/** The most characters of the names and values of `ToolLaunch.custom` together, because they travel in the login URL. */
const MAX_CUSTOM_LENGTH = 2_048;

/** What the platform launches a tool for: the user, the resource in the host's terms, and the link. */
export interface ToolLaunch {
  /** The `sub` of the launch: at most 255 characters. */
  readonly principal: string;
  /**
   * What the launch is for, in the host's terms, at most 1,024 characters, because it travels in the query of the login URL.
   * It is signed and not encrypted: the tool and the browser can read it, so it holds no secret and no personal data.
   * The same launch must give the same text: `resource_link.id` is its hash, and `onScore` hands it back.
   */
  readonly resource: string;
  /**
   * The `target_link_uri`: an `https` URL that is on none of the platform's origins, at most 2,048 characters, because it travels
   * in the query of the login URL twice.
   */
  readonly target: string;
  /** The title of the link, not empty, at most 255 characters, because it travels in the query of the login URL. */
  readonly title: string;
  /**
   * The custom properties that the platform sends with the launch, by name. The names and the values have at most 2,048
   * characters together, because they travel in the query of the login URL.
   */
  readonly custom: Readonly<Record<string, string>>;
  /** The `scoreMaximum` of the line item, above 0. */
  readonly scoreMaximum: number;
}

/**
 * Checks a launch that the host passes: the shape of the link, the lengths of the principal, the resource, the target, the title
 * and the custom properties, and a `scoreMaximum` above 0.
 *
 * @throws `DataError` when it is not a launch.
 */
export function checkToolLaunch(value: unknown): asserts value is ToolLaunch {
  checkRecord(value, "The launch must be an object");
  checkNonEmptyString(value.principal, "The principal of the launch");
  if (value.principal.length > MAX_IDENTIFIER_LENGTH) {
    throw new DataError(
      `The principal of the launch is the sub of the launch and must have at most ${MAX_IDENTIFIER_LENGTH} characters (LTI 1.3 Core section 5.3.6), found ${value.principal.length}.`,
    );
  }
  checkNonEmptyString(value.resource, "The resource of the launch");
  if (value.resource.length > MAX_RESOURCE_LENGTH) {
    throw new DataError(
      `The resource of the launch travels in the query of the login URL and must have at most ${MAX_RESOURCE_LENGTH} characters, found ${value.resource.length}.`,
    );
  }
  checkHttpsUrl(value.target, "The target of the launch");
  if (value.target.length > MAX_TARGET_LENGTH) {
    throw new DataError(
      `The target of the launch travels in the query of the login URL and must have at most ${MAX_TARGET_LENGTH} characters, found ${value.target.length}.`,
    );
  }
  checkNonEmptyString(value.title, "The title of the launch");
  if (value.title.length > MAX_TITLE_LENGTH) {
    throw new DataError(
      `The title of the launch travels in the query of the login URL and must have at most ${MAX_TITLE_LENGTH} characters, found ${value.title.length}.`,
    );
  }
  const { custom } = value;
  if (!(isRecord(custom) && Object.values(custom).every((item) => typeof item === "string"))) {
    throw new DataError(`The custom properties of the launch must be an object of strings, found ${describe(custom)}.`);
  }
  const customLength = Object.entries(custom).reduce((sum, [name, item]) => sum + name.length + String(item).length, 0);
  if (customLength > MAX_CUSTOM_LENGTH) {
    throw new DataError(
      `The custom properties of the launch travel in the query of the login URL and must have at most ${MAX_CUSTOM_LENGTH} characters in their names and values, found ${customLength}.`,
    );
  }
  if (!v.is(POSITIVE_NUMBER, value.scoreMaximum)) {
    throw new DataError(
      `The scoreMaximum of the launch must be a number above 0, found ${describe(value.scoreMaximum)}.`,
    );
  }
}
