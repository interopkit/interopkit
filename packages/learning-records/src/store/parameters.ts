import { DataError } from "@interopkit/core";
import { describe, parseWith } from "@interopkit/core/checks";
import type { Agent } from "../model/index.js";
import { readStatementJson } from "../read/index.js";
import { identifiedAgentSchema } from "../read/internal.js";

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

/** Reads the parameter `agent`, the JSON of an Agent with exactly one identifier. */
export function readAgent(text: string | undefined): Agent {
  if (text === undefined) throw new DataError("The request needs the parameter agent, the JSON of an Agent.");
  return parseWith(identifiedAgentSchema, readStatementJson(text), "The parameter agent");
}
