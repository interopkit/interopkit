/**
 * The rules of cmi5 for the statements of a session (sections 6.3, 7.1, 9, 10.2.2 and 11 of the specification), one entry for
 * each sentence, each with a session that breaks it and what the judgement of each role finds.
 *
 * The entries are written from the sentences of the specification and the derived requirements of CATAPULT, and not from the
 * code that judges statements: the tests of the package change a sound session with `fixture` and compare what
 * `validateSessionStatements` finds (`session`) and what the LMS refuses when the unit sends the statements one request each
 * (`lms`). The runtime of a unit judges each statement that it makes by the same rules before it sends it, and skips the ones
 * that `session` finds an error in. Section numbers are those of cmi5 Quartz.
 */

/** A JSON object, such as a statement. */
type Json = Record<string, unknown>;

/** A session: the facts that `validateSessionStatements` takes, and the statements of the assignable unit in order. */
export interface Session {
  readonly facts: Json;
  readonly statements: readonly Json[];
}

/** What a judgement finds: where, which rule and how serious. */
interface ExpectedFinding {
  readonly path: string;
  readonly rule: string;
  readonly severity: "error" | "warning";
}

/** A sentence of cmi5, a session that breaks it, and what each role finds in that session. */
export interface Cmi5Rule {
  /** The section that states the rule, such as `9.3`. */
  readonly source: string;
  /** The ids that CATAPULT gives the requirement, its derived ones included. */
  readonly ids: readonly string[];
  /** What the specification says, in its words or shortened. */
  readonly text: string;
  /** Changes the sound session into one that breaks the rule. It does not change its argument. */
  readonly fixture: (session: Session) => Session;
  /** Every finding of `validateSessionStatements`, in order. Empty when it accepts the session. */
  readonly session: readonly ExpectedFinding[];
  /**
   * The indexes of the statements that the LMS refuses when the unit sends them one request each in the order of their
   * timestamps. A statement that the LMS refuses changes nothing of the session, while `validateSessionStatements` counts every
   * statement, so the two differ where a refused statement opens or closes the session.
   *
   * @defaultValue the indexes of the statements with an error in `session`
   */
  readonly lms?: readonly number[];
}

const ACTIVITY = "https://lms.example.org/courses/c1/au/1";
const PUBLISHER = "https://publisher.example.org/au/1";
const REGISTRATION = "1b0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d";
const SESSION_ID = "session-1";
const ACTOR = { objectType: "Agent", account: { homePage: "https://lms.example.org", name: "learner-1" } };
const CMI5 = "https://w3id.org/xapi/cmi5/context/categories/cmi5";
const MOVE_ON = "https://w3id.org/xapi/cmi5/context/categories/moveon";
const SESSION_EXTENSION = "https://w3id.org/xapi/cmi5/context/extensions/sessionid";
const MASTERY_EXTENSION = "https://w3id.org/xapi/cmi5/context/extensions/masteryscore";
const PROGRESS_EXTENSION = "https://w3id.org/xapi/cmi5/result/extensions/progress";
/** An extension that an LMS adds to the context template of its own accord. */
const TENANT_EXTENSION = "https://lms.example.org/xapi/extensions/tenant";

const VERBS = {
  initialized: "http://adlnet.gov/expapi/verbs/initialized",
  completed: "http://adlnet.gov/expapi/verbs/completed",
  passed: "http://adlnet.gov/expapi/verbs/passed",
  failed: "http://adlnet.gov/expapi/verbs/failed",
  terminated: "http://adlnet.gov/expapi/verbs/terminated",
  launched: "http://adlnet.gov/expapi/verbs/launched",
  satisfied: "https://w3id.org/xapi/adl/verbs/satisfied",
  experienced: "http://adlnet.gov/expapi/verbs/experienced",
  voided: "http://adlnet.gov/expapi/verbs/voided",
} as const;

/** The context template that the LMS wrote in the launch data of the session. */
const TEMPLATE = {
  contextActivities: { grouping: [{ id: PUBLISHER }] },
  extensions: { [SESSION_EXTENSION]: SESSION_ID },
};

