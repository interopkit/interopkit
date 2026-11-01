import {
  absoluteUriSchema,
  dateTimeSchema,
  nonNegativeIntegerSchema,
  type Schema,
  strictRecord,
  uuidSchema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { STATEMENT_FORMATS, type StatementQuery } from "../model/index.js";
import { identifiedActorSchema } from "./identified.js";

/** Reads the filters of a query of Statements (4.1.6.1): each one in its type and form. */
export const statementQuerySchema: Schema<StatementQuery> = strictRecord({
  agent: v.optional(identifiedActorSchema),
  verb: v.optional(absoluteUriSchema),
  activity: v.optional(absoluteUriSchema),
  registration: v.optional(uuidSchema),
  relatedActivities: v.optional(v.boolean()),
  relatedAgents: v.optional(v.boolean()),
  since: v.optional(dateTimeSchema),
  until: v.optional(dateTimeSchema),
  limit: v.optional(nonNegativeIntegerSchema),
  format: v.optional(v.picklist(STATEMENT_FORMATS)),
  attachments: v.optional(v.boolean()),
  ascending: v.optional(v.boolean()),
});
