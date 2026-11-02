import { checkHttpsUrl, type JsonValue, looseRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { compact, OPTIONAL_TEXT } from "./body.js";
import { HTTPS_URL, STRING_RECORD } from "./schemas.js";

/** The launch that a platform makes from a result back to the work behind it (Submission Review 1.0 section 3.3). */
export interface SubmissionReview {
  /** A label that the platform may put on the link. */
  readonly label?: string;
  /** The address to launch; the platform uses the target link of the resource link, or the base address of the tool, when absent. */
  readonly url?: string;
  /** The custom properties that the review message carries. */
  readonly custom?: ReadonlyMap<string, string>;
}

/** The `submissionReview` property of a line item, which both the line item service and a Deep Linking resource link carry. */
export const submissionReviewSchema = v.pipe(
  looseRecord({ label: OPTIONAL_TEXT, url: v.optional(HTTPS_URL), custom: v.optional(STRING_RECORD) }),
  v.transform((review): SubmissionReview => ({ label: review.label, url: review.url, custom: review.custom })),
);

/**
 * Writes a submission review property, as `submissionReviewSchema` reads it.
 *
 * @throws `DataError` when its address is not an https address.
 */
export function writeSubmissionReview(review: SubmissionReview): Record<string, JsonValue> {
  if (review.url !== undefined) checkHttpsUrl(review.url, "The URL of a submission review");
  return compact({ label: review.label, url: review.url, custom: review.custom && Object.fromEntries(review.custom) });
}
