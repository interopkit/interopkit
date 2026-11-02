import { DataError } from "@interopkit/core";
import { describe, parseWith } from "@interopkit/core/checks";
import type { Agent } from "../model/index.js";
import { parseIsoTimestamp } from "../model/internal.js";
import { readStatementJson } from "../read/index.js";
import { identifiedAgentSchema } from "../read/internal.js";
import type { LrsSettingsLimits } from "./options.js";

/** Checks that a request has no parameter that the resource does not have (4.1.5): a name in another case is unknown too. */
export function checkNames(parameters: ReadonlyMap<string, string>, known: ReadonlySet<string>): void {
  for (const name of parameters.keys()) {
    if (!known.has(name)) {
      throw new DataError(
        `The parameter ${describe(name)} is not a parameter of this resource: the names are case-sensitive.`,
      );
    }
  }
}

/**
 * Reads the JSON of a request, a body or a parameter such as an Agent, within the size, depth and tokens that the limits give
 * it, and refuses a property that occurs twice.
 */
export function readRequestJson(text: string, limits: LrsSettingsLimits): unknown {
  return readStatementJson(text, {
    maxBytes: limits.maxBodyBytes,
    maxDepth: limits.maxDepth,
    maxTokens: limits.maxTokens,
  });
}

/**
 * Reads a parameter that is a Timestamp on the route of 1.0.3, to the standard of a Timestamp in a Statement (1.0.3 Data 2.2):
 * ISO 8601 with a time zone, which the LRS compares in UTC.
 */
export function readIsoParameter(name: string, text: string): string {
  const milliseconds = parseIsoTimestamp(text);
  if (milliseconds === undefined) {
    throw new DataError(
      `The parameter ${name} must be an ISO 8601 date and time with a time zone, such as 2024-06-13T18:46:03.250Z, found ${describe(text)}.`,
    );
  }
  return new Date(milliseconds).toISOString();
}

/** Reads the parameter `agent`, the JSON of an Agent with exactly one identifier. */
export function readAgent(text: string | undefined, limits: LrsSettingsLimits): Agent {
  if (text === undefined) throw new DataError("The request needs the parameter agent, the JSON of an Agent.");
  return parseWith(identifiedAgentSchema, readRequestJson(text, limits), "The parameter agent");
}
