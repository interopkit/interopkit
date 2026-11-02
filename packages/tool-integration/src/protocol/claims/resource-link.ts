import { looseRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import { IDENTIFIER, NULLABLE_STRING } from "./schemas.js";

/** The resource link a message comes from (LTI 1.3 Core section 5.3.5). */
export interface ResourceLink {
  /** The identifier of the link within the deployment. */
  readonly id: string;
  /** The title of the link. */
  readonly title?: string;
  /** The description of the link. */
  readonly description?: string;
}

/**
 * The resource link claim. Canvas sends `null` for a title or a description that it has none of, which is read as absent.
 */
export const resourceLinkSchema = v.pipe(
  looseRecord({ id: IDENTIFIER, title: NULLABLE_STRING, description: NULLABLE_STRING }),
  v.transform((claim): ResourceLink => ({ id: claim.id, title: claim.title, description: claim.description })),
);