/** A statement of the session at a minute past ten, with the context template, the registration and the categories given. */
function statement(
  n: number,
  verb: keyof typeof VERBS,
  categories: readonly string[],
  result?: Json,
  extensions?: Json,
): Json {
  return {
    id: `0b5c6d7e-8f90-4a1b-8c2d-${String(n).padStart(12, "0")}`,
    actor: ACTOR,
    verb: { id: VERBS[verb] },
    object: { objectType: "Activity", id: ACTIVITY },
    ...(result === undefined ? {} : { result }),
    context: {
      registration: REGISTRATION,
      contextActivities: {
        grouping: [{ id: PUBLISHER }],
        ...(categories.length === 0 ? {} : { category: categories.map((id) => ({ id })) }),
      },
      extensions: { [SESSION_EXTENSION]: SESSION_ID, ...extensions },
    },
    timestamp: `2026-01-15T10:${String(n).padStart(2, "0")}:00.000Z`,
  };
}

/**
 * A sound session in Normal mode with a mastery score of 0.8: initialized, an allowed statement, completed, passed with a scaled
 * score of 0.9, and terminated.
 */
export const SOUND: Session = {
  facts: {
    actor: ACTOR,
    registration: REGISTRATION,
    activityId: ACTIVITY,
    launchData: { contextTemplate: TEMPLATE, launchMode: "Normal", moveOn: "CompletedAndPassed", masteryScore: 0.8 },
  },
  statements: [
    statement(1, "initialized", [CMI5]),
    statement(2, "experienced", []),
    statement(3, "completed", [CMI5, MOVE_ON], { completion: true, duration: "PT2M" }),
    statement(
      4,
      "passed",
      [CMI5, MOVE_ON],
      { success: true, duration: "PT3M", score: { scaled: 0.9 } },
      { [MASTERY_EXTENSION]: 0.8 },
    ),
    statement(5, "terminated", [CMI5], { duration: "PT4M" }),
  ],
};

/**
 * Changes a copy of the value at a path in a statement of the session: names separated by dots, or a list of names when one
 * holds a dot, as the IRI of an extension does.
 */
function changeStatement(
  index: number,
  path: string | readonly string[],
  edit: (parent: Json, key: string) => void,
): (session: Session) => Session {
  return (session) => {
    const statements = structuredClone(session.statements) as Json[];
    const keys = typeof path === "string" ? path.split(".") : path;
    let parent = statements[index] as Json;
    for (const key of keys.slice(0, -1)) {
      parent[key] ??= {};
      parent = parent[key] as Json;
    }
    edit(parent, keys.at(-1) ?? "");
    return { ...session, statements };
  };
}

/** Sets a value in a statement of the session. */
function set(index: number, path: string | readonly string[], value: unknown): (session: Session) => Session {
  return changeStatement(index, path, (parent, key) => {
    parent[key] = value;
  });
}

/** Removes a property of a statement of the session. */
function remove(index: number, path: string | readonly string[]): (session: Session) => Session {
  return changeStatement(index, path, (parent, key) => {
    delete parent[key];
  });
}

/** Changes the facts of the session. */
function facts(change: (facts: Json) => Json): (session: Session) => Session {
  return (session) => ({ ...session, facts: change(structuredClone(session.facts)) });
}

/** Changes the launch data of the session. */
function launchData(change: Json): (session: Session) => Session {
  return facts((current) => ({ ...current, launchData: { ...(current.launchData as Json), ...change } }));
}

/** Puts a statement into the session at an index. */
function insert(index: number, added: Json): (session: Session) => Session {
  return (session) => ({
    ...session,
    statements: [...session.statements.slice(0, index), added, ...session.statements.slice(index)],
  });
}

/** Leaves the statements at the indexes out of the session. */
function drop(...indexes: readonly number[]): (session: Session) => Session {
  return (session) => ({ ...session, statements: session.statements.filter((_, index) => !indexes.includes(index)) });
}

