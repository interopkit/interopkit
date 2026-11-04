import * as v from "valibot";

/** One finding of a reader or a validator: where the fault is, which rule it breaks, and what is wrong. */
export interface Finding {
  /** Where the fault is, as code writes it: `items[3].name`. The empty string is the value as a whole. */
  readonly path: string;
  /** The rule that the data breaks, as a kebab-case label that a caller can branch on. */
  readonly rule: string;
  /** What is wrong, as a sentence that reads after the path: `expected a string, found 5.` It does not hold the path. */
  readonly message: string;
}

/**
 * A finding with its severity, which the validators of the standards list: where the fault is, which rule it breaks, what is
 * wrong, and how serious it is.
 *
 * @remarks
 * An `error` means that the data breaks a requirement of the standard, or cannot be used without a guess; a `warning` means that
 * it is usable and departs from a recommendation. The guide of the model of each standard says which rules are which.
 */
export interface Issue extends Finding {
  /** Whether the data breaks a requirement (`error`) or departs from a recommendation (`warning`). */
  readonly severity: "error" | "warning";
}

/** The most findings that a reader or a validator lists unless the caller says otherwise. */
export const DEFAULT_MAX_FINDINGS = 1_000;

/** The `rule` of the last finding of a list that stopped at the limit. */
export const FINDINGS_STOPPED_RULE = "findings-stopped";

/** Makes the error that ends a list that stopped at the limit: the value may have more findings than the list holds. */
function stoppedIssue(maxFindings: number): Issue {
  return {
    path: "",
    rule: FINDINGS_STOPPED_RULE,
    message: `the check stopped after ${maxFindings} findings, so there may be more.`,
    severity: "error",
  };
}

/** The list of issues of a reader or a validator, which holds at most a limit and tells the check that fills it when to stop. */
export interface IssueSink {
  /** How many more issues the list takes before it is full. */
  readonly room: number;
  /** Whether an issue beyond the limit was offered, so that the check can stop looking. */
  readonly stopped: boolean;
  /** Adds issues, up to the limit; the first one beyond it is dropped and stops the list. */
  add(issues: Iterable<Issue>): void;
  /** Returns a view that changes each issue it is given, such as the path of one entry of a batch, and fills this list. */
  within(place: (issue: Issue) => Issue): IssueSink;
  /** Returns the issues, and a last error that says the list stopped when it did. */
  list(): Issue[];
}

/** Changes each issue as it is read, so that a list which stopped reads no further. */
function* placedIssues(issues: Iterable<Issue>, place: (issue: Issue) => Issue): Generator<Issue> {
  for (const issue of issues) yield place(issue);
}

/**
 * Makes the list of issues of a reader or a validator, which stops at a limit and ends with an error that says so, so that a
 * value which is wrong in a million places costs the memory of a limit and not of a million.
 *
 * @remarks
 * A reader keeps the errors alone, because it does not report warnings, and a warning does not count toward the limit; a
 * validator keeps every issue.
 *
 * @param maxFindings - The most issues the list holds.
 * @param errorsOnly - Whether the list takes the errors alone.
 */
export function createIssueSink(maxFindings: number, errorsOnly: boolean): IssueSink {
  const kept: Issue[] = [];
  let stopped = false;
  const sink: IssueSink = {
    get room() {
      return maxFindings - kept.length;
    },
    get stopped() {
      return stopped;
    },
    add(issues) {
      for (const issue of issues) {
        if (errorsOnly && issue.severity !== "error") continue;
        if (kept.length >= maxFindings) {
          stopped = true;
          return;
        }
        kept.push(issue);
      }
    },
    within(place) {
      return {
        get room() {
          return sink.room;
        },
        get stopped() {
          return sink.stopped;
        },
        add: (issues) => sink.add(placedIssues(issues, place)),
        within: (inner) => sink.within((issue) => place(inner(issue))),
        list: () => sink.list(),
      };
    },
    list: () => (stopped ? [...kept, stoppedIssue(maxFindings)] : [...kept]),
  };
  return sink;
}

/** What {@link safeParseBounded} returns: the output of a parse and the issues it found, at most one more than the limit. */
export interface BoundedParse<TOutput> {
  /** Whether the value is what the schema describes, with no issue. */
  readonly success: boolean;
  /** The value as the schema reads it; of a value with issues it is partial. */
  readonly output: TOutput;
  /** The issues, in the order of the check. More than the limit means that there are more than the limit. */
  readonly issues: readonly v.BaseIssue<unknown>[];
}

/**
 * Parses a value with a schema as `v.safeParse` does, and stops looking once it has found more issues than a limit.
 *
 * @remarks
 * valibot keeps every issue of a parse in memory, about a kilobyte each, and has no option to stop at a number of them: a
 * list of a million entries that are each wrong costs a gigabyte. It reads `lang` of its configuration once for each issue
 * that it makes, and `abortEarly` after each entry of a list or an object that had an issue, so a configuration whose `lang`
 * counts and whose `abortEarly` turns on above the limit ends the parse a step after the first issue beyond it. A schema that
 * makes issues and throws them away, such as a union that tries its members, counts them as well: when the parse stopped and
 * kept no more than the limit, the value is parsed again with no limit.
 *
 * @param schema - What the value should be.
 * @param input - The value.
 * @param limit - The most issues that the caller keeps.
 * @returns The parse, with at most the limit and one more issues.
 */
export function safeParseBounded<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
  limit: number,
): BoundedParse<v.InferOutput<TSchema>> {
  let made = 0;
  const config: v.Config<v.BaseIssue<unknown>> = {
    get lang() {
      made += 1;
      return undefined;
    },
    get abortEarly() {
      return made > limit;
    },
  };
  const dataset = schema["~run"]({ value: input }, config);
  const issues = dataset.issues ?? [];
  if (made > limit && issues.length <= limit) {
    const full = v.safeParse(schema, input);
    return { success: full.success, output: full.output, issues: full.issues ?? [] };
  }
  return { success: dataset.issues === undefined, output: dataset.value as v.InferOutput<TSchema>, issues };
}
