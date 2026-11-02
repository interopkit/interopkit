/**
 * The rules of the xAPI base standard (IEEE 9274.1.1, the LRS and Content books) that a reader of Statements applies, one
 * entry for each sentence of the standard, each with a Statement that breaks it and what a reader of each role finds.
 *
 * The entries are written from the tables and the sentences of the standard, and not from the code that reads Statements:
 * the tests of the package change a sound Statement with `fixture` and compare what the readers find with `lrs` and `provider`.
 * Section numbers are those of the LRS book (4.x) and the Content book (5.x).
 */

/** A JSON object, such as a Statement. */
export type Json = Record<string, unknown>;

/** What a reader finds: where, which rule and how serious. */
interface ExpectedFinding {
  readonly path: string;
  readonly rule: string;
  readonly severity: "error" | "warning";
}

/** A sentence of the standard, a Statement that breaks it, and what the reader of each role finds in that Statement. */
export interface XapiRule {
  /** The section of the standard that states the rule, such as `LRS 4.2.1`. */
  readonly source: string;
  /** What the standard says, in its words or shortened. */
  readonly text: string;
  /** Changes a sound Statement of a provider into one that breaks the rule. It does not change its argument. */
  readonly fixture: (statement: Json) => Json;
  /** Every finding of the reader of an LRS, in order. Empty when an LRS accepts the Statement. */
  readonly lrs: readonly ExpectedFinding[];
  /** Every finding of the reader of a Learning Record Provider, in order. */
  readonly provider: readonly ExpectedFinding[];
}

/** Changes a copy of a Statement at a path of names and indexes, separated by dots: `context.contextAgents.0.agent`. */
function change(path: string, edit: (parent: Json, key: string) => void): (statement: Json) => Json {
  return (statement) => {
    const copy = structuredClone(statement);
    const keys = path.split(".");
    let parent: Json = copy;
    for (const key of keys.slice(0, -1)) {
      parent[key] ??= {};
      parent = parent[key] as Json;
    }
    edit(parent, keys.at(-1) ?? "");
    return copy;
  };
}

/** Sets the value at a path, making the objects on the way when there are none. */
export function set(path: string, value: unknown): (statement: Json) => Json {
  return change(path, (parent, key) => {
    parent[key] = value;
  });
}

/** Removes the property at a path. */
export function remove(path: string): (statement: Json) => Json {
  return change(path, (parent, key) => {
    delete parent[key];
  });
}

/** Applies several changes in order. */
export function all(...steps: readonly ((statement: Json) => Json)[]): (statement: Json) => Json {
  return (statement) => steps.reduce((current, step) => step(current), statement);
}

/**
 * Sets the Object of a Statement. An Object that is not an Activity leaves out the `revision` and `platform` of the context,
 * which describe an Activity, so that a fixture about the Object has no other fault.
 */
export function withObject(value: unknown): (statement: Json) => Json {
  return all(set("object", value), remove("context.revision"), remove("context.platform"));
}

/** An error that a reader finds. */
export const error = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "error" });
/** A warning that a reader finds. */
export const warning = (path: string, rule: string): ExpectedFinding => ({ path, rule, severity: "warning" });

/** A rule with the same findings for both roles. */
export function both(
  source: string,
  text: string,
  fixture: (statement: Json) => Json,
  findings: readonly ExpectedFinding[],
): XapiRule {
  return { source, text, fixture, lrs: findings, provider: findings };
}

/** A rule that only a Learning Record Provider is held to, or that the roles judge differently. */
export function roles(
  source: string,
  text: string,
  fixture: (statement: Json) => Json,
  lrs: readonly ExpectedFinding[],
  provider: readonly ExpectedFinding[],
): XapiRule {
  return { source, text, fixture, lrs, provider };
}

/** The IRI of the Verb that voids a Statement. */
export const VOIDED = "http://adlnet.gov/expapi/verbs/voided";