/** Applies several changes in order. */
function all(...steps: readonly ((session: Session) => Session)[]): (session: Session) => Session {
  return (session) => steps.reduce((current, step) => step(current), session);
}

/** An error that a judgement finds. */
const error = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "error" });
/** A warning that a judgement finds. */
const warning = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "warning" });

/** The sentences of cmi5 that a session breaks, each with what the judgement finds. */
export const REFUSALS: readonly Cmi5Rule[] = [
  {
    source: "9.1",
    ids: ["9.1.0.0-1", "9.1.0.0-1 (d)"],
    text: "The AU MUST assign a statement id property in UUID format for all statements it issues.",
    fixture: remove(1, "id"),
    session: [error("[1].id", "statement-id")],
  },
  {
    source: "6.3",
    ids: ["6.3.0.0-1"],
    text: "The LMS MUST NOT provide permissions/credentials which allow the AU to issue voiding Statements.",
    fixture: all(
      set(1, "verb.id", VERBS.voided),
      set(1, "object", { objectType: "StatementRef", id: "0b5c6d7e-8f90-4a1b-8c2d-000000000003" }),
    ),
    session: [error("[1].verb.id", "voiding")],
  },
  {
    source: "9.7",
    ids: ["9.7.0.0-1", "9.7.0.0-1 (d)"],
    text: "All statements MUST include a timestamp property.",
    fixture: remove(1, "timestamp"),
    session: [error("[1].timestamp", "timestamp")],
  },
  {
    source: "9.7",
    ids: ["9.7.0.0-2", "9.7.0.0-2 (d)"],
    text: "All timestamps MUST be recorded in UTC time.",
    fixture: set(1, "timestamp", "2026-01-15T17:02:00.000+07:00"),
    session: [error("[1].timestamp", "timestamp-utc")],
  },
  {
    source: "8.1.3, 9.2",
    ids: ["8.1.3.0-3", "8.1.3.0-3 (d)", "9.2.0.0-1"],
    text: "The AU MUST use the actor value in xAPI requests that require an actor property.",
    fixture: set(1, "actor", {
      objectType: "Agent",
      account: { homePage: "https://lms.example.org", name: "learner-2" },
    }),
    session: [error("[1].actor", "actor")],
  },
  {
    source: "9.2",
    ids: ["9.2.0.0-2", "9.2.0.0-3"],
    text: "The actor property for all cmi5 defined statements MUST be of objectType Agent, and MUST contain an account property.",
    fixture: all(
      facts((current) => ({ ...current, actor: { mbox: "mailto:learner@example.org" } })),
      ...[0, 1, 2, 3, 4].map((index) => set(index, "actor", { mbox: "mailto:learner@example.org" })),
    ),
    session: [0, 2, 3, 4].map((index) => error(`[${index}].actor`, "actor-account")),
    // The LMS refuses the initialized statement, so the allowed statement after it comes before any initialized statement.
    lms: [0, 1, 2, 3, 4],
  },
  {
    source: "9.6.1",
    ids: ["9.6.1.0-1", "9.6.1.0-1 (d)", "8.1.4.0-3", "8.1.4.0-3 (d)"],
    text: "The value for the registration property used in the context object MUST be the value provided by the LMS.",
    fixture: set(2, "context.registration", "9f0e3f5c-2c4e-4f6a-9b1d-3e5f7a9c1b2d"),
    session: [error("[2].context.registration", "registration")],
  },
  {
    source: "9.6.3.1",
    ids: ["9.6.3.1-4", "9.6.3.1-4 (d)"],
    text: "An AU MUST include the session ID provided by the LMS in the context as an extension for all statements.",
    fixture: set(1, "context.extensions", { [TENANT_EXTENSION]: "t1" }),
    session: [error("[1].context.extensions", "session-id")],
  },
  {
    source: "10.2.1",
    ids: ["10.2.1.0-6", "10.2.1.0-6 (d)", "9.6.2.0-1", "9.6.2.0-1 (d)"],
    text: "The AU MUST use the contextTemplate as a template for the context property in all xAPI statements it sends.",
    fixture: set(2, "context.contextActivities.grouping", [{ id: "https://publisher.example.org/au/2" }]),
    session: [error("[2].context.contextActivities.grouping", "context-template")],
  },
  {
    source: "10.2.1",
    ids: ["10.2.1.0-7", "10.2.1.0-7 (d)"],
    text: "The AU MUST NOT overwrite any values provided in the contextTemplate.",
    fixture: all(
      launchData({
        contextTemplate: { ...TEMPLATE, extensions: { ...TEMPLATE.extensions, [TENANT_EXTENSION]: "t1" } },
      }),
      ...[0, 1, 2, 3, 4].map((index) => set(index, ["context", "extensions", TENANT_EXTENSION], "t1")),
      set(1, ["context", "extensions", TENANT_EXTENSION], "t2"),
    ),
    session: [error("[1].context.extensions", "context-template")],
  },
  {
    source: "9.3",
    ids: [
      "9.3.0.0-4",
      "9.3.0.0-4 (d1)",
      "9.3.0.0-4 (d2)",
      "9.3.2.0-2",
      "7.1.1.0-1",
      "7.1.1.0-1 (d1)",
      "7.1.1.0-1 (d2)",
      "7.1.3.0-1 (d1)",
    ],
    text: "The initialized verb MUST be the first statement (cmi5 allowed or defined).",
    fixture: set(1, "timestamp", "2026-01-15T10:00:00.000Z"),
    session: [error("[1].verb.id", "before-initialized")],
  },
  {
    source: "9.3",
    ids: [
      "9.3.0.0-5",
      "9.3.0.0-5 (d1)",
      "9.3.0.0-5 (d2)",
      "9.3.8.0-1",
      "7.1.2.0-1",
      "7.1.2.0-1 (d1)",
      "7.1.2.0-1 (d2)",
      "7.1.3.0-1 (d2)",
    ],
    text: "The terminated verb MUST be the last statement (cmi5 allowed or defined).",
    fixture: set(1, "timestamp", "2026-01-15T10:06:00.000Z"),
    session: [error("[1].verb.id", "after-terminated")],
  },
  {
    source: "9.3",
    ids: ["9.3.0.0-1"],
    text: "AUs MUST use the verbs indicated as mandatory: a cmi5 defined statement has one of the verbs of an AU.",
    fixture: set(1, "context.contextActivities.category", [{ id: CMI5 }]),
    session: [error("[1].verb.id", "au-verb")],
  },
  {
    source: "9.3.1",
    ids: ["9.3.1.0-1"],
    text: "The LMS MUST use the launched verb: an AU does not send it.",
    fixture: all(set(1, "verb.id", VERBS.launched), set(1, "context.contextActivities.category", [{ id: CMI5 }])),
    session: [error("[1].verb.id", "au-verb")],
  },
  {
    source: "9.3",
    ids: ["9.3.0.0-2", "9.3.0.0-2 (d)", "9.3.2.0-3", "9.3.2.0-3 (d)"],
    text: "Verbs MUST NOT be duplicated (in cmi5 defined statements) within an AU session.",
    fixture: insert(2, {
      ...statement(1, "initialized", [CMI5]),
      id: "0b5c6d7e-8f90-4a1b-8c2d-000000000099",
      timestamp: "2026-01-15T10:02:30.000Z",
    }),
    session: [error("[2].verb.id", "verb-repeated")],
  },
  {
    source: "9.3",
    ids: ["9.3.0.0-3", "9.3.0.0-3 (d)"],
    text: "More than one of the set of {passed, failed} verbs MUST NOT be used (in cmi5 defined statements).",
    fixture: insert(4, {
      ...statement(4, "failed", [CMI5, MOVE_ON], { success: false, duration: "PT3M" }),
      id: "0b5c6d7e-8f90-4a1b-8c2d-000000000098",
    }),
    session: [error("[4].verb.id", "passed-and-failed"), error("[4].verb.id", "failed-after-passed")],
  },
  {
    source: "9.3",
    ids: ["9.3.0.0-6", "9.3.0.0-6 (d1)", "9.3.0.0-6 (d2)", "9.3.3.0-2"],
    text: "Exactly zero or one completed cmi5 defined statement MUST be used per registration.",
    fixture: facts((current) => ({ ...current, prior: { completed: true } })),
    session: [error("[2].verb.id", "completed-in-registration")],
  },
  {
    source: "9.3",
    ids: ["9.3.0.0-7", "9.3.0.0-7 (d1)", "9.3.0.0-7 (d2)", "9.3.4.0-3"],
    text: "Exactly zero or one passed cmi5 defined statement MUST be used per registration.",
    fixture: facts((current) => ({ ...current, prior: { passed: true } })),
    session: [error("[3].verb.id", "passed-in-registration")],
  },
  {
    source: "9.3",
    ids: ["9.3.0.0-8", "9.3.0.0-8 (d)"],
    text: "A failed statement MUST NOT follow a passed statement (in cmi5 defined statements) per registration.",
    fixture: all(
      facts((current) => ({ ...current, prior: { passed: true } })),
      set(3, "verb.id", VERBS.failed),
      set(3, "result", { success: false, duration: "PT3M", score: { scaled: 0.5 } }),
    ),
    session: [error("[3].verb.id", "failed-after-passed")],
  },
  {
    source: "9.4",
    ids: ["8.1.5.0-6", "8.1.5.0-6 (d)", "9.4.0.0-1", "9.4.0.0-1 (d)", "9.4.0.0-2"],
    text: "The value of the Object's id property for a given AU MUST match the activityId defined in the launch URL.",
    fixture: set(2, "object.id", PUBLISHER),
    session: [error("[2].object", "object")],
  },
  {
    source: "10.2.2",
    ids: ["10.2.2.0-1", "10.2.2.0-1 (d)", "10.2.2.0-2", "10.2.2.0-2 (d)", "10.2.2.0-6", "10.2.2.0-7", "10.2.2.0-10"],
    text: "Browse: the AU MUST NOT send other cmi5 defined statements than initialized and terminated.",
    fixture: launchData({ launchMode: "Browse" }),
    session: [error("[2].verb.id", "launch-mode"), error("[3].verb.id", "launch-mode")],
  },
  {
    source: "10.2.2",
    ids: ["10.2.2.0-3", "10.2.2.0-3 (d)", "10.2.2.0-5", "10.2.2.0-5 (d)", "10.2.2.0-8", "10.2.2.0-9", "10.2.2.0-11"],
    text: "Review: the AU MUST NOT send other cmi5 defined statements than initialized and terminated.",
    fixture: launchData({ launchMode: "Review" }),
    session: [error("[2].verb.id", "launch-mode"), error("[3].verb.id", "launch-mode")],
  },
  {
    source: "9.5.2",
    ids: ["9.5.2.0-1", "9.5.2.0-1 (d1)"],
    text: "The success property of the result MUST be set to true for passed.",
    fixture: set(3, "result.success", false),
    session: [error("[3].result.success", "result-success")],
  },
  {
    source: "9.5.2",
    ids: ["9.5.2.0-2", "9.5.2.0-2 (d)"],
    text: "The success property of the result MUST be set to false for failed.",
    fixture: all(set(3, "verb.id", VERBS.failed), set(3, "result", { success: true, duration: "PT3M" })),
    session: [error("[3].result.success", "result-success")],
  },
  {
    source: "9.5.2",
    ids: ["9.5.2.0-3", "9.5.2.0-3 (d)"],
    text: "cmi5 defined statements, other than passed, waived or failed, MUST NOT include the success property.",
    fixture: set(4, "result.success", true),
    session: [
      error("[4].context.contextActivities.category", "move-on-category"),
      error("[4].result.success", "result-success"),
    ],
  },
  {
    source: "9.5.3",
    ids: ["9.5.3.0-1", "9.5.3.0-1 (d1)"],
    text: "The completion property of the result MUST be set to true for completed.",
    fixture: remove(2, "result.completion"),
    session: [
      error("[2].context.contextActivities.category", "move-on-category"),
      error("[2].result.completion", "result-completion"),
    ],
  },
  {
    source: "9.5.3",
    ids: ["9.5.3.0-2", "9.5.3.0-2 (d)"],
    text: "cmi5 defined statements, other than completed or waived, MUST NOT include the completion property.",
    fixture: set(3, "result.completion", true),
    session: [error("[3].result.completion", "result-completion")],
  },
  {
    source: "9.5.4.1",
    ids: ["9.5.4.1-1", "9.5.4.1-1 (d)"],
    text: "The AU MUST include the duration property in terminated statements.",
    fixture: remove(4, "result"),
    session: [error("[4].result.duration", "result-duration")],
  },
  {
    source: "9.5.4.1",
    ids: ["9.5.4.1-2", "9.5.4.1-2 (d)"],
    text: "The AU MUST include the duration property in completed statements.",
    fixture: remove(2, "result.duration"),
    session: [error("[2].result.duration", "result-duration")],
  },
  {
    source: "9.5.4.1",
    ids: ["9.5.4.1-3", "9.5.4.1-3 (d)"],
    text: "The AU MUST include the duration property in passed statements.",
    fixture: remove(3, "result.duration"),
    session: [error("[3].result.duration", "result-duration")],
  },
  {
    source: "9.5.4.1",
    ids: ["9.5.4.1-4", "9.5.4.1-4 (d)"],
    text: "The AU MUST include the duration property in failed statements.",
    fixture: all(set(3, "verb.id", VERBS.failed), set(3, "result", { success: false, score: { scaled: 0.5 } })),
    session: [error("[3].result.duration", "result-duration")],
  },
  {
    source: "9.5.1",
    ids: ["9.5.1.0-2", "9.5.1.0-2 (d)"],
    text: "cmi5 defined statements, other than passed or failed, MUST NOT include the score property.",
    fixture: set(2, "result.score", { scaled: 0.5 }),
    session: [error("[2].result.score", "result-score")],
  },
  {
    source: "9.5.1",
    ids: ["9.5.1.0-3", "9.5.1.0-3 (d1)", "9.5.1.0-3 (d2)"],
    text: "The AU MUST provide the min and max values for score object when the raw value is provided.",
    fixture: set(3, "result.score", { scaled: 0.9, raw: 9 }),
    session: [error("[3].result.score", "score-range")],
  },
  {
    source: "9.5.1",
    ids: ["9.5.1.0-3"],
    text: "raw, min and max are integer values.",
    fixture: set(3, "result.score", { scaled: 0.9, raw: 9.5, min: 0, max: 10 }),
    session: [error("[3].result.score", "score-range")],
  },
  {
    source: "9.3.4",
    ids: ["9.3.4.0-2", "9.3.4.0-2 (d1)", "9.3.4.0-2 (d2)", "9.5.1.0-1", "10.2.4.0-2"],
    text: "If the passed statement contains a scaled score, the scaled value MUST be equal to or greater than the masteryScore.",
    fixture: set(3, "result.score.scaled", 0.79),
    session: [error("[3].result.score.scaled", "mastery-score")],
  },
  {
    source: "9.3.5",
    ids: ["9.3.5.0-2", "9.3.5.0-2 (d)"],
    text: "If the failed statement contains a scaled score, the scaled score MUST be less than the masteryScore.",
    fixture: all(
      set(3, "verb.id", VERBS.failed),
      set(3, "result", { success: false, duration: "PT3M", score: { scaled: 0.8 } }),
    ),
    session: [error("[3].result.score.scaled", "mastery-score")],
  },
  {
    source: "9.6.3.2",
    ids: ["9.6.3.2-2", "9.6.3.2-2 (d)"],
    text: "An AU MUST include the masteryScore value provided by the LMS in the context for passed or failed statements it makes based on the masteryScore.",
    fixture: remove(3, ["context", "extensions", MASTERY_EXTENSION]),
    session: [error("[3].context.extensions", "mastery-extension")],
  },
  {
    source: "9.6.2.2",
    ids: ["9.6.2.2-1", "9.6.2.2-1 (d1)", "9.6.2.2-1 (d2)", "9.6.2.2-1 (d3)"],
    text: "cmi5 defined statements with a result that includes success or completion MUST have the moveOn category activity.",
    fixture: set(3, "context.contextActivities.category", [{ id: CMI5 }]),
    session: [error("[3].context.contextActivities.category", "move-on-category")],
  },
  {
    source: "9.6.2.2",
    ids: ["9.6.2.2-2", "9.6.2.2-2 (d)"],
    text: "Other statements MUST NOT include the moveOn category activity.",
    fixture: set(0, "context.contextActivities.category", [{ id: CMI5 }, { id: MOVE_ON }]),
    session: [error("[0].context.contextActivities.category", "move-on-category")],
    // The LMS refuses the initialized statement, so every statement after it comes before any initialized statement.
    lms: [0, 1, 2, 3, 4],
  },
  {
    source: "9.5.5.1",
    ids: [],
    text: "progress is an integer value between 0 and 100 (inclusive).",
    fixture: set(1, "result", { extensions: { [PROGRESS_EXTENSION]: 101 } }),
    session: [error("[1].result.extensions", "progress")],
  },
  {
    source: "9.5.5.1",
    ids: [],
    text: "The AU SHOULD NOT set a progress value in a completed statement.",
    fixture: set(2, "result", { completion: true, duration: "PT2M", extensions: { [PROGRESS_EXTENSION]: 100 } }),
    session: [warning("[2].result.extensions", "progress")],
  },
  {
    source: "11.0",
    ids: ["11.0.0.0-3", "11.0.0.0-3 (d1)", "11.0.0.0-3 (d2)"],
    text: "The AU MUST retrieve the Learner Preferences document from the Agent Profile on startup.",
    fixture: facts((current) => ({ ...current, preferencesRead: false })),
    session: [error("[0].verb.id", "preferences-unread")],
    // The LMS refuses the initialized statement, so every statement after it comes before any initialized statement.
    lms: [0, 1, 2, 3, 4],
  },
];

