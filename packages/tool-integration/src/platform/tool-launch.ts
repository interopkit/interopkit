import { DataError } from "@interopkit/core";
import { checkHttpsUrl, checkNonEmptyString, checkRecord, describe, isRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { MAX_IDENTIFIER_LENGTH, POSITIVE_NUMBER } from "../protocol/internal.js";

/** The most characters of `ToolLaunch.resource`, because it travels in the query of the login URL. */
const MAX_RESOURCE_LENGTH = 1_024;

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
  /** The `target_link_uri`: an `https` URL that is on none of the platform's origins. */
  readonly target: string;
  /** The title of the link, not empty. */
  readonly title: string;
  /** The custom properties that the platform sends with the launch, by name. */
  readonly custom: Readonly<Record<string, string>>;
  /** The `scoreMaximum` of the line item, above 0. */
  readonly scoreMaximum: number;
}

/**
 * Checks a launch that the host passes: the shape of the link, the lengths of the principal and the resource, and a
 * `scoreMaximum` above 0.
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
  checkNonEmptyString(value.title, "The title of the launch");
  const { custom } = value;
  if (!(isRecord(custom) && Object.values(custom).every((item) => typeof item === "string"))) {
    throw new DataError(`The custom properties of the launch must be an object of strings, found ${describe(custom)}.`);
  }
  if (!v.is(POSITIVE_NUMBER, value.scoreMaximum)) {
    throw new DataError(
      `The scoreMaximum of the launch must be a number above 0, found ${describe(value.scoreMaximum)}.`,
    );
  }
}
