import {
  absoluteUriSchema,
  dateTimeSchema,
  nonNegativeIntegerSchema,
  parseWith,
  strictRecord,
  uuidSchema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { STATEMENT_FORMATS, type StatementQuery } from "../model/index.js";
import { identifiedActor } from "./identified.js";

const querySchema = strictRecord({
  agent: v.optional(identifiedActor),
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

/** A query after the checks, and the parameters that it makes. */
export interface ReadQuery {
  /** The parameters of the request, by the names of the standard, in a fixed order. */
  readonly parameters: URLSearchParams;
  /** Whether the query asks for the data of the Attachments, so that the answer is a multipart message. */
  readonly attachments: boolean;
}

/**
 * Checks a query of Statements, as a host passes it from JavaScript, and writes its parameters. A filter that is left out
 * is not sent, so the LRS applies its default.
 *
 * @throws `DataError` that names the filter and what it must be.
 */
export function readQuery(query: unknown): ReadQuery {
  const checked: StatementQuery = parseWith(querySchema, query, "The query");
  const parameters = new URLSearchParams();
  const set = (name: string, value: string | number | boolean | undefined): void => {
    if (value !== undefined) parameters.set(name, String(value));
  };
  set("agent", checked.agent === undefined ? undefined : JSON.stringify(checked.agent));
  set("verb", checked.verb);
  set("activity", checked.activity);
  set("registration", checked.registration);
  set("related_activities", checked.relatedActivities);
  set("related_agents", checked.relatedAgents);
  set("since", checked.since);
  set("until", checked.until);
  set("limit", checked.limit);
  set("format", checked.format);
  set("attachments", checked.attachments);
  set("ascending", checked.ascending);
  return { parameters, attachments: checked.attachments === true };
}
