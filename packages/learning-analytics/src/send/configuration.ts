import { absoluteUriSchema, jsonObjectSchema, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";

/**
 * The schema of the configuration of an endpoint (Caliper 1.2 section 6.2): the three properties of the table and no other,
 * since the section says that no custom properties are permitted.
 */
export const endpointConfigurationSchema = strictRecord({
  caliperMaximumPayloadSize: v.optional(positiveIntegerSchema),
  caliperSupportedVersions: v.array(absoluteUriSchema),
  caliperSupportedExtensions: v.optional(jsonObjectSchema),
});