/** The rules that a Statement breaks and a reader reports. */
export const REFUSALS: readonly XapiRule[] = [
  roles(
    "ADL suite 2.0, from Data 2.4.6 of 1.0.3",
    "The revision and platform of a context describe an Activity: a Statement whose Object is another kind does not have them.",
    set("object", { objectType: "Agent", mbox: "mailto:a@example.org" }),
    [error("context.revision", "context-needs-activity"), error("context.platform", "context-needs-activity")],
    [error("context.revision", "context-needs-activity"), error("context.platform", "context-needs-activity")],
  ),
  roles(
    "ADL suite 2.0, from Data 2.4.2 of 1.0.3",
    "An authority that is a Group is anonymous and has two Agents: one Agent is not enough.",
    set("authority", { objectType: "Group", member: [{ mbox: "mailto:a@example.org" }] }),
    [error("authority", "authority-group")],
    [error("authority", "authority-group"), warning("authority", "lrs-managed-property")],
  ),
  roles(
    "ADL suite 2.0, from Data 2.4.2 of 1.0.3",
    "An authority that is a Group of three Agents is refused too.",
    set("authority", {
      objectType: "Group",
      member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }, { mbox: "mailto:c@example.org" }],
    }),
    [error("authority", "authority-group")],
    [error("authority", "authority-group"), warning("authority", "lrs-managed-property")],
  ),
  roles(
    "ADL suite 2.0, from Data 2.4.2 of 1.0.3",
    "An authority that is an identified Group is refused.",
    set("authority", {
      objectType: "Group",
      mbox: "mailto:team@example.org",
      member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }],
    }),
    [error("authority", "authority-group")],
    [error("authority", "authority-group"), warning("authority", "lrs-managed-property")],
  ),
  both("LRS 4.2.1", "The LRS shall reject Statements missing any required properties: actor.", remove("actor"), [
    error("actor", "missing-property"),
  ]),
  both("LRS 4.2.1", "Missing any required properties: verb.", remove("verb"), [error("verb", "missing-property")]),
  both("LRS 4.2.1", "Missing any required properties: object.", remove("object"), [
    error("object", "missing-property"),
  ]),
  both("LRS 4.2.2.2", "A Verb needs an id.", remove("verb.id"), [error("verb.id", "missing-property")]),
  both("LRS 4.2.2.3", "An Activity needs an id.", remove("object.id"), [error("object.id", "missing-property")]),
  both("LRS 4.2.2.1", "An Account needs a homePage.", set("actor", { account: { name: "learner" } }), [
    error("actor.account.homePage", "missing-property"),
  ]),
  both("LRS 4.2.2.1", "An Account needs a name.", set("actor", { account: { homePage: "https://lms.example.org" } }), [
    error("actor.account.name", "missing-property"),
  ]),
  both("LRS 4.2.2.6", "An Attachment needs a sha2.", remove("attachments.0.sha2"), [
    error("attachments[0].sha2", "missing-property"),
  ]),
  both("LRS 4.2.2.3", "A Statement Reference needs an id.", set("context.statement", { objectType: "StatementRef" }), [
    error("context.statement.id", "missing-property"),
  ]),
  both(
    "LRS 4.2.2.5",
    "A contextAgent needs an agent.",
    set("context.contextAgents", [{ objectType: "contextAgent" }]),
    [error("context.contextAgents[0].agent", "missing-property")],
  ),
  both("LRS 4.2.1", "The LRS shall reject a Statement with additional properties: the Statement.", set("extra", 1), [
    error("extra", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: the Actor.", set("actor.nickname", "Ex"), [
    error("actor.nickname", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: the Verb.", set("verb.alias", "Ex"), [
    error("verb.alias", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: the Activity.", set("object.title", "Ex"), [
    error("object.title", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: the Activity Definition.", set("object.definition.title", "Ex"), [
    error("object.definition.title", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: the Result.", set("result.grade", "A"), [
    error("result.grade", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: the Score.", set("result.score.points", 1), [
    error("result.score.points", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: the Context.", set("context.venue", "Ex"), [
    error("context.venue", "unknown-property"),
  ]),
  both("LRS 4.2.1", "Additional properties: an Attachment.", set("attachments.0.title", "Ex"), [
    error("attachments[0].title", "unknown-property"),
  ]),
  both(
    "LRS 4.2.1",
    "Additional properties: a contextActivities key other than the four.",
    set("context.contextActivities.sibling", []),
    [error("context.contextActivities.sibling", "unknown-property")],
  ),
  both(
    "LRS 4.2.1",
    "The LRS shall reject Statements with any null values: a property of the Result.",
    set("result.success", null),
    [error("result.success", "wrong-type")],
  ),
  both("LRS 4.2.1", "Null values: a property of the Context.", set("context.revision", null), [
    error("context.revision", "wrong-type"),
  ]),
  both(
    "LRS 4.2.1",
    "Strings where numbers are required, even if those strings contain numbers.",
    set("result.score.raw", "8"),
    [error("result.score.raw", "wrong-type")],
  ),
  both(
    "LRS 4.2.1",
    "Strings where booleans are required, even if those strings contain booleans.",
    set("result.completion", "true"),
    [error("result.completion", "wrong-type")],
  ),
  both("LRS 4.2.1", "The wrong data type: an array where an object is.", set("verb", []), [
    error("verb", "wrong-type"),
  ]),
  both(
    "LRS 4.2.1",
    "Any non-format-following value, including the empty string, where a UUID is required.",
    set("id", ""),
    [error("id", "invalid-format")],
  ),
  both("LRS 4.2.1", "The empty string where a mailto IRI is required.", set("actor.mbox", ""), [
    error("actor.mbox", "invalid-format"),
  ]),
  both("LRS 4.2.1", "The empty string where an IRI is required.", set("verb.id", ""), [
    error("verb.id", "invalid-format"),
  ]),
  both(
    "LRS 4.2.1",
    "Where the case of a key does not match the case specified.",
    all(remove("actor.name"), set("actor.Name", "Ex")),
    [error("actor.Name", "unknown-property")],
  ),
  both(
    "LRS 4.2.1",
    "Where the case of a value restricted to enumerated values does not match: objectType.",
    set("actor.objectType", "agent"),
    [error("actor.objectType", "invalid-value")],
  ),
  both(
    "LRS 4.2.1",
    "The case of an enumerated value: interactionType.",
    set("object.definition.interactionType", "Choice"),
    [error("object.definition.interactionType", "invalid-value")],
  ),
  both("LRS 4.2.1", "Containing IRL or IRI values without a scheme: the id of a Verb.", set("verb.id", "completed"), [
    error("verb.id", "invalid-format"),
  ]),
  both("LRS 4.2.1", "IRI values without a scheme: the id of an Activity.", set("object.id", "activities/course-1"), [
    error("object.id", "invalid-format"),
  ]),
  both("LRS 4.2.1", "IRL values without a scheme: moreInfo.", set("object.definition.moreInfo", "info.html"), [
    error("object.definition.moreInfo", "invalid-format"),
  ]),
  both(
    "LRS 4.2.1",
    "IRL values without a scheme: the homePage of an Account.",
    set("actor", { account: { homePage: "lms.example.org", name: "learner" } }),
    [error("actor.account.homePage", "invalid-format")],
  ),
  both(
    "LRS 4.2.1",
    "IRI values without a scheme: the usageType of an Attachment.",
    set("attachments.0.usageType", "signature"),
    [error("attachments[0].usageType", "invalid-format")],
  ),
  both(
    "LRS 4.2.4.2",
    "The LRS shall reject Statements if the Actor object contains more than one Inverse Functional Identifier.",
    set("actor.openid", "https://openid.example.org/learner"),
    [error("actor", "identifier-count")],
  ),
  both("LRS 4.2.2.1", "Exactly one of mbox, mbox_sha1sum, openid, account is required.", remove("actor.mbox"), [
    error("actor", "identifier-count"),
  ]),
  both("LRS 4.2.2.1", "An anonymous Group needs its members.", set("actor", { objectType: "Group" }), [
    error("actor.member", "missing-property"),
  ]),
  both(
    "LRS 4.2.2.1",
    "An identified Group has exactly one identifier.",
    set("actor", { objectType: "Group", mbox: "mailto:g@example.org", openid: "https://openid.example.org/g" }),
    [error("actor", "identifier-count")],
  ),
  both(
    "LRS 4.2.4.2",
    "The LRS shall reject Statements which use an Agent of type Group within the member property of a Group.",
    set("actor", { objectType: "Group", member: [{ objectType: "Group", mbox: "mailto:g@example.org" }] }),
    [error("actor.member[0].objectType", "invalid-value")],
  ),
  both("LRS 4.2.1", "The mailto IRI is mailto: and an email address.", set("actor.mbox", "learner@example.org"), [
    error("actor.mbox", "invalid-format"),
  ]),
  both(
    "LRS 4.2.2.1",
    "mbox_sha1sum is the hex-encoded SHA1 hash of a mailto IRI.",
    set("actor", { mbox_sha1sum: "abc" }),
    [error("actor.mbox_sha1sum", "invalid-format")],
  ),
  both(
    "LRS 4.2.2.3",
    "The objectType of a Statement Reference is StatementRef.",
    withObject({ objectType: "StatementReference", id: "00000000-0000-4000-8000-000000000009" }),
    [error("object.objectType", "invalid-value")],
  ),
  both(
    "LRS 4.2.2.3",
    "Any Object without an objectType is an Activity.",
    withObject({ mbox: "mailto:classmate@example.org" }),
    [error("object.id", "missing-property"), error("object.mbox", "unknown-property")],
  ),
  both(
    "LRS 4.2.4.2",
    "The LRS shall reject a Statement that uses an Interaction Activity without a valid interactionType.",
    set("object.definition.interactionType", "multiple"),
    [error("object.definition.interactionType", "invalid-value")],
  ),
  both(
    "LRS 4.2.4.2",
    "An Interaction Activity without an interactionType: a correctResponsesPattern alone.",
    all(remove("object.definition.interactionType"), remove("object.definition.choices")),
    [error("object.definition.interactionType", "missing-property")],
  ),
  both(
    "LRS 4.2.4.2",
    "An Interaction Activity without an interactionType: a list of components alone.",
    all(remove("object.definition.interactionType"), remove("object.definition.correctResponsesPattern")),
    [error("object.definition.interactionType", "missing-property")],
  ),
  both(
    "LRS 4.2.2.3",
    "Each component of a list has an id.",
    set("object.definition.choices", [{ description: { "en-US": "Golf" } }]),
    [error("object.definition.choices[0].id", "missing-property")],
  ),
  both(
    "LRS 4.2.4.2",
    "The LRS shall reject a Statement with an Object with ObjectType SubStatement that has within it an Object with ObjectType SubStatement.",
    withObject({
      objectType: "SubStatement",
      actor: { mbox: "mailto:a@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/asked" },
      object: {
        objectType: "SubStatement",
        actor: { mbox: "mailto:b@example.org" },
        verb: { id: "http://adlnet.gov/expapi/verbs/answered" },
        object: { id: "https://example.org/activities/quiz-1" },
      },
    }),
    [error("object.object.objectType", "invalid-value")],
  ),
  both(
    "LRS 4.2.2.3",
    "A SubStatement has no id.",
    withObject({
      objectType: "SubStatement",
      id: "00000000-0000-4000-8000-000000000009",
      actor: { mbox: "mailto:a@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/asked" },
      object: { id: "https://example.org/activities/quiz-1" },
    }),
    [error("object.id", "unknown-property")],
  ),
  both(
    "LRS 4.2.7",
    "The LRS shall reject any Statement where a key of an extensions map is not an IRI.",
    set("result.extensions", { "not an iri": 1 }),
    [error('result.extensions["not an iri"]', "invalid-format")],
  ),
  both("LRS 4.2.7", "A key of an extensions map is an IRI: the context.", set("context.extensions", { attempts: 1 }), [
    error("context.extensions.attempts", "invalid-format"),
  ]),
  both(
    "LRS 4.2.7",
    "A key of an extensions map is an IRI: the Activity Definition.",
    set("object.definition.extensions", { difficulty: 3 }),
    [error("object.definition.extensions.difficulty", "invalid-format")],
  ),
  both(
    "LRS 4.2.7",
    "An LRS shall reject a Statement with invalid RFC 5646 language tags: a language map of a Verb.",
    set("verb.display", { en_US: "answered" }),
    [error("verb.display.en_US", "invalid-format")],
  ),
  both(
    "LRS 4.2.7",
    "Invalid language tags: a language map of an Activity.",
    set("object.definition.name", { "en-": "Question" }),
    [error('object.definition.name["en-"]', "invalid-format")],
  ),
  both("LRS 4.2.7", "Invalid language tags: the language of the context.", set("context.language", "english_us"), [
    error("context.language", "invalid-format"),
  ]),
  both("LRS 4.2.7", "A language map holds strings.", set("verb.display", { "en-US": 1 }), [
    error("verb.display", "invalid-value"),
  ]),
  both("LRS 4.2.7", "UUIDs shall be in the standard string form: id.", set("id", "not-a-uuid"), [
    error("id", "invalid-format"),
  ]),
  both(
    "LRS 4.2.7",
    "UUIDs in the standard string form: registration.",
    set("context.registration", "0000000040008000000000000002"),
    [error("context.registration", "invalid-format")],
  ),
  both(
    "LRS 4.2.7",
    "UUIDs in the standard string form: the id of a Statement Reference.",
    set("context.statement.id", "xyz"),
    [error("context.statement.id", "invalid-format")],
  ),
  both("LRS 4.2.7", "A Timestamp is formatted according to RFC 3339: a date alone.", set("timestamp", "2024-06-13"), [
    error("timestamp", "invalid-format"),
  ]),
  both("LRS 4.2.7", "RFC 3339 needs the offset: a time without one.", set("timestamp", "2024-06-13T18:46:03"), [
    error("timestamp", "invalid-format"),
  ]),
  both("LRS 4.2.7", "A date that does not exist.", set("timestamp", "2024-02-30T10:00:00Z"), [
    error("timestamp", "invalid-format"),
  ]),
  both("LRS 4.2.7", "Stored is a Timestamp.", set("stored", "yesterday"), [error("stored", "invalid-format")]),
  both(
    "LRS 4.2.7",
    "The LRS shall reject a Statement if the duration is not the format of ISO 8601 4.4.3.2: a clock.",
    set("result.duration", "01:30:00"),
    [error("result.duration", "invalid-format")],
  ),
  both(
    "LRS 4.2.7",
    "An LRS shall reject Statements with the alternative format of ISO 8601 4.4.3.3.",
    set("result.duration", "P0000-00-00T01:30:00"),
    [error("result.duration", "invalid-format")],
  ),
  both("LRS 4.2.7", "A duration has a component: P alone.", set("result.duration", "P"), [
    error("result.duration", "invalid-format"),
  ]),
  both("LRS 4.2.7", "A duration with a T has a time component.", set("result.duration", "P1DT"), [
    error("result.duration", "invalid-format"),
  ]),
  both("LRS 4.2.7", "Only the smallest component of a duration has a fraction.", set("result.duration", "PT1.5H30M"), [
    error("result.duration", "invalid-format"),
  ]),
  both("LRS 4.2.2.4", "The scaled score is between -1 and 1, inclusive: above.", set("result.score.scaled", 1.5), [
    error("result.score.scaled", "out-of-range"),
  ]),
  both("LRS 4.2.2.4", "The scaled score is between -1 and 1, inclusive: below.", set("result.score.scaled", -1.01), [
    error("result.score.scaled", "out-of-range"),
  ]),
  both("LRS 4.2.2.4", "The raw score is between min and max: above max.", set("result.score.raw", 11), [
    error("result.score.raw", "out-of-range"),
  ]),
  both("LRS 4.2.2.4", "The raw score is between min and max: below min.", set("result.score.raw", -1), [
    error("result.score.raw", "out-of-range"),
  ]),
  both(
    "LRS 4.2.2.4",
    "The lowest possible score is less than max.",
    all(set("result.score.min", 10), set("result.score.raw", 10)),
    [error("result.score.min", "out-of-range")],
  ),
  both(
    "LRS 4.2.5",
    "The LRS shall reject Statements with the voided verb when the objectType is not StatementRef.",
    set("verb.id", VOIDED),
    [error("object", "voiding-target")],
  ),
  both(
    "LRS 4.2.5",
    "The voided verb when the Statement Reference has no id.",
    all(set("verb.id", VOIDED), withObject({ objectType: "StatementRef" })),
    [error("object.id", "missing-property")],
  ),
  both(
    "LRS 4.2.2.5",
    "relevantTypes holds one or more IRIs when it is present.",
    set("context.contextAgents.0.relevantTypes", []),
    [error("context.contextAgents[0].relevantTypes", "too-few-entries")],
  ),
  both("LRS 4.2.2.5", "The relevant types are IRIs.", set("context.contextGroups.0.relevantTypes", ["proctor"]), [
    error("context.contextGroups[0].relevantTypes[0]", "invalid-format"),
  ]),
  both(
    "LRS 4.2.2.5",
    "The objectType of a contextGroup is contextGroup.",
    set("context.contextGroups.0.objectType", "contextAgent"),
    [error("context.contextGroups[0].objectType", "invalid-value")],
  ),
  both("LRS 4.2.2.6", "The contentType is an Internet media type.", set("attachments.0.contentType", "octet stream"), [
    error("attachments[0].contentType", "invalid-format"),
  ]),
  both("LRS 4.2.2.6", "The length is an integer.", set("attachments.0.length", 12.5), [
    error("attachments[0].length", "invalid-format"),
  ]),
  both("LRS 4.2.2.6", "The length of the data in octets is not negative.", set("attachments.0.length", -1), [
    error("attachments[0].length", "invalid-format"),
  ]),
  both("LRS 4.2.2.6", "The sha2 is a SHA-2 hash.", set("attachments.0.sha2", "not a hash"), [
    error("attachments[0].sha2", "invalid-format"),
  ]),
  both("LRS 4.2.2.6", "The display of an Attachment is a language map.", set("attachments.0.display", "Signature"), [
    error("attachments[0].display", "wrong-type"),
  ]),
  both("LRS 4.2.2.5", "The team of a context is a Group.", set("context.team", { mbox: "mailto:t@example.org" }), [
    error("context.team.objectType", "missing-property"),
  ]),
];

/** The pattern of a response of an interaction, in a definition that is otherwise sound. */
export function pattern(
  interactionType: string,
  correctResponsesPattern: readonly string[],
  extra: Json = {},
): (statement: Json) => Json {
  return set("object.definition", { interactionType, correctResponsesPattern, ...extra });
}

const PATTERN = "object.definition.correctResponsesPattern[0]";

/**
 * The forms of the response patterns of each type of interaction, which a reader of either role finds as a warning, since an LRS
 * does not validate patterns: the table of response patterns, which xAPI 2.0 (LRS 4.2.2.3) keeps from 1.0.3 (Data 2.4.4.1).
 *
 * @param source - The section of the standard that the entries cite.
 */
export function responsePatternRules(source: string): readonly XapiRule[] {
  const badPattern = (text: string, fixture: (statement: Json) => Json): XapiRule =>
    both(source, text, fixture, [warning(PATTERN, "response-pattern")]);
  return [
    badPattern("true-false: either true or false.", pattern("true-false", ["yes"])),
    badPattern(
      "choice: a list of item ids; no empty item.",
      pattern("choice", ["golf[,][,]tetris"], { choices: [{ id: "golf" }, { id: "tetris" }] }),
    ),
    badPattern(
      "sequencing: an ordered list of item ids; no empty item.",
      pattern("sequencing", ["[,]tim"], { choices: [{ id: "tim" }] }),
    ),
    badPattern(
      "likert: a single item id, so the delimiter is not used.",
      pattern("likert", ["a[,]b"], { scale: [{ id: "a" }, { id: "b" }] }),
    ),
    badPattern("likert: a single item id.", pattern("likert", [""], { scale: [{ id: "a" }] })),
    badPattern(
      "matching: each pair is a source and a target joined by [.].",
      pattern("matching", ["ben[.]3[,]chris"], { source: [{ id: "ben" }, { id: "chris" }], target: [{ id: "3" }] }),
    ),
    badPattern(
      "matching: a pair has two items only.",
      pattern("matching", ["ben[.]3[.]4"], { source: [{ id: "ben" }], target: [{ id: "3" }] }),
    ),
    badPattern(
      "matching: the source of a pair is not empty.",
      pattern("matching", ["[.]3"], { target: [{ id: "3" }] }),
    ),
    badPattern(
      "performance: a step id and a response, joined by [.].",
      pattern("performance", ["pong"], { steps: [{ id: "pong" }] }),
    ),
    badPattern(
      "performance: the id of a step is not empty.",
      pattern("performance", ["[.]1"], { steps: [{ id: "pong" }] }),
    ),
    badPattern("numeric: a number or a range of numbers.", pattern("numeric", ["five"])),
    badPattern("numeric: a range has one delimiter.", pattern("numeric", ["1[:]2[:]3"])),
    badPattern("fill-in: case_matters is true or false.", pattern("fill-in", ["{case_matters=maybe}Bob"])),
    badPattern("fill-in: only the parameters of the table.", pattern("fill-in", ["{color=red}Bob"])),
    badPattern("fill-in: lang is a language tag.", pattern("fill-in", ["{lang=en_US}Bob"])),
    badPattern(
      "fill-in: case_matters belongs at the start of the list.",
      pattern("fill-in", ["Bob[,]{case_matters=true}Ann"]),
    ),
    badPattern(
      "choice: no parameter applies, so the pattern is the ids.",
      pattern("choice", ["golf[,][,]"], { choices: [{ id: "golf" }] }),
    ),
    badPattern(
      "long-fill-in: order_matters is true or false.",
      pattern("long-fill-in", ["{order_matters=1}A long answer."]),
    ),
    badPattern(
      "performance: case_matters does not apply.",
      pattern("performance", ["{case_matters=true}pong[.]1"], { steps: [{ id: "pong" }] }),
    ),
  ];
}

/**
 * The rules that give a warning, or that the roles judge differently: what an LRS accepts and a Learning Record Provider
 * shall or should not do, and the forms that the standard names and an LRS does not validate.
 */
export const ADVISORIES: readonly XapiRule[] = [
  roles(
    "LRS 4.2.7 and Content 5.2.7",
    "An LRS shall convert Timestamps to UTC rather than reject them. A Timestamp shall be formatted to UTC.",
    set("timestamp", "2024-06-13T20:46:03.250+02:00"),
    [],
    [error("timestamp", "timestamp-not-utc")],
  ),
  roles(
    "Content 5.2.7",
    "A zero offset is UTC, whether it is written Z or +00:00.",
    set("timestamp", "2024-06-13T18:46:03.250+00:00"),
    [],
    [],
  ),
  roles(
    "LRS 4.2.4.2 and Content 5.2.4.1",
    "An LRS should not reject a Statement that is otherwise valid except the version. If an LRP sets the version, it shall set it to 2.0.0.",
    set("version", "1.0.0"),
    [],
    [error("version", "invalid-value")],
  ),
  roles(
    "Content 5.2.4.1",
    "An LRP should not provide a version for the Statement.",
    set("version", "2.0.0"),
    [],
    [warning("version", "lrs-managed-property")],
  ),
  roles(
    "Content 5.2.4.1",
    "An LRP should not provide stored for the Statement.",
    set("stored", "2024-06-13T18:46:04.100Z"),
    [],
    [warning("stored", "lrs-managed-property")],
  ),
  roles(
    "Content 5.2.4.1",
    "An LRP should not provide authority for the Statement.",
    set("authority", { mbox: "mailto:lms@example.org" }),
    [],
    [warning("authority", "lrs-managed-property")],
  ),
  roles(
    "Content 5.2.7",
    "A Timestamp shall be formatted to UTC: stored.",
    set("stored", "2024-06-13T20:46:04.100+02:00"),
    [],
    [error("stored", "timestamp-not-utc"), warning("stored", "lrs-managed-property")],
  ),
  roles(
    "Content 5.2.4.1",
    "An LRP should provide an id for the Statement.",
    remove("id"),
    [],
    [warning("id", "missing-property")],
  ),
  roles(
    "Content 5.2.7",
    "An LRP should send a Timestamp with at least millisecond precision.",
    set("timestamp", "2024-06-13T18:46:03Z"),
    [],
    [warning("timestamp", "timestamp-precision")],
  ),
  roles(
    "Content 5.2.7",
    "A SubStatement is held to the same Timestamp rules.",
    withObject({
      objectType: "SubStatement",
      actor: { mbox: "mailto:a@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/asked" },
      object: { id: "https://example.org/activities/quiz-1" },
      timestamp: "2024-06-13T20:00:00+02:00",
    }),
    [],
    [error("object.timestamp", "timestamp-not-utc"), warning("object.timestamp", "timestamp-precision")],
  ),
  roles(
    "LRS 4.2.7 and Content 5.2.7",
    "On receiving a Duration with more than 0.01 second precision, the LRS shall not reject the request. LRPs should provide a maximum precision of 0.01 seconds.",
    set("result.duration", "PT1H30M15.253S"),
    [],
    [warning("result.duration", "duration-precision")],
  ),
  roles(
    "Content 5.2.4.1",
    "An LRP should not include properties with a value of an empty object.",
    set("result.extensions", {}),
    [],
    [warning("result.extensions", "empty-object")],
  ),
  roles(
    "Content 5.2.4.1",
    "Properties with an empty object: the Context.",
    set("context", {}),
    [],
    [warning("context", "empty-object")],
  ),
  roles(
    "Content 5.2.4.1",
    "The values of extensions are free, so an empty object inside one is not a property of the Statement.",
    set("result.extensions", { "https://example.org/xapi/extensions/empty": {} }),
    [],
    [],
  ),
  roles(
    "LRS 4.2.4.2 and Content 5.2.4.1",
    "The LRS shall return every value of contextActivities as an array. The LRP should ensure that every value is an array.",
    set("context.contextActivities.parent", { id: "https://example.org/activities/quiz-1" }),
    [],
    [warning("context.contextActivities.parent", "single-activity")],
  ),
  roles(
    "Content 5.2.4.1",
    "The same for the context of a SubStatement.",
    withObject({
      objectType: "SubStatement",
      actor: { mbox: "mailto:a@example.org" },
      verb: { id: "http://adlnet.gov/expapi/verbs/asked" },
      object: { id: "https://example.org/activities/quiz-1" },
      context: { contextActivities: { other: { id: "https://example.org/activities/resource-9" } } },
      timestamp: "2024-06-13T18:00:00.000Z",
    }),
    [],
    [warning("object.context.contextActivities.other", "single-activity")],
  ),
  both("LRS 4.2.7", "UUIDs should use variant 2 in RFC 4122: id.", set("id", "00000000-0000-4000-7000-000000000001"), [
    warning("id", "uuid-variant"),
  ]),
  both(
    "LRS 4.2.7",
    "UUIDs should use variant 2: registration.",
    set("context.registration", "00000000-0000-4000-c000-000000000002"),
    [warning("context.registration", "uuid-variant")],
  ),
  both(
    "LRS 4.2.7",
    "UUIDs should use variant 2: the Statement of a context.",
    set("context.statement.id", "00000000-0000-4000-0000-000000000003"),
    [warning("context.statement.id", "uuid-variant")],
  ),
  both(
    "LRS 4.2.7",
    "UUIDs should use variant 2: the Object that is a Statement Reference.",
    withObject({ objectType: "StatementRef", id: "00000000-0000-4000-7000-000000000004" }),
    [warning("object.id", "uuid-variant")],
  ),
  roles(
    "LRS 4.2.4.2 and Content 5.2.1",
    "An LRS may return 400 if the remaining properties are not valid for the Interaction Activity. An LRP shall not add additional properties.",
    pattern("likert", ["a"], { choices: [{ id: "a" }] }),
    [warning("object.definition.choices", "unsupported-component-list")],
    [error("object.definition.choices", "unsupported-component-list")],
  ),
  roles(
    "LRS 4.2.4.2 and Content 5.2.1",
    "No component lists are supported for fill-in.",
    pattern("fill-in", ["Bob"], { source: [{ id: "a" }] }),
    [warning("object.definition.source", "unsupported-component-list")],
    [error("object.definition.source", "unsupported-component-list")],
  ),
  both(
    "LRS 4.2.4.2",
    "An interaction component's id value should not have whitespace.",
    set("object.definition.choices.1.id", "tetris game"),
    [warning("object.definition.choices[1].id", "component-id-whitespace")],
  ),
  both(
    "LRS 4.2.2.3",
    "The id identifies the interaction component within the list.",
    set("object.definition.choices.1.id", "golf"),
    [warning("object.definition.choices[1].id", "duplicate-component-id")],
  ),
  ...responsePatternRules("LRS 4.2.2.3"),
];

/** What an LRS shall not reject, or may not reject: Statements that the reader of an LRS accepts without a finding. */
export const ACCEPTANCES: readonly Omit<XapiRule, "lrs" | "provider">[] = [
  {
    source: "LRS 4.2.4.1",
    text: "An LRS may not reject a Statement solely based on the order of properties.",
    fixture: (statement) => Object.fromEntries(Object.entries(statement).reverse()),
  },
  {
    source: "LRS 4.2.4.1",
    text: "An LRS shall not reject a timestamp for having a greater value than the current time.",
    fixture: set("timestamp", "2999-01-01T00:00:00.000Z"),
  },
  {
    source: "LRS 4.2.7",
    text: "An LRS shall convert Timestamps to UTC rather than rejecting Statements that send Timestamps not in UTC form.",
    fixture: set("timestamp", "2024-06-13T20:46:03+02:00"),
  },
  {
    source: "LRS 4.2.7",
    text: "An LRS shall not reject a Statement based on the values of the extensions map.",
    fixture: set("context.extensions", {
      "https://example.org/xapi/extensions/none": null,
      "https://example.org/xapi/extensions/list": [1, "two", { three: 3 }],
      "https://example.org/xapi/extensions/nested": { "not an iri": { deeper: true } },
    }),
  },
  {
    source: "LRS 4.2.4.1",
    text: "The LRS shall not reject a Statement that uses the voided verb if it cannot find the id of the Object of that Statement.",
    fixture: all(
      set("verb.id", VOIDED),
      withObject({ objectType: "StatementRef", id: "00000000-0000-4000-8000-0000000000ff" }),
    ),
  },
  {
    source: "LRS 4.2.4.2",
    text: "An LRS should not reject a Statement that is otherwise valid except the version.",
    fixture: set("version", "1.0.0"),
  },
  {
    source: "LRS 4.2.4.2",
    text: "The LRS shall return every value in the contextActivities Object as an array, even if it arrived as a single Activity Object.",
    fixture: set("context.contextActivities.parent", { id: "https://example.org/activities/quiz-1" }),
  },
  {
    source: "LRS 4.2.4.1",
    text: "An LRS may choose to not validate IRIs: an IRI of any scheme is one.",
    fixture: all(set("verb.id", "urn:example:verbs:answered"), set("object.id", "tag:example.org,2024:activity")),
  },
  {
    source: "LRS 4.2.7",
    text: "Metadata and names may be written in any language and any script.",
    fixture: set("verb.display", { "zh-Hant-TW": "回答", ja: "答えた", "x-private": "x" }),
  },
  {
    source: "LRS 4.2.2.4",
    text: "A score may leave out any of its properties.",
    fixture: set("result.score", { raw: 8 }),
  },
  {
    source: "LRS 4.2.2.4",
    text: "The raw score is not restricted when there is no min and no max.",
    fixture: set("result.score", { raw: 1e6 }),
  },
  {
    source: "LRS 4.2.2.1",
    text: "An Agent may be identified by an Account.",
    fixture: set("actor", { account: { homePage: "https://lms.example.org", name: "learner-1" } }),
  },
  {
    source: "LRS 4.2.2.1",
    text: "An anonymous Group lists its members, and a member needs an identifier.",
    fixture: set("actor", {
      objectType: "Group",
      member: [{ mbox: "mailto:a@example.org" }, { openid: "https://openid.example.org/b" }],
    }),
  },
  {
    source: "LRS 4.2.2.1",
    text: "An identified Group may leave out its members.",
    fixture: set("actor", {
      objectType: "Group",
      name: "Team A",
      mbox_sha1sum: "e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e90",
    }),
  },
  {
    source: "LRS 4.2.2.5",
    text: "The authority is an Agent, or an anonymous Group of two Agents.",
    fixture: set("authority", {
      objectType: "Group",
      member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }],
    }),
  },
  {
    source: "LRS 4.2.2.5",
    text: "A contextAgent without relevantTypes means only a generic relationship.",
    fixture: set("context.contextAgents", [{ objectType: "contextAgent", agent: { mbox: "mailto:a@example.org" } }]),
  },
  {
    source: "LRS 4.2.2.3",
    text: "A numeric response may be a single number, or a range that leaves out one end.",
    fixture: set("object.definition", {
      interactionType: "numeric",
      correctResponsesPattern: ["4", "1.5[:]4", "[:]4", "-2[:]"],
    }),
  },
  {
    source: "LRS 4.2.2.3",
    text: "A response of a matching interaction is pairs joined by [.] and delimited by [,].",
    fixture: set("object.definition", {
      interactionType: "matching",
      correctResponsesPattern: ["ben[.]3[,]chris[.]2"],
      source: [{ id: "ben" }, { id: "chris" }],
      target: [{ id: "3" }, { id: "2" }],
    }),
  },
  {
    source: "LRS 4.2.2.3",
    text: "The parameters of a long-fill-in response: case_matters and lang.",
    fixture: set("object.definition", {
      interactionType: "long-fill-in",
      correctResponsesPattern: ["{case_matters=false}{lang=en}To store and provide access to learning experiences."],
    }),
  },
  {
    source: "LRS 4.2.2.3",
    text: "A step of a performance interaction may have an empty response, and the order may not matter.",
    fixture: set("object.definition", {
      interactionType: "performance",
      correctResponsesPattern: ["{order_matters=false}pong[.]1:[,]dg[.]:10[,]lunch[.]"],
      steps: [{ id: "pong" }, { id: "dg" }, { id: "lunch" }],
    }),
  },
];