/** Sessions that keep every rule, which the judgement of each role accepts. */
export const ACCEPTANCES: readonly { readonly text: string; readonly fixture: (session: Session) => Session }[] = [
  { text: "The sound session.", fixture: (session) => session },
  {
    text: "The statements in another order than their timestamps.",
    fixture: (session) => ({ ...session, statements: [...session.statements].reverse() }),
  },
  {
    text: "Browse and Review with initialized, allowed statements and terminated.",
    fixture: all(launchData({ launchMode: "Browse" }), drop(2, 3)),
  },
  {
    text: "A failed statement with a scaled score below the mastery score, and a raw score between integer bounds.",
    fixture: all(
      set(3, "verb.id", VERBS.failed),
      set(3, "result", { success: false, duration: "PT3M", score: { scaled: 0.5, raw: 5, min: 0, max: 10 } }),
    ),
  },
  {
    text: "A passed statement without a score, and no mastery score in the launch data.",
    fixture: all(
      launchData({ masteryScore: undefined }),
      set(3, "result", { success: true, duration: "PT3M" }),
      remove(3, ["context", "extensions", MASTERY_EXTENSION]),
    ),
  },
  {
    text: "Statements timestamped at one instant, which need not be unique within a session (9.7).",
    fixture: (session) => ({
      ...session,
      statements: session.statements.map((current) => ({ ...current, timestamp: "2026-01-15T10:01:00.000Z" })),
    }),
  },
  {
    text: "Values that an AU adds to the context of the template, and a progress below 100.",
    fixture: all(
      set(1, "context.contextActivities.parent", [{ id: "https://lms.example.org/courses/c1" }]),
      set(1, "result", { extensions: { [PROGRESS_EXTENSION]: 50 } }),
    ),
  },
  { text: "A session without a terminated statement, which the LMS abandons.", fixture: drop(4) },
  {
    text: "A satisfied statement is the LMS's, and a statement of it without the category of cmi5 is allowed.",
    fixture: set(1, "verb.id", VERBS.satisfied),
  },
];
