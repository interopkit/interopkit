import { DataError } from "@interopkit/core";
import { describe, isUuid, parseWith } from "@interopkit/core/checks";
import { type HttpRequest, readQuery } from "@interopkit/core/http";
import type { StatementFormat, StatementQuery } from "../../model/index.js";
import { readStatementJson } from "../../read/index.js";
import { statementQuerySchema } from "../../read/internal.js";
import { checkNames } from "../parameters.js";
import { attempt, type Verdict } from "../verdict.js";

/** What a GET on the Statements resource asks for. */
export type StatementsGet =
  | {
      /** One Statement, by `statementId` or `voidedStatementId`. */
      readonly kind: "one";
      readonly id: string;
      readonly voided: boolean;
      readonly format: StatementFormat | undefined;
      readonly attachments: boolean;
    }
  | {
      /** A page of Statements. */
      readonly kind: "many";
      readonly query: StatementQuery;
      /** The parameters other than `cursor`, in the order of the request, which the address of the next page repeats. */
      readonly carried: readonly (readonly [string, string])[];
      readonly cursor: string | undefined;
    };

/** The parameters of a query of Statements, by the names the standard gives them (4.1.6.1), with the property each one sets. */
const FILTERS: ReadonlyMap<string, string> = new Map([
  ["agent", "agent"],
  ["verb", "verb"],
  ["activity", "activity"],
  ["registration", "registration"],
  ["related_activities", "relatedActivities"],
  ["related_agents", "relatedAgents"],
  ["since", "since"],
  ["until", "until"],
  ["limit", "limit"],
  ["format", "format"],
  ["attachments", "attachments"],
  ["ascending", "ascending"],
]);

const BOOLEANS = new Set(["related_activities", "related_agents", "attachments", "ascending"]);
const SINGLE = new Set(["statementId", "voidedStatementId", "attachments", "format"]);

/** The place of the cursor in the address of a page, which is the only parameter the LRS adds to the standard's. */
export const CURSOR = "cursor";

const KNOWN = new Set<string>([...FILTERS.keys(), "statementId", "voidedStatementId", CURSOR]);

/** Reads the value of a parameter that is a Boolean: `true` or `false`, as JSON writes them. */
function readBoolean(name: string, text: string): boolean {
  if (text === "true") return true;
  if (text === "false") return false;
  throw new DataError(`The parameter ${name} must be true or false, found ${describe(text)}.`);
}

/** Reads the value of a parameter that is a whole number of at least 0. */
function readCount(name: string, text: string): number {
  if (!/^\d{1,15}$/u.test(text)) {
    throw new DataError(`The parameter ${name} must be a whole number of at least 0, found ${describe(text)}.`);
  }
  return Number(text);
}

/** Turns the text of the parameters into the filters of a query, and checks each. */
function readFilters(parameters: ReadonlyMap<string, string>): StatementQuery {
  const raw: Record<string, unknown> = {};
  for (const [name, text] of parameters) {
    const property = FILTERS.get(name);
    if (property === undefined) continue;
    if (BOOLEANS.has(name)) raw[property] = readBoolean(name, text);
    else if (name === "limit") raw[property] = readCount(name, text);
    else raw[property] = name === "agent" ? readStatementJson(text) : text;
  }
  return parseWith(statementQuerySchema, raw, "The query");
}

/** Reads a GET on the Statements resource: one Statement, or a page of them. */
export function readGet(request: HttpRequest): Verdict<StatementsGet> {
  return attempt(() => {
    const parameters = readQuery(request);
    checkNames(parameters, KNOWN);
    const wanted = parameters.get("statementId");
    const voidedWanted = parameters.get("voidedStatementId");
    if (wanted !== undefined && voidedWanted !== undefined) {
      throw new DataError("A request cannot have both statementId and voidedStatementId.");
    }
    const one = wanted ?? voidedWanted;
    if (one === undefined) {
      const carried = [...parameters].filter(([name]) => name !== CURSOR);
      return { kind: "many", query: readFilters(parameters), carried, cursor: parameters.get(CURSOR) } as const;
    }
    for (const name of parameters.keys()) {
      if (!SINGLE.has(name)) {
        throw new DataError(
          `A request for one Statement cannot have the parameter ${name}: only attachments and format go with statementId.`,
        );
      }
    }
    if (!isUuid(one)) throw new DataError(`The Statement id must be a UUID, found ${describe(one)}.`);
    const filters = readFilters(parameters);
    return {
      kind: "one",
      id: one.toLowerCase(),
      voided: voidedWanted !== undefined,
      format: filters.format,
      attachments: filters.attachments === true,
    } as const;
  });
}

/** Reads a PUT on the Statements resource: the id of the Statement, and no other parameter. */
export function readPut(request: HttpRequest): Verdict<string> {
  return attempt(() => {
    const parameters = readQuery(request);
    checkNames(parameters, new Set(["statementId"]));
    const id = parameters.get("statementId");
    if (id === undefined) throw new DataError("A PUT needs the parameter statementId, the id of the Statement.");
    if (!isUuid(id)) throw new DataError(`The Statement id must be a UUID, found ${describe(id)}.`);
    return id.toLowerCase();
  });
}

/** Checks that a POST has no parameter. */
export function readPost(request: HttpRequest): Verdict<undefined> {
  return attempt(() => {
    checkNames(readQuery(request), new Set());
    return undefined;
  });
}
