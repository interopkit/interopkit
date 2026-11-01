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

/** The most findings that a reader or a validator lists unless the caller says otherwise. */
export const DEFAULT_MAX_FINDINGS = 1_000;

/** The `rule` of the last finding of a list that stopped at the limit. */
export const FINDINGS_STOPPED_RULE = "findings-stopped";

/** Makes the finding that ends a list that stopped at the limit: the value may have more findings than the list holds. */
function stoppedFinding(maxFindings: number): Finding {
  return {
    path: "",
    rule: FINDINGS_STOPPED_RULE,
    message: `the check stopped after ${maxFindings} findings, so there may be more.`,
  };
}

/** A list of findings that holds at most a limit, and tells the check that fills it when to stop. */
export interface FindingSink<TFinding extends Finding> {
  /** How many more findings the list takes before it is full. */
  readonly room: number;
  /** Whether a finding beyond the limit was offered, so that the check can stop looking. */
  readonly stopped: boolean;
  /** Adds findings, up to the limit; the first one beyond it is dropped and stops the list. */
  add(findings: Iterable<TFinding>): void;
  /** Returns a view that changes each finding it is given, such as the path of one entry of a batch, and fills this list. */
  within(place: (finding: TFinding) => TFinding): FindingSink<TFinding>;
  /** Returns the findings, and a last one that says the list stopped when it did. */
  list(): TFinding[];
}

/**
 * Makes a list of findings that stops at a limit, so that a value which is wrong in a million places costs the memory of a
 * limit and not of a million.
 *
 * @param maxFindings - The most findings the list holds.
 * @param stop - Makes the last finding of a list that stopped, in the type of the findings of the package.
 * @param keep - Which findings the list takes, such as the errors alone: a finding it leaves out is not counted. Default:
 * every finding.
 */
export function createFindingSink<TFinding extends Finding>(
  maxFindings: number,
  stop: (finding: Finding) => TFinding,
  keep: (finding: TFinding) => boolean = () => true,
): FindingSink<TFinding> {
  const kept: TFinding[] = [];
  let stopped = false;
  const sink: FindingSink<TFinding> = {
    get room() {
      return maxFindings - kept.length;
    },
    get stopped() {
      return stopped;
    },
    add(findings) {
      for (const finding of findings) {
        if (!keep(finding)) continue;
        if (kept.length >= maxFindings) {
          stopped = true;
          return;
        }
        kept.push(finding);
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
        add: (findings) => {
          const placed: TFinding[] = [];
          for (const finding of findings) placed.push(place(finding));
          sink.add(placed);
        },
        within: (inner) => sink.within((finding) => place(inner(finding))),
        list: () => sink.list(),
      };
    },
    list: () => (stopped ? [...kept, stop(stoppedFinding(maxFindings))] : [...kept]),
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
