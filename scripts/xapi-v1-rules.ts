/**
 * The rules of xAPI 1.0.3 (the Data part, and the Communication part where it speaks of Statements) that a reader of Statements
 * applies, one entry for each sentence, each with a Statement that breaks it and what a reader of each role finds.
 *
 * The entries are written from the 1.0.3 text and not from the code that reads Statements: the tests of the package change a
 * sound Statement of 1.0.3 with `fixture` and compare what the readers find, with `version: "1.0.3"`, with `lrs` and `provider`.
 * Section numbers are those of the Data part (Data 2.2) and the Communication part.
 */
import {
  all,
  both,
  error,
  type Json,
  pattern,
  remove,
  responsePatternRules,
  roles,
  set,
  VOIDED,
  warning,
  withObject,
  type XapiRule,
} from "./xapi-rules.ts";

const SUB_STATEMENT = {
  objectType: "SubStatement",
  actor: { mbox: "mailto:a@example.org" },
  verb: { id: "http://adlnet.gov/expapi/verbs/asked" },
  object: { id: "https://example.org/activities/quiz-1" },
};

/** The rules of 1.0.3 that a Statement breaks and a reader reports. */
export const REFUSALS_V1: readonly XapiRule[] = [
  both(
    "Data 2.4.6",
    "The context of 1.0.3 has no contextAgents: its table lists no such property.",
    set("context.contextAgents", [{ objectType: "contextAgent", agent: { mbox: "mailto:a@example.org" } }]),
    [error("context.contextAgents", "unknown-property")],
  ),
  both(
    "Data 2.4.6",
    "The context of 1.0.3 has no contextGroups: its table lists no such property.",
    set("context.contextGroups", [
      { objectType: "contextGroup", group: { objectType: "Group", mbox: "mailto:t@example.org" } },
    ]),
    [error("context.contextGroups", "unknown-property")],
  ),
  both(
    "Data 2.4.6",
    "The context of a SubStatement has no contextAgents either.",
    withObject({ ...SUB_STATEMENT, context: { contextAgents: [] } }),
    [error("object.context.contextAgents", "unknown-property")],
  ),
  both(
    "Data 2.4.10",
    "An LRS must reject all Statements with a version that does not start with 1.0.",
    set("version", "2.0.0"),
    [error("version", "invalid-value")],
  ),
  both("Data 2.4.10", "A version before 1.0.", set("version", "0.9.9"), [error("version", "invalid-value")]),
  both("Data 2.4.10", "A version after 1.0.x.", set("version", "1.1.0"), [error("version", "invalid-value")]),
  both("Data 2.4.10", "Version is formatted as the API version header: a text.", set("version", "abc"), [
    error("version", "invalid-value"),
  ]),
  both("Data 4.5", "A Timestamp must be formatted according to ISO 8601: a text.", set("timestamp", "should fail"), [
    error("timestamp", "invalid-format"),
  ]),
  both(
    "Data 4.5",
    "A Timestamp must be formatted according to ISO 8601: another form of date.",
    set("timestamp", "01/011/2015"),
    [error("timestamp", "invalid-format")],
  ),
  both("Data 4.5", "A Timestamp is a combined date and time: a date alone.", set("timestamp", "2024-06-13"), [
    error("timestamp", "invalid-format"),
  ]),
  both(
    "Data 4.5",
    "A Timestamp should include the time zone, which the rules hold as a requirement: without one no time can be returned in UTC.",
    set("timestamp", "2024-06-13T18:46:03.250"),
    [error("timestamp", "invalid-format")],
  ),
  both(
    "Data 4.5",
    "ISO 8601 separates the date and the time with a T, not a space.",
    set("timestamp", "2024-06-13 18:46:03Z"),
    [error("timestamp", "invalid-format")],
  ),
  both("Data 4.5", "ISO 8601 writes the T and the Z in upper case.", set("timestamp", "2024-06-13t18:46:03z"), [
    error("timestamp", "invalid-format"),
  ]),
  both("Data 4.5", "ISO 8601 has no offset of minus zero: -00:00.", set("timestamp", "2008-09-15T15:53:00.601-00:00"), [
    error("timestamp", "invalid-format"),
  ]),
  both("Data 4.5", "ISO 8601 has no offset of minus zero: -0000.", set("timestamp", "2008-09-15T15:53:00.601-0000"), [
    error("timestamp", "invalid-format"),
  ]),
  both("Data 4.5", "ISO 8601 has no offset of minus zero: -00.", set("timestamp", "2008-09-15T15:53:00.601-00"), [
    error("timestamp", "invalid-format"),
  ]),
  both("Data 4.5", "The basic format does not mix with the extended format.", set("timestamp", "2024-06-13T1846Z"), [
    error("timestamp", "invalid-format"),
  ]),
  both(
    "Data 4.5",
    "The extended format writes an offset with a colon, and the basic format does not mix with it.",
    set("timestamp", "2024-06-13T20:46:03.250+0200"),
    [error("timestamp", "invalid-format")],
  ),
  both("Data 4.5", "A date that does not exist.", set("timestamp", "2024-02-30T10:00:00Z"), [
    error("timestamp", "invalid-format"),
  ]),
  both("Data 2.4.8", "Stored is a Timestamp.", set("stored", "yesterday"), [error("stored", "invalid-format")]),
  both(
    "Data 2.4.4.3",
    "A SubStatement is validated as a Statement: its timestamp.",
    withObject({ ...SUB_STATEMENT, timestamp: "2008-09-15T15:53:00.601-00:00" }),
    [error("object.timestamp", "invalid-format")],
  ),
  both("Data 2.2", "A Statement must use actor.", remove("actor"), [error("actor", "missing-property")]),
  both("Data 2.2", "A Statement must use verb.", remove("verb"), [error("verb", "missing-property")]),
  both("Data 2.2", "A Statement must use object.", remove("object"), [error("object", "missing-property")]),
  both("Data 2.4.3", "A Verb has an id.", remove("verb.id"), [error("verb.id", "missing-property")]),
  both("Data 2.4.4.1", "An Activity has an id.", remove("object.id"), [error("object.id", "missing-property")]),
  both("Data 2.4.2.4", "An Account has a homePage.", set("actor", { account: { name: "learner" } }), [
    error("actor.account.homePage", "missing-property"),
  ]),
  both("Data 2.4.2.4", "An Account has a name.", set("actor", { account: { homePage: "https://lms.example.org" } }), [
    error("actor.account.name", "missing-property"),
  ]),
  both("Data 2.4.11", "An Attachment has a sha2.", remove("attachments.0.sha2"), [
    error("attachments[0].sha2", "missing-property"),
  ]),
  both(
    "Data 2.4.4.3",
    "A Statement Reference must set the id.",
    set("context.statement", { objectType: "StatementRef" }),
    [error("context.statement.id", "missing-property")],
  ),
  both("Data 2.2", "The LRS rejects a key that is not allowed: the Statement.", set("extra", 1), [
    error("extra", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: the Actor.", set("actor.nickname", "Ex"), [
    error("actor.nickname", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: the Verb.", set("verb.alias", "Ex"), [
    error("verb.alias", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: the Activity.", set("object.title", "Ex"), [
    error("object.title", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: the Activity Definition.", set("object.definition.title", "Ex"), [
    error("object.definition.title", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: the Result.", set("result.grade", "A"), [
    error("result.grade", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: the Score.", set("result.score.points", 1), [
    error("result.score.points", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: the Context.", set("context.venue", "Ex"), [
    error("context.venue", "unknown-property"),
  ]),
  both("Data 2.2", "A key that is not allowed: an Attachment.", set("attachments.0.title", "Ex"), [
    error("attachments[0].title", "unknown-property"),
  ]),
  both(
    "Data 2.4.6.2",
    "Every key in the contextActivities Object must be one of parent, grouping, category, or other.",
    set("context.contextActivities.sibling", []),
    [error("context.contextActivities.sibling", "unknown-property")],
  ),
  both("Data 2.2", "The LRS must reject Statements with any null values: the Result.", set("result.success", null), [
    error("result.success", "wrong-type"),
  ]),
  both("Data 2.2", "Null values: the Context.", set("context.revision", null), [
    error("context.revision", "wrong-type"),
  ]),
  both(
    "Data 2.2",
    "Strings where numbers are required, even if those strings contain numbers.",
    set("result.score.raw", "8"),
    [error("result.score.raw", "wrong-type")],
  ),
  both(
    "Data 2.2",
    "Strings where booleans are required, even if those strings contain booleans.",
    set("result.completion", "true"),
    [error("result.completion", "wrong-type")],
  ),
  both("Data 2.2", "The wrong data type: an array where an object is.", set("verb", []), [error("verb", "wrong-type")]),
  both("Data 2.2", "Any non-format-following value, including the empty string: a UUID.", set("id", ""), [
    error("id", "invalid-format"),
  ]),
  both("Data 2.2", "The empty string where a mailto IRI is required.", set("actor.mbox", ""), [
    error("actor.mbox", "invalid-format"),
  ]),
  both("Data 2.2", "The empty string where an IRI is required.", set("verb.id", ""), [
    error("verb.id", "invalid-format"),
  ]),
  both(
    "Data 2.2",
    "Where the case of a key does not match the case specified.",
    all(remove("actor.name"), set("actor.Name", "Ex")),
    [error("actor.Name", "unknown-property")],
  ),
  both(
    "Data 2.2",
    "Where the case of an enumerated value does not match: objectType.",
    set("actor.objectType", "agent"),
    [error("actor.objectType", "invalid-value")],
  ),
  both(
    "Data 2.2",
    "The case of an enumerated value: interactionType.",
    set("object.definition.interactionType", "Choice"),
    [error("object.definition.interactionType", "invalid-value")],
  ),
  both("Data 2.2", "IRL or IRI values without a scheme: the id of a Verb.", set("verb.id", "completed"), [
    error("verb.id", "invalid-format"),
  ]),
  both("Data 2.2", "IRI values without a scheme: the id of an Activity.", set("object.id", "activities/course-1"), [
    error("object.id", "invalid-format"),
  ]),
  both("Data 2.2", "IRL values without a scheme: moreInfo.", set("object.definition.moreInfo", "info.html"), [
    error("object.definition.moreInfo", "invalid-format"),
  ]),
  both(
    "Data 2.2",
    "IRL values without a scheme: the homePage of an Account.",
    set("actor", { account: { homePage: "lms.example.org", name: "learner" } }),
    [error("actor.account.homePage", "invalid-format")],
  ),
  both(
    "Data 2.2",
    "IRI values without a scheme: the usageType of an Attachment.",
    set("attachments.0.usageType", "signature"),
    [error("attachments[0].usageType", "invalid-format")],
  ),
  both(
    "Data 2.4.2.1",
    "An Agent must be identified by one Inverse Functional Identifier: two.",
    set("actor.openid", "https://openid.example.org/learner"),
    [error("actor", "identifier-count")],
  ),
  both(
    "Data 2.4.2.1",
    "An Agent must be identified by one Inverse Functional Identifier: none.",
    remove("actor.mbox"),
    [error("actor", "identifier-count")],
  ),
  both("Data 2.4.2.2", "An Anonymous Group must include a member property.", set("actor", { objectType: "Group" }), [
    error("actor.member", "missing-property"),
  ]),
  both(
    "Data 2.4.2.2",
    "An Identified Group must include exactly one Inverse Functional Identifier.",
    set("actor", { objectType: "Group", mbox: "mailto:g@example.org", openid: "https://openid.example.org/g" }),
    [error("actor", "identifier-count")],
  ),
  both(
    "Data 2.4.2.2",
    "An Anonymous Group must not contain Group Objects in the member identifiers.",
    set("actor", { objectType: "Group", member: [{ objectType: "Group", mbox: "mailto:g@example.org" }] }),
    [error("actor.member[0].objectType", "invalid-value")],
  ),
  both("Data 2.4.2.3", "An mbox is a mailto IRI.", set("actor.mbox", "learner@example.org"), [
    error("actor.mbox", "invalid-format"),
  ]),
  both(
    "Data 2.4.2.3",
    "An mbox_sha1sum is the hex-encoded SHA1 hash of a mailto IRI.",
    set("actor", { mbox_sha1sum: "abc" }),
    [error("actor.mbox_sha1sum", "invalid-format")],
  ),
  both(
    "Data 2.4.4.3",
    "A Statement Reference must specify an objectType with the value StatementRef.",
    withObject({ objectType: "StatementReference", id: "00000000-0000-4000-8000-000000000009" }),
    [error("object.objectType", "invalid-value")],
  ),
  both(
    "Data 2.4.4",
    "An Object without an objectType is an Activity.",
    withObject({ mbox: "mailto:classmate@example.org" }),
    [error("object.id", "missing-property"), error("object.mbox", "unknown-property")],
  ),
  both(
    "Data 2.4.4.1",
    "Interaction Activities must have a valid interactionType.",
    set("object.definition.interactionType", "multiple"),
    [error("object.definition.interactionType", "invalid-value")],
  ),
  both(
    "Data 2.4.4.1",
    "An Interaction Activity without an interactionType: a correctResponsesPattern alone.",
    all(remove("object.definition.interactionType"), remove("object.definition.choices")),
    [error("object.definition.interactionType", "missing-property")],
  ),
  both(
    "Data 2.4.4.1",
    "An Interaction Activity without an interactionType: a list of components alone.",
    all(remove("object.definition.interactionType"), remove("object.definition.correctResponsesPattern")),
    [error("object.definition.interactionType", "missing-property")],
  ),
  both(
    "Data 2.4.4.1",
    "An interaction component has an id.",
    set("object.definition.choices", [{ description: { "en-US": "Golf" } }]),
    [error("object.definition.choices[0].id", "missing-property")],
  ),
  both(
    "Data 2.4.4.3",
    "A SubStatement must not contain a SubStatement of its own.",
    withObject({
      ...SUB_STATEMENT,
      object: { ...SUB_STATEMENT, verb: { id: "http://adlnet.gov/expapi/verbs/answered" } },
    }),
    [error("object.object.objectType", "invalid-value")],
  ),
  both(
    "Data 2.4.4.3",
    "A SubStatement must not have the id property.",
    withObject({ ...SUB_STATEMENT, id: "00000000-0000-4000-8000-000000000009" }),
    [error("object.id", "unknown-property")],
  ),
  both(
    "Data 2.4.4.3",
    "A SubStatement must not have the stored property.",
    withObject({ ...SUB_STATEMENT, stored: "2024-06-13T18:46:04.100Z" }),
    [error("object.stored", "unknown-property")],
  ),
  both(
    "Data 2.4.4.3",
    "A SubStatement must not have the version property.",
    withObject({ ...SUB_STATEMENT, version: "1.0.0" }),
    [error("object.version", "unknown-property")],
  ),
  both(
    "Data 2.4.4.3",
    "A SubStatement must not have the authority property.",
    withObject({ ...SUB_STATEMENT, authority: { mbox: "mailto:lms@example.org" } }),
    [error("object.authority", "unknown-property")],
  ),
  both(
    "Data 4.1",
    "The keys of an extensions map must be IRIs: the Result.",
    set("result.extensions", { "not an iri": 1 }),
    [error('result.extensions["not an iri"]', "invalid-format")],
  ),
  both(
    "Data 4.1",
    "The keys of an extensions map must be IRIs: the context.",
    set("context.extensions", { attempts: 1 }),
    [error("context.extensions.attempts", "invalid-format")],
  ),
  both(
    "Data 4.1",
    "The keys of an extensions map must be IRIs: the Activity Definition.",
    set("object.definition.extensions", { difficulty: 3 }),
    [error("object.definition.extensions.difficulty", "invalid-format")],
  ),
  both(
    "Data 2.2",
    "The LRS must validate the token lengths of language map keys: a map of a Verb.",
    set("verb.display", { en_US: "answered" }),
    [error("verb.display.en_US", "invalid-format")],
  ),
  both("Data 2.2", "Language map keys: a map of an Activity.", set("object.definition.name", { "en-": "Question" }), [
    error('object.definition.name["en-"]', "invalid-format"),
  ]),
  both("Data 2.4.6", "The language of a context is an RFC 5646 tag.", set("context.language", "english_us"), [
    error("context.language", "invalid-format"),
  ]),
  both("Data 4.2", "A language map holds strings.", set("verb.display", { "en-US": 1 }), [
    error("verb.display", "invalid-value"),
  ]),
  both("Data 4.4", "UUIDs must be in the standard string form: id.", set("id", "not-a-uuid"), [
    error("id", "invalid-format"),
  ]),
  both(
    "Data 4.4",
    "UUIDs in the standard string form: registration.",
    set("context.registration", "0000000040008000000000000002"),
    [error("context.registration", "invalid-format")],
  ),
  both("Data 4.4", "UUIDs in the standard string form: a Statement Reference.", set("context.statement.id", "xyz"), [
    error("context.statement.id", "invalid-format"),
  ]),
  both(
    "Data 4.6",
    "A Duration must be expressed in the format of ISO 8601 4.4.3.2: a clock.",
    set("result.duration", "01:30:00"),
    [error("result.duration", "invalid-format")],
  ),
  both(
    "Data 4.6",
    "The alternative format of ISO 8601 4.4.3.3 must not be used.",
    set("result.duration", "P0000-00-00T01:30:00"),
    [error("result.duration", "invalid-format")],
  ),
  both("Data 4.6", "A Duration has a component: P alone.", set("result.duration", "P"), [
    error("result.duration", "invalid-format"),
  ]),
  both("Data 4.6", "A Duration with a T has a time component.", set("result.duration", "P1DT"), [
    error("result.duration", "invalid-format"),
  ]),
  both("Data 4.6", "Only the smallest component of a Duration has a fraction.", set("result.duration", "PT1.5H30M"), [
    error("result.duration", "invalid-format"),
  ]),
  both("Data 2.4.5.1", "The scaled score is from -1 to 1: above.", set("result.score.scaled", 1.5), [
    error("result.score.scaled", "out-of-range"),
  ]),
  both("Data 2.4.5.1", "The scaled score is from -1 to 1: below.", set("result.score.scaled", -1.01), [
    error("result.score.scaled", "out-of-range"),
  ]),
  both("Data 2.4.5.1", "The raw score is between min and max: above max.", set("result.score.raw", 11), [
    error("result.score.raw", "out-of-range"),
  ]),
  both("Data 2.4.5.1", "The raw score is between min and max: below min.", set("result.score.raw", -1), [
    error("result.score.raw", "out-of-range"),
  ]),
  both(
    "Data 2.4.5.1",
    "The lowest possible score is less than max.",
    all(set("result.score.min", 10), set("result.score.raw", 10)),
    [error("result.score.min", "out-of-range")],
  ),
  both(
    "Data 2.3.2",
    "The Object of a voiding Statement must have the objectType StatementRef.",
    set("verb.id", VOIDED),
    [error("object", "voiding-target")],
  ),
  both(
    "Data 2.3.2",
    "The Object of a voiding Statement must specify the id of the Statement to void.",
    all(set("verb.id", VOIDED), withObject({ objectType: "StatementRef" })),
    [error("object.id", "missing-property")],
  ),
  roles(
    "Data 2.4.6",
    "The revision and platform properties must only be used if the Object of the Statement is an Activity.",
    set("object", { objectType: "Agent", mbox: "mailto:a@example.org" }),
    [error("context.revision", "context-needs-activity"), error("context.platform", "context-needs-activity")],
    [error("context.revision", "context-needs-activity"), error("context.platform", "context-needs-activity")],
  ),
  roles(
    "Data 2.4.9",
    "Authority must be an Agent, or a Group with two Agents: a Group of one.",
    set("authority", { objectType: "Group", member: [{ mbox: "mailto:a@example.org" }] }),
    [error("authority", "authority-group")],
    [error("authority", "authority-group"), warning("authority", "lrs-managed-property")],
  ),
  roles(
    "Data 2.4.9",
    "Authority: a Group of three.",
    set("authority", {
      objectType: "Group",
      member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }, { mbox: "mailto:c@example.org" }],
    }),
    [error("authority", "authority-group")],
    [error("authority", "authority-group"), warning("authority", "lrs-managed-property")],
  ),
  roles(
    "Data 2.4.9",
    "Authority: an identified Group.",
    set("authority", {
      objectType: "Group",
      mbox: "mailto:team@example.org",
      member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }],
    }),
    [error("authority", "authority-group")],
    [error("authority", "authority-group"), warning("authority", "lrs-managed-property")],
  ),
  both("Data 2.4.11", "The contentType is an Internet media type.", set("attachments.0.contentType", "octet stream"), [
    error("attachments[0].contentType", "invalid-format"),
  ]),
  both("Data 2.4.11", "The length is an integer.", set("attachments.0.length", 12.5), [
    error("attachments[0].length", "invalid-format"),
  ]),
  both("Data 2.4.11", "The length of the data in octets is not negative.", set("attachments.0.length", -1), [
    error("attachments[0].length", "invalid-format"),
  ]),
  both("Data 2.4.11", "The sha2 is a SHA-2 hash.", set("attachments.0.sha2", "not a hash"), [
    error("attachments[0].sha2", "invalid-format"),
  ]),
  both("Data 2.4.11", "The display of an Attachment is a language map.", set("attachments.0.display", "Signature"), [
    error("attachments[0].display", "wrong-type"),
  ]),
  both("Data 2.4.6", "The team of a context is a Group.", set("context.team", { mbox: "mailto:t@example.org" }), [
    error("context.team.objectType", "missing-property"),
  ]),
];

/**
 * The rules of 1.0.3 that give a warning, or that the roles judge differently: what an LRS accepts and a Learning Record
 * Provider must or should not do.
 */
export const ADVISORIES_V1: readonly XapiRule[] = [
  roles(
    "Data 2.4.10",
    "An LRS must accept all Statements whose version starts with 1.0. If Learning Record Providers set the version, they must set it to 1.0.0.",
    set("version", "1.0.3"),
    [],
    [error("version", "invalid-value")],
  ),
  roles(
    "Data 2.4.10",
    "Learning Record Providers should not set the Statement version.",
    set("version", "1.0.0"),
    [],
    [warning("version", "lrs-managed-property")],
  ),
  roles(
    "Data 2.4.8",
    "The stored property must be set by the LRS.",
    set("stored", "2024-06-13T18:46:04.100Z"),
    [],
    [warning("stored", "lrs-managed-property")],
  ),
  roles(
    "Data 2.4.9",
    "The authority is set by the LRS.",
    set("authority", { mbox: "mailto:lms@example.org" }),
    [],
    [warning("authority", "lrs-managed-property")],
  ),
  roles(
    "Data 2.4.1",
    "Statement ids should be generated by the Learning Record Provider.",
    remove("id"),
    [],
    [warning("id", "missing-property")],
  ),
  roles(
    "Data 4.5",
    "A Timestamp should be expressed in the format of RFC 3339, which the provider rules hold as a requirement: the basic format.",
    set("timestamp", "20240613T184603.250Z"),
    [],
    [error("timestamp", "timestamp-not-rfc3339")],
  ),
  roles(
    "Data 4.5",
    "RFC 3339 writes the minutes of an offset.",
    set("timestamp", "2024-06-13T20:46:03.250+02"),
    [],
    [error("timestamp", "timestamp-not-rfc3339")],
  ),
  roles(
    "Data 4.5",
    "RFC 3339 writes the seconds of a time.",
    set("timestamp", "2024-06-13T18:46Z"),
    [],
    [error("timestamp", "timestamp-not-rfc3339")],
  ),
  roles(
    "Data 4.5",
    "The provider rules hold stored to the same form.",
    set("stored", "20240613T184604Z"),
    [],
    [error("stored", "timestamp-not-rfc3339"), warning("stored", "lrs-managed-property")],
  ),
  roles(
    "Data 4.5",
    "A SubStatement is held to the same form.",
    withObject({ ...SUB_STATEMENT, timestamp: "20240613T180000Z" }),
    [],
    [error("object.timestamp", "timestamp-not-rfc3339")],
  ),
  roles(
    "Data 4.5",
    "1.0.3 does not ask a provider for UTC: an offset is sound.",
    set("timestamp", "2024-06-13T20:46:03.250+02:00"),
    [],
    [],
  ),
  roles(
    "Data 4.5",
    "1.0.3 does not ask a provider for milliseconds.",
    set("timestamp", "2024-06-13T18:46:03Z"),
    [],
    [],
  ),
  roles(
    "Data 4.6",
    "On receiving a Duration with more than 0.01 second precision, the LRS should not reject the request. Learning Record Providers should provide a maximum precision of 0.01 seconds.",
    set("result.duration", "PT1H30M15.253S"),
    [],
    [warning("result.duration", "duration-precision")],
  ),
  both(
    "Data 2.2",
    "Statements and other objects should not include properties with a value of an empty object.",
    set("result.extensions", {}),
    [warning("result.extensions", "empty-object")],
  ),
  both("Data 2.2", "Properties with an empty object: the Context.", set("context", {}), [
    warning("context", "empty-object"),
  ]),
  both(
    "Data 4.1",
    "The values of extensions are free, so an empty object inside one is not a property of the Statement.",
    set("result.extensions", { "https://example.org/xapi/extensions/empty": {} }),
    [],
  ),
  roles(
    "Data 2.4.6.2",
    "The LRS must return every value in the contextActivities Object as an array. The Learning Record Provider should ensure that every value is an array.",
    set("context.contextActivities.parent", { id: "https://example.org/activities/quiz-1" }),
    [],
    [warning("context.contextActivities.parent", "single-activity")],
  ),
  roles(
    "Data 2.4.6.2",
    "The same for the context of a SubStatement.",
    withObject({
      ...SUB_STATEMENT,
      context: { contextActivities: { other: { id: "https://example.org/activities/resource-9" } } },
    }),
    [],
    [warning("object.context.contextActivities.other", "single-activity")],
  ),
  both(
    "Data 4.4",
    "It is recommended that variant 2 in RFC 4122 is used: id.",
    set("id", "00000000-0000-4000-7000-000000000011"),
    [warning("id", "uuid-variant")],
  ),
  both("Data 4.4", "Variant 2: registration.", set("context.registration", "00000000-0000-4000-c000-000000000012"), [
    warning("context.registration", "uuid-variant"),
  ]),
  both(
    "Data 4.4",
    "Variant 2: the Statement of a context.",
    set("context.statement.id", "00000000-0000-4000-0000-000000000003"),
    [warning("context.statement.id", "uuid-variant")],
  ),
  both(
    "Data 4.4",
    "Variant 2: the Object that is a Statement Reference.",
    withObject({ objectType: "StatementRef", id: "00000000-0000-4000-7000-000000000004" }),
    [warning("object.id", "uuid-variant")],
  ),
  roles(
    "Data 2.4.4.1 and Data 2.2",
    "An LRS may return 400 if the remaining properties are not valid for the Interaction Activity. Additional properties should not be added.",
    pattern("likert", ["a"], { choices: [{ id: "a" }] }),
    [warning("object.definition.choices", "unsupported-component-list")],
    [error("object.definition.choices", "unsupported-component-list")],
  ),
  roles(
    "Data 2.4.4.1 and Data 2.2",
    "No component lists are supported for fill-in.",
    pattern("fill-in", ["Bob"], { source: [{ id: "a" }] }),
    [warning("object.definition.source", "unsupported-component-list")],
    [error("object.definition.source", "unsupported-component-list")],
  ),
  both(
    "Data 2.4.4.1",
    "An interaction component's id value should not have whitespace.",
    set("object.definition.choices.1.id", "tetris game"),
    [warning("object.definition.choices[1].id", "component-id-whitespace")],
  ),
  roles(
    "Data 2.4.4.1",
    "Within an array of interaction components, all id values must be distinct. An LRS may validate the properties of an interaction.",
    set("object.definition.choices.1.id", "golf"),
    [warning("object.definition.choices[1].id", "duplicate-component-id")],
    [error("object.definition.choices[1].id", "duplicate-component-id")],
  ),
  ...responsePatternRules("Data 2.4.4.1"),
];

/** What an LRS of 1.0.3 must not reject, or need not: Statements that the reader of an LRS accepts without a finding. */
export const ACCEPTANCES_V1: readonly Omit<XapiRule, "lrs" | "provider">[] = [
  {
    source: "Data 2.2",
    text: "A Statement may use its properties in any order.",
    fixture: (statement: Json) => Object.fromEntries(Object.entries(statement).reverse()),
  },
  {
    source: "Data 2.4.7",
    text: "An LRS should not reject a timestamp for having a greater value than the current time.",
    fixture: set("timestamp", "2999-01-01T00:00:00.000Z"),
  },
  {
    source: "Data 4.5",
    text: "If the Timestamp includes a time zone, the LRS may return it in another: an offset.",
    fixture: set("timestamp", "2024-06-13T20:46:03+02:00"),
  },
  {
    source: "Data 4.5",
    text: "A Timestamp in the basic format of ISO 8601.",
    fixture: set("timestamp", "20240613T184603.250Z"),
  },
  {
    source: "Data 4.5",
    text: "A Timestamp in the basic format of ISO 8601 with an offset.",
    fixture: set("timestamp", "20240613T204603+0200"),
  },
  {
    source: "Data 4.5",
    text: "An offset of ISO 8601 in hours: +02.",
    fixture: set("timestamp", "2024-06-13T20:46:03+02"),
  },
  {
    source: "Data 4.5",
    text: "ISO 8601 may leave out the seconds.",
    fixture: set("timestamp", "2024-06-13T18:46Z"),
  },
  {
    source: "Data 4.5",
    text: "ISO 8601 may leave out the minutes.",
    fixture: set("timestamp", "2024-06-13T18Z"),
  },
  {
    source: "Data 4.5",
    text: "A Timestamp may have more precision than milliseconds.",
    fixture: set("timestamp", "2024-06-13T18:46:03.123456789Z"),
  },
  {
    source: "Data 4.5",
    text: "An offset of plus zero is an offset of ISO 8601.",
    fixture: set("timestamp", "2024-06-13T18:46:03.250+00:00"),
  },
  {
    source: "Data 4.1",
    text: "An LRS must not reject a Statement based on the values of the extensions map.",
    fixture: set("context.extensions", {
      "https://example.org/xapi/extensions/none": null,
      "https://example.org/xapi/extensions/list": [1, "two", { three: 3 }],
      "https://example.org/xapi/extensions/nested": { "not an iri": { deeper: true } },
    }),
  },
  {
    source: "Data 2.3.2",
    text: "The LRS should not reject a voiding Statement on the grounds of its Object not being present.",
    fixture: all(
      set("verb.id", VOIDED),
      withObject({ objectType: "StatementRef", id: "00000000-0000-4000-8000-0000000000ff" }),
    ),
  },
  {
    source: "Data 2.4.10",
    text: "An LRS must accept all Statements where their version starts with 1.0.: 1.0.0.",
    fixture: set("version", "1.0.0"),
  },
  {
    source: "Data 2.4.10",
    text: "The version 1.0.9.",
    fixture: set("version", "1.0.9"),
  },
  {
    source: "Communication 3.3",
    text: "The version 1.0, which is 1.0.0.",
    fixture: set("version", "1.0"),
  },
  {
    source: "Data 2.4.6.2",
    text: "Every value in the contextActivities Object must be either a single Activity Object or an array of Activity Objects.",
    fixture: set("context.contextActivities.parent", { id: "https://example.org/activities/quiz-1" }),
  },
  {
    source: "Data 2.2",
    text: "The LRS may use best-effort validation for IRI formats: an IRI of any scheme is one.",
    fixture: all(set("verb.id", "urn:example:verbs:answered"), set("object.id", "tag:example.org,2024:activity")),
  },
  {
    source: "Data 4.2",
    text: "A language map may be populated with any language and any script.",
    fixture: set("verb.display", { "zh-Hant-TW": "回答", ja: "答えた", "x-private": "x" }),
  },
  {
    source: "Data 2.4.5.1",
    text: "A score may leave out any of its properties.",
    fixture: set("result.score", { raw: 8 }),
  },
  {
    source: "Data 2.4.5.1",
    text: "The raw score is not restricted when there is no min and no max.",
    fixture: set("result.score", { raw: 1e6 }),
  },
  {
    source: "Data 2.4.2.4",
    text: "An Agent may be identified by an Account.",
    fixture: set("actor", { account: { homePage: "https://lms.example.org", name: "learner-1" } }),
  },
  {
    source: "Data 2.4.2.2",
    text: "An Anonymous Group lists its members, and a member needs an identifier.",
    fixture: set("actor", {
      objectType: "Group",
      member: [{ mbox: "mailto:a@example.org" }, { openid: "https://openid.example.org/b" }],
    }),
  },
  {
    source: "Data 2.4.2.2",
    text: "An Identified Group may leave out its members.",
    fixture: set("actor", {
      objectType: "Group",
      name: "Team A",
      mbox_sha1sum: "e1a3e0b9a25c7a7f6e1b4c7d1e4d9b1f3a5c7e90",
    }),
  },
  {
    source: "Data 2.4.9",
    text: "In 3-legged OAuth the authority is a Group with two Agents.",
    fixture: set("authority", {
      objectType: "Group",
      member: [{ mbox: "mailto:a@example.org" }, { mbox: "mailto:b@example.org" }],
    }),
  },
  {
    source: "Data 2.4.4.1",
    text: "A numeric response may be a single number, or a range that leaves out one end.",
    fixture: set("object.definition", {
      interactionType: "numeric",
      correctResponsesPattern: ["4", "1.5[:]4", "[:]4", "-2[:]"],
    }),
  },
  {
    source: "Data 2.4.4.1",
    text: "A response of a matching interaction is pairs joined by [.] and delimited by [,].",
    fixture: set("object.definition", {
      interactionType: "matching",
      correctResponsesPattern: ["ben[.]3[,]chris[.]2"],
      source: [{ id: "ben" }, { id: "chris" }],
      target: [{ id: "3" }, { id: "2" }],
    }),
  },
  {
    source: "Data 2.4.4.1",
    text: "The parameters of a long-fill-in response: case_matters and lang.",
    fixture: set("object.definition", {
      interactionType: "long-fill-in",
      correctResponsesPattern: ["{case_matters=false}{lang=en}To store and provide access to learning experiences."],
    }),
  },
  {
    source: "Data 2.4.4.1",
    text: "A step of a performance interaction may have an empty response, and the order may not matter.",
    fixture: set("object.definition", {
      interactionType: "performance",
      correctResponsesPattern: ["{order_matters=false}pong[.]1:[,]dg[.]:10[,]lunch[.]"],
      steps: [{ id: "pong" }, { id: "dg" }, { id: "lunch" }],
    }),
  },
];
