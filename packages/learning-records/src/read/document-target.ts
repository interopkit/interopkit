import { absoluteUriSchema, nonEmptyStringSchema, uuidSchema } from "@interopkit/core/checks";
import * as v from "valibot";
import { identifiedAgentSchema } from "./identified.js";
import { objectGuard } from "./schemas.js";

const RESOURCES = (issue: { readonly received: string }): string =>
  `expected "state", "agent-profile" or "activity-profile", found ${issue.received}`;

/** The place of one document: the resource that holds it and the parameters that name it. */
export const targetSchema = v.pipe(
  objectGuard,
  v.variant(
    "resource",
    [
      v.strictObject({
        resource: v.literal("state"),
        activityId: absoluteUriSchema,
        agent: identifiedAgentSchema,
        stateId: nonEmptyStringSchema,
        registration: v.optional(uuidSchema),
      }),
      v.strictObject({
        resource: v.literal("agent-profile"),
        agent: identifiedAgentSchema,
        profileId: nonEmptyStringSchema,
      }),
      v.strictObject({
        resource: v.literal("activity-profile"),
        activityId: absoluteUriSchema,
        profileId: nonEmptyStringSchema,
      }),
    ],
    RESOURCES,
  ),
);

/** The documents of one State context. */
export const stateScopeSchema = v.strictObject({
  resource: v.literal("state"),
  activityId: absoluteUriSchema,
  agent: identifiedAgentSchema,
  registration: v.optional(uuidSchema),
});

/** The documents of one context, which a request for their ids or for their removal names. */
export const scopeSchema = v.pipe(
  objectGuard,
  v.variant(
    "resource",
    [
      stateScopeSchema,
      v.strictObject({ resource: v.literal("agent-profile"), agent: identifiedAgentSchema }),
      v.strictObject({ resource: v.literal("activity-profile"), activityId: absoluteUriSchema }),
    ],
    RESOURCES,
  ),
);
