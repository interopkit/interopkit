import { isLanguageTag } from "@interopkit/core/checks";
import type { InteractionType } from "../model/index.js";

/** The delimiter of the items of a list in a response pattern (4.2.2.3). */
const ITEM_DELIMITER = "[,]";
/** The delimiter inside an item: the two items of a matching pair, a step and its response. */
const PAIR_DELIMITER = "[.]";
/** The delimiter of the minimum and the maximum of a numeric range. */
const RANGE_DELIMITER = "[:]";

/** A decimal number as a numeric response writes it. */
const NUMBER = /^-?\d+(?:\.\d+)?$/u;

/** The interactions whose responses are a list of strings, and may begin with parameters. */
const WITH_PARAMETERS: ReadonlySet<InteractionType> = new Set(["fill-in", "long-fill-in", "performance"]);

/** The parameters that apply to the whole list, and the interactions that take each. */
const LIST_PARAMETERS: ReadonlyMap<string, ReadonlySet<InteractionType>> = new Map([
  ["case_matters", new Set<InteractionType>(["fill-in", "long-fill-in"])],
  ["order_matters", new Set<InteractionType>(["fill-in", "long-fill-in", "performance"])],
]);

/** Splits one parameter, `{name=value}`, from the start of a response (4.2.2.3), or returns `undefined` when there is none. */
function takeParameter(response: string): { name: string; value: string; rest: string } | undefined {
  const end = response.indexOf("}");
  const equals = response.indexOf("=");
  if (!response.startsWith("{") || end < 0 || equals < 0 || equals > end) return undefined;
  return { name: response.slice(1, equals), value: response.slice(equals + 1, end), rest: response.slice(end + 1) };
}

/** Says what is wrong with a parameter at the start of a response, or returns `undefined` when it is right. */
function parameterProblem(type: InteractionType, name: string, value: string, first: boolean): string | undefined {
  const listTypes = LIST_PARAMETERS.get(name);
  if (listTypes !== undefined) {
    if (!listTypes.has(type)) return `the parameter ${name} does not apply to a ${type} interaction`;
    if (!first) return `the parameter ${name} belongs at the start of the first response`;
    return value === "true" || value === "false" ? undefined : `the parameter ${name} is true or false, found ${value}`;
  }
  if (name !== "lang") return `the parameter ${name} is not one of case_matters, order_matters and lang`;
  return isLanguageTag(value) ? undefined : `the parameter lang is a language tag, found ${value}`;
}

/** Says what is wrong with the parameters at the start of a response of a list, and returns the response without them. */
function readResponse(type: InteractionType, response: string, first: boolean): { problem?: string; rest: string } {
  let rest = response;
  if (!WITH_PARAMETERS.has(type)) return { rest };
  for (let parameter = takeParameter(rest); parameter !== undefined; parameter = takeParameter(rest)) {
    rest = parameter.rest;
    const problem = parameterProblem(type, parameter.name, parameter.value, first);
    if (problem !== undefined) return { problem, rest };
  }
  return { rest };
}

/** Says what is wrong with an item that must be an id: it is not empty. */
function idProblem(item: string, what: string): string | undefined {
  return item === "" ? `${what} is empty` : undefined;
}

/** Says what is wrong with a number or a range of numbers (`numeric`), or returns `undefined`. */
function numericProblem(pattern: string): string | undefined {
  const bounds = pattern.split(RANGE_DELIMITER);
  if (bounds.length > 2) return `a range has one ${RANGE_DELIMITER}`;
  const bad = bounds.find((bound) => bound !== "" && !NUMBER.test(bound));
  return bad === undefined ? undefined : `${JSON.stringify(bad)} is not a number`;
}

/** Says what is wrong with one item of a list, by interaction type. */
function itemProblem(type: InteractionType, entry: string): string | undefined {
  const first = entry.indexOf(PAIR_DELIMITER);
  if (type === "matching") {
    if (first < 0 || first !== entry.lastIndexOf(PAIR_DELIMITER)) {
      return `a pair is a source and a target joined by ${PAIR_DELIMITER}, found ${JSON.stringify(entry)}`;
    }
    return (
      idProblem(entry.slice(0, first), "the source of a pair") ??
      idProblem(entry.slice(first + PAIR_DELIMITER.length), "the target of a pair")
    );
  }
  if (type === "performance") {
    if (first < 0) return `a step is an id and a response joined by ${PAIR_DELIMITER}, found ${JSON.stringify(entry)}`;
    return idProblem(entry.slice(0, first), "the id of a step");
  }
  return type === "choice" || type === "sequencing" ? idProblem(entry, "an item id") : undefined;
}

/**
 * Says what is wrong with a response pattern for the type of the interaction, or returns `undefined` when it is right. The
 * forms are those of the table of interaction types (4.2.2.3), and the parameters are those of the table of characterstring
 * parameters, which an LRS does not validate.
 */
export function patternProblem(type: InteractionType, pattern: string): string | undefined {
  if (type === "other") return undefined;
  if (type === "true-false")
    return pattern === "true" || pattern === "false"
      ? undefined
      : `expected true or false, found ${JSON.stringify(pattern)}`;
  if (type === "numeric") return numericProblem(pattern);
  if (type === "likert") {
    return pattern.includes(ITEM_DELIMITER)
      ? `expected one item id, with no ${ITEM_DELIMITER}`
      : idProblem(pattern, "the item id");
  }
  // A list of no items is the response of a learner who gave none.
  if (pattern === "") return undefined;
  const entries = pattern.split(ITEM_DELIMITER);
  for (const [index, entry] of entries.entries()) {
    const { problem, rest } = readResponse(type, entry, index === 0);
    const found = problem ?? itemProblem(type, rest);
    if (found !== undefined) return found;
  }
  return undefined;
}
