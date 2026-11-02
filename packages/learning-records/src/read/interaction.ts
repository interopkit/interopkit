import type {
  Activity,
  ActivityDefinition,
  InteractionComponent,
  InteractionType,
  StatementIssue,
} from "../model/index.js";
import { error, warning } from "./finding.js";
import type { RuleSet } from "./options.js";
import { item, member } from "./path.js";
import { patternProblem } from "./response-pattern.js";

/** Every list of components, in the order of the table (4.2.2.3). */
const ALL_LISTS = ["choices", "scale", "source", "target", "steps"] as const;

/** A list of components of an interaction. */
type ComponentList = (typeof ALL_LISTS)[number];

/** The lists of components that a definition may have, by the type of the interaction (4.2.2.3). */
const COMPONENT_LISTS: Readonly<Record<InteractionType, readonly ComponentList[]>> = {
  "true-false": [],
  choice: ["choices"],
  "fill-in": [],
  "long-fill-in": [],
  matching: ["source", "target"],
  performance: ["steps"],
  sequencing: ["choices"],
  likert: ["scale"],
  numeric: [],
  other: [],
};

/**
 * Judges the ids of the components of one list: they have no white space (4.2.4.2), and they identify the component in the
 * list (4.2.2.3), which 1.0.3 states as a requirement that they be distinct (Data 2.4.4.1). An LRS may refuse what is not valid
 * for an interaction and need not (1.0.3 Data 2.4.4.1), so for an LRS a repeated id is a warning in either version, and for a
 * provider of 1.0.3 an error.
 */
function* componentIssues(
  components: readonly InteractionComponent[],
  path: string,
  rules: RuleSet,
): Generator<StatementIssue> {
  const repeated = rules.version === "1.0.3" && rules.role === "provider" ? error : warning;
  const seen = new Set<string>();
  for (const [index, component] of components.entries()) {
    const at = member(item(path, index), "id");
    if (/\s/u.test(component.id)) {
      yield warning(
        at,
        "component-id-whitespace",
        "expected an id with no white space, which an LRS should not accept.",
      );
    }
    if (seen.has(component.id)) {
      yield repeated(
        at,
        "duplicate-component-id",
        `expected an id that identifies the component in its list, found ${JSON.stringify(component.id)} again.`,
      );
    }
    seen.add(component.id);
  }
}

/** Judges the lists of components of a definition against the type of the interaction. */
function* listIssues(
  definition: ActivityDefinition,
  type: InteractionType,
  path: string,
  rules: RuleSet,
): Generator<StatementIssue> {
  const allowed = COMPONENT_LISTS[type];
  for (const name of ALL_LISTS) {
    const list = definition[name];
    if (list === undefined) continue;
    if (allowed.includes(name)) {
      yield* componentIssues(list, member(path, name), rules);
      continue;
    }
    const lists = allowed.length === 0 ? "no list of components" : `the lists ${allowed.join(" and ")}`;
    const message = `a ${type} interaction has ${lists}, found ${name}.`;
    const finding = rules.role === "provider" ? error : warning;
    yield finding(member(path, name), "unsupported-component-list", message);
  }
}

/**
 * Judges the interaction in an Activity Definition. `interactionType` is required when the definition has any other
 * property of an interaction (4.2.4.2). The lists of components belong to some types, and an LRS may refuse one that does not
 * (4.2.4.2), so it is a warning for an LRS and an error for a provider, which shall not add properties (5.2.1). A response
 * pattern that does not have the form of its type is a warning, since an LRS does not validate patterns (4.2.2.3).
 */
export function* interactionIssues(activity: Activity, path: string, rules: RuleSet): Generator<StatementIssue> {
  const { definition } = activity;
  if (definition === undefined) return;
  const base = member(path, "definition");
  const { interactionType, correctResponsesPattern = [] } = definition;
  if (interactionType === undefined) {
    const interactive =
      definition.correctResponsesPattern !== undefined || ALL_LISTS.some((name) => definition[name] !== undefined);
    if (interactive) {
      yield error(
        member(base, "interactionType"),
        "missing-property",
        'missing the property "interactionType", which an interaction needs.',
      );
    }
    return;
  }
  yield* listIssues(definition, interactionType, base, rules);
  for (const [index, pattern] of correctResponsesPattern.entries()) {
    const problem = patternProblem(interactionType, pattern);
    if (problem !== undefined) {
      yield warning(item(member(base, "correctResponsesPattern"), index), "response-pattern", `${problem}.`);
    }
  }
}
