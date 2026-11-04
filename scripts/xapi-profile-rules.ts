/**
 * The rules of xAPI Profiles 1.0 (ADL, Part Two: the structure of a profile) that a validator of profiles applies, one entry for
 * each sentence of the specification, each with a profile that breaks it and what the validator finds.
 *
 * The entries are written from the tables and the sentences of the specification, and not from the code that reads profiles:
 * the tests of the package change a sound profile with `fixture` and compare what `validateProfile` finds with `findings`. The
 * sound profile is the competitive-events profile of the specification's examples, with each example made whole.
 */
import { all, error, type Json, remove, set, warning } from "./xapi-rules.ts";

/** What the validator finds: where, which rule and how serious. */
interface ExpectedFinding {
  readonly path: string;
  readonly rule: string;
  readonly severity: "error" | "warning";
}

/** A sentence of the specification, a profile that breaks it, and what the validator finds in that profile. */
export interface ProfileRule {
  /** The section of Part Two that states the rule, such as `4.0`. */
  readonly source: string;
  /** What the specification says, in its words or shortened. */
  readonly text: string;
  /** Changes the sound profile into one that breaks the rule. It does not change its argument. */
  readonly fixture: (profile: Json) => Json;
  /** Other profiles that the validator is given, when the rule is about them. */
  readonly profiles?: readonly Json[];
  /** Every finding of the validator, in order. Empty when the profile keeps the rule. */
  readonly findings: readonly ExpectedFinding[];
}

const SPORTS = "http://example.org/profiles/sports";
const V2 = `${SPORTS}/v2`;
const V1 = `${SPORTS}/v1`;
const PLACED = `${SPORTS}/verbs/placed`;
const MEDALED = `${SPORTS}/verbs/medaled`;
const EVENT = `${SPORTS}/activitytypes/event`;
const START = `${SPORTS}/templates/start`;
const HANDOFF = `${SPORTS}/templates/handoff`;
const PLACING = `${SPORTS}/templates/placing`;
const RELAY = `${SPORTS}/patterns/relay`;
const HANDOFFS = `${SPORTS}/patterns/handoffs`;

/** A language map of one English string. */
const en = (text: string): Json => ({ en: text });

/** The profile of the examples of Part Two: competitive events, its second version. */
export function soundProfile(): Json {
  return {
    "@context": "https://w3id.org/xapi/profiles/context",
    id: SPORTS,
    type: "Profile",
    conformsTo: "https://w3id.org/xapi/profiles#1.0",
    prefLabel: en("Competitive events"),
    definition: en("Statements about athletes taking part in competitive events."),
    versions: [
      { id: V2, wasRevisionOf: [V1], generatedAtTime: "2020-02-20T20:20:20Z" },
      { id: V1, generatedAtTime: "2010-01-14T12:13:14Z" },
    ],
    author: { type: "Organization", name: "Example Sports", url: "https://example.org" },
    concepts: [
      {
        id: PLACED,
        type: "Verb",
        inScheme: V2,
        prefLabel: en("placed"),
        definition: en("Indicates a person finished the event in a ranked order. Use with the 'placement' extension."),
        broadMatch: ["http://adlnet.gov/expapi/verbs/completed"],
      },
      {
        id: MEDALED,
        type: "Verb",
        inScheme: V2,
        prefLabel: en("medaled"),
        definition: en("Indicates a person received a medal in a particular event."),
        broader: [PLACED],
      },
      {
        id: `${SPORTS}/verbs/qualified`,
        type: "Verb",
        inScheme: V2,
        prefLabel: en("qualified"),
        definition: en("Indicates a person is eligible for the event in the object."),
        relatedMatch: ["https://w3id.org/xapi/adl/verbs/satisfied"],
      },
      {
        id: EVENT,
        type: "ActivityType",
        inScheme: V2,
        prefLabel: en("event"),
        definition: en("A competitive event."),
      },
      {
        id: `${SPORTS}/extensions/place`,
        type: "ResultExtension",
        inScheme: V2,
        prefLabel: en("placement"),
        definition: en("Defines the place a person received in an event."),
        recommendedVerbs: [PLACED],
        inlineSchema:
          '{ "type": "object", "properties": { "rank": { "type": "number" }, "medal": { "type": "string" } }, "required": ["rank"] }',
      },
      {
        id: `${SPORTS}/resources/tshirt`,
        type: "AgentProfileResource",
        inScheme: V2,
        prefLabel: en("T-Shirt Preference"),
        definition: en("Stores a t-shirt preference for prefilling race registrations."),
        contentType: "application/json",
        inlineSchema: '{ "type": "object", "properties": { "cut": { "enum": ["straight", "fitted"] } } }',
      },
      {
        id: `${SPORTS}/activities/100mdash`,
        type: "Activity",
        inScheme: V2,
        activityDefinition: {
          "@context": "https://w3id.org/xapi/profiles/activity-context",
          type: EVENT,
          name: en("100 Meter Dash"),
          description: en("Represents the 100 meter dash as a general category of race."),
        },
      },
    ],
    templates: [
      {
        id: START,
        type: "StatementTemplate",
        inScheme: V2,
        prefLabel: en("Start"),
        definition: en("The first runner starts the event."),
        verb: "http://adlnet.gov/expapi/verbs/attempted",
        objectActivityType: EVENT,
      },
      {
        id: HANDOFF,
        type: "StatementTemplate",
        inScheme: V2,
        prefLabel: en("Handoff"),
        definition: en("A runner receives the baton."),
        verb: "http://adlnet.gov/expapi/verbs/progressed",
        objectActivityType: EVENT,
      },
      {
        id: PLACING,
        type: "StatementTemplate",
        inScheme: V2,
        prefLabel: en("Placing"),
        definition: en("Records the actor placing in a particular event."),
        verb: PLACED,
        objectActivityType: EVENT,
        contextGroupingActivityType: [EVENT],
        rules: [{ location: `$.result.extensions['${SPORTS}/extensions/place']`, presence: "included" }],
      },
    ],
    patterns: [
      {
        id: RELAY,
        type: "Pattern",
        primary: true,
        inScheme: V2,
        prefLabel: en("Relay Race"),
        definition: en("A detailed recording of a relay race by a team in track and field."),
        sequence: [START, HANDOFFS, PLACING],
      },
      {
        id: HANDOFFS,
        type: "Pattern",
        inScheme: V2,
        definition: en("The actor of each handoff Statement is the runner receiving the baton."),
        oneOrMore: HANDOFF,
      },
    ],
  };
}

/** Another profile, which defines a template and a verb that the sound profile may name. */
export function otherProfile(): Json {
  return {
    "@context": "https://w3id.org/xapi/profiles/context",
    id: "https://example.org/profiles/timing",
    type: "Profile",
    conformsTo: "https://w3id.org/xapi/profiles#1.0",
    prefLabel: en("Timing"),
    definition: en("Times of events."),
    versions: [{ id: "https://example.org/profiles/timing/v1", generatedAtTime: "2019-01-01T00:00:00Z" }],
    author: { type: "Person", name: "A. Timer" },
    concepts: [
      {
        id: "https://example.org/profiles/timing/verbs/timed",
        type: "Verb",
        inScheme: "https://example.org/profiles/timing/v1",
        prefLabel: en("timed"),
        definition: en("Measured the time of an event."),
      },
    ],
    templates: [
      {
        id: "https://example.org/profiles/timing/templates/timed",
        type: "StatementTemplate",
        inScheme: "https://example.org/profiles/timing/v1",
        prefLabel: en("Timed"),
        definition: en("The time of an event."),
        verb: "https://example.org/profiles/timing/verbs/timed",
      },
    ],
  };
}

/** Adds a Pattern to the sound profile. */
const addPattern = (pattern: Json) => (profile: Json) =>
  set("patterns", [...(profile.patterns as Json[]), pattern])(profile);

/** The rules that a profile breaks. */
export const REFUSALS: readonly ProfileRule[] = [
  {
    source: "4.0",
    text: "Values in a Profile MUST NOT be empty strings",
    fixture: set("concepts.0.prefLabel.en", ""),
    findings: [error("concepts[0].prefLabel.en", "empty-value")],
  },
  {
    source: "4.0",
    text: "Values in a Profile MUST NOT be empty arrays",
    fixture: set("concepts.0.broadMatch", []),
    findings: [error("concepts[0].broadMatch", "empty-value")],
  },
  {
    source: "4.0",
    text: "Values in a Profile MUST NOT be null or empty objects",
    fixture: set("templates.2.rules.0.any", [null, {}]),
    findings: [
      error("templates[2].rules[0].any[0]", "empty-value"),
      error("templates[2].rules[0].any[1]", "empty-value"),
    ],
  },
  {
    source: "4.0",
    text: "All properties that are not JSON-LD keywords and not described by this specification MUST be expressed using compact IRIs or absolute IRIs",
    fixture: set("concepts.0.note", "A verb of the examples."),
    findings: [error("concepts[0]", "unknown-property")],
  },
  {
    source: "4.0",
    text: "All properties in tables are required in all cases unless marked optional",
    fixture: remove("author"),
    findings: [error("author", "missing-property")],
  },
  {
    source: "6.0",
    text: "@context MUST contain https://w3id.org/xapi/profiles/context if array-valued",
    fixture: set("@context", ["https://example.org/context"]),
    findings: [error("@context", "context")],
  },
  {
    source: "6.0",
    text: "type MUST be Profile",
    fixture: set("type", "Vocabulary"),
    findings: [error("type", "invalid-value")],
  },
  {
    source: "6.1",
    text: "wasRevisionOf MUST be used with all versions that succeed other Profile versions",
    fixture: remove("versions.0.wasRevisionOf"),
    findings: [error("versions[0]", "revision-missing")],
  },
  {
    source: "6.1",
    text: "every Profile version id is unique and different from the overall Profile URI",
    fixture: set("versions.1.id", SPORTS),
    findings: [error("versions[1].id", "id-repeated")],
  },
  {
    source: "6.2",
    text: "the author is an Organization or a Person",
    fixture: set("author.type", "Group"),
    findings: [error("author.type", "invalid-value")],
  },
  {
    source: "7.0",
    text: "All Concepts in a Profile MUST follow the rules of one of the subsections within this section",
    fixture: set("concepts.3.type", "Term"),
    findings: [error("concepts[3].type", "invalid-value")],
  },
  {
    source: "7.0",
    text: "A Profile MUST NOT define a Concept that is defined in another Profile unless it supersedes all versions of the other Profile containing the Concept",
    fixture: set("concepts.2.id", "https://example.org/profiles/timing/verbs/timed"),
    profiles: [otherProfile()],
    findings: [error("concepts[2].id", "defined-elsewhere")],
  },
  {
    source: "7.1",
    text: "inScheme is the IRI of the specific Profile version currently being described",
    fixture: set("concepts.3.inScheme", `${SPORTS}/v3`),
    findings: [error("concepts[3].inScheme", "in-scheme")],
  },
  {
    source: "7.1",
    text: "broader names Concepts of the same type from this Profile version",
    fixture: set("concepts.1.broader", [EVENT]),
    findings: [error("concepts[1].broader[0]", "relation-target")],
  },
  {
    source: "7.1",
    text: "broadMatch names Concepts of the same type from a different Profile",
    fixture: set("concepts.0.broadMatch", [MEDALED]),
    findings: [error("concepts[0].broadMatch[0]", "relation-target")],
  },
  {
    source: "7.1",
    text: "exactMatch names Concepts from a different Profile or a different version of the same Profile",
    fixture: set("concepts.2.exactMatch", [PLACED]),
    findings: [error("concepts[2].exactMatch[0]", "relation-target")],
  },
  {
    source: "7.1",
    text: "related MUST only be used on Concepts that are deprecated",
    fixture: set("concepts.1.related", [PLACED]),
    findings: [error("concepts[1].related", "related-deprecated")],
  },
  {
    source: "7.2",
    text: "recommendedActivityTypes is only allowed on an ActivityExtension",
    fixture: set("concepts.4.recommendedActivityTypes", [EVENT]),
    findings: [error("concepts[4].recommendedActivityTypes", "recommended-activity-types")],
  },
  {
    source: "7.2",
    text: "recommendedVerbs is only allowed on a ContextExtension or a ResultExtension",
    fixture: set("concepts.4.type", "ActivityExtension"),
    findings: [error("concepts[4].recommendedVerbs", "recommended-verbs")],
  },
  {
    source: "7.2",
    text: "Profiles MUST use at most one of schema and inlineSchema for Extensions",
    fixture: set("concepts.4.schema", "https://example.org/schemas/place.json"),
    findings: [error("concepts[4]", "schema-and-inline-schema")],
  },
  {
    source: "7.2",
    text: "inlineSchema is a JSON Schema, as a string",
    fixture: set("concepts.4.inlineSchema", "{ type: object }"),
    findings: [error("concepts[4].inlineSchema", "inline-schema")],
  },
  {
    source: "7.3",
    text: "contentType is the media type for the resource, as described in RFC 2046",
    fixture: set("concepts.5.contentType", "json"),
    findings: [error("concepts[5].contentType", "invalid-format")],
  },
  {
    source: "7.3",
    text: "Profiles MUST use at most one of schema and inlineSchema for Document Resources",
    fixture: set("concepts.5.schema", "https://example.org/schemas/tshirt.json"),
    findings: [error("concepts[5]", "schema-and-inline-schema")],
  },
  {
    source: "7.4",
    text: "the @context of an activityDefinition MUST contain https://w3id.org/xapi/profiles/activity-context if array-valued",
    fixture: set("concepts.6.activityDefinition.@context", ["https://example.org/context"]),
    findings: [error("concepts[6].activityDefinition.@context", "context")],
  },
  {
    source: "7.4",
    text: "Except for @context, the activityDefinition in this Concept MUST be a legal xAPI Activity Definition",
    fixture: set("concepts.6.activityDefinition.interactionType", "slider"),
    findings: [error("concepts[6].activityDefinition.interactionType", "invalid-value")],
  },
  {
    source: "7.4",
    text: "Profile Authors MUST include a JSON-LD @context in all top-level objects of extensions",
    fixture: set("concepts.6.activityDefinition.extensions", { [`${SPORTS}/extensions/venue`]: { city: "Jakarta" } }),
    findings: [error(`concepts[6].activityDefinition.extensions.${SPORTS}/extensions/venue`, "extension-context")],
  },
  {
    source: "8.0",
    text: "A Statement Template MUST NOT have both objectStatementRefTemplate and objectActivityType",
    fixture: set("templates.1.objectStatementRefTemplate", [START]),
    findings: [error("templates[1]", "object-type-and-reference")],
  },
  {
    source: "8.0",
    text: "objectStatementRefTemplate is an array of Statement Template identifiers from this Profile version",
    fixture: all(
      remove("templates.1.objectActivityType"),
      set("templates.1.objectStatementRefTemplate", [`${SPORTS}/templates/finish`]),
    ),
    findings: [error("templates[1].objectStatementRefTemplate[0]", "statement-ref-template")],
  },
  {
    source: "8.0",
    text: "verb is the IRI of a Verb",
    fixture: set("templates.0.verb", EVENT),
    findings: [error("templates[0].verb", "determining-property")],
  },
  {
    source: "8.1",
    text: "A Statement Template Rule MUST include one or more of presence, any, all, or none",
    fixture: remove("templates.2.rules.0.presence"),
    findings: [error("templates[2].rules[0]", "rule-requirement")],
  },
  {
    source: "8.1",
    text: "presence is included, excluded, or recommended",
    fixture: set("templates.2.rules.0.presence", "required"),
    findings: [error("templates[2].rules[0].presence", "invalid-value")],
  },
  {
    source: "8.1",
    text: "Filter and script expressions MUST NOT be used",
    fixture: set("templates.2.rules.0.location", "$.context.contextActivities.grouping[?(@.id)]"),
    findings: [error("templates[2].rules[0].location", "json-path")],
  },
  {
    source: "8.1",
    text: "The legal values in an array or child expression are strings, non-negative integers, the star and unions of these",
    fixture: set("templates.2.rules.0.location", "$.context.contextActivities.grouping[-1]"),
    findings: [error("templates[2].rules[0].location", "json-path")],
  },
  {
    source: "8.1",
    text: "location is a JSONPath, which starts at the root $",
    fixture: set("templates.2.rules.0.location", "result.extensions"),
    findings: [error("templates[2].rules[0].location", "json-path")],
  },
  {
    source: "8.1",
    text: "selector is a JSONPath",
    fixture: set("templates.2.rules.0.selector", "$.rank[0:2]"),
    findings: [error("templates[2].rules[0].selector", "json-path")],
  },
  {
    source: "9.0",
    text: "A primary Pattern MUST include prefLabel and definition",
    fixture: remove("patterns.0.prefLabel"),
    findings: [error("patterns[0]", "primary-description")],
  },
  {
    source: "9.0",
    text: "A Pattern MUST contain exactly one of alternates, optional, oneOrMore, sequence, and zeroOrMore",
    fixture: set("patterns.1.zeroOrMore", HANDOFF),
    findings: [error("patterns[1]", "pattern-kind")],
  },
  {
    source: "9.0",
    text: "Profile Authors MUST NOT put optional or zeroOrMore directly inside alternates",
    fixture: all(
      set("patterns.1.zeroOrMore", HANDOFF),
      remove("patterns.1.oneOrMore"),
      addPattern({ id: `${SPORTS}/patterns/either`, type: "Pattern", inScheme: V2, alternates: [HANDOFFS, START] }),
    ),
    findings: [error("patterns[2].alternates[0]", "alternates-optional")],
  },
  {
    source: "9.0",
    text: "Profile Authors MUST NOT include any Pattern within itself, or within any Pattern within itself, or at any depth",
    fixture: all(set("patterns.1.oneOrMore", RELAY)),
    findings: [error("patterns[0]", "pattern-cycle"), error("patterns[1]", "pattern-cycle")],
  },
  {
    source: "9.0",
    text: "Profile Authors MUST include at least two members in alternates",
    fixture: addPattern({ id: `${SPORTS}/patterns/either`, type: "Pattern", inScheme: V2, alternates: [START] }),
    findings: [error("patterns[2].alternates", "alternates-members")],
  },
  {
    source: "9.0",
    text: "Profile Authors MUST include at least two members in sequence, unless sequence is in a primary Pattern that is not used elsewhere and the member is a single Statement Template",
    fixture: all(remove("patterns.1.oneOrMore"), set("patterns.1.sequence", [HANDOFF])),
    findings: [error("patterns[1].sequence", "sequence-members")],
  },
  {
    source: "9.0",
    text: "the members of a Pattern are Pattern or Statement Template identifiers",
    fixture: set("patterns.0.sequence.2", PLACED),
    findings: [error("patterns[0].sequence[2]", "member-type")],
  },
];

/** The recommendations, and what a profile may do that a validator only notes. */
export const ADVISORIES: readonly ProfileRule[] = [
  {
    source: "6.0",
    text: "@context SHOULD be https://w3id.org/xapi/profiles/context",
    fixture: set("@context", "https://example.org/profiles/context"),
    findings: [warning("@context", "context")],
  },
  {
    source: "6.0",
    text: "conformsTo is the canonical URI of the Profile specification version conformed to: https://w3id.org/xapi/profiles#1.0",
    fixture: set("conformsTo", "https://w3id.org/xapi/profiles#2.0"),
    findings: [warning("conformsTo", "conforms-to")],
  },
  {
    source: "4.0",
    text: "a property that this specification describes for another object expands to an IRI, and has no meaning where it stands",
    fixture: set("concepts.4.exactMatch", ["https://example.org/extensions/rank"]),
    findings: [warning("concepts[4]", "property-out-of-place")],
  },
  {
    source: "7.2",
    text: "JSON Schema expressions SHOULD adhere to the Draft-07 version of the JSON Schema specification",
    fixture: set(
      "concepts.4.inlineSchema",
      '{ "$schema": "http://json-schema.org/draft-04/schema#", "type": "object" }',
    ),
    findings: [warning("concepts[4].inlineSchema", "inline-schema-draft")],
  },
  {
    source: "7.4",
    text: "the @context of an activityDefinition SHOULD be https://w3id.org/xapi/profiles/activity-context",
    fixture: set("concepts.6.activityDefinition.@context", "https://example.org/activity-context"),
    findings: [warning("concepts[6].activityDefinition.@context", "context")],
  },
  {
    source: "9.0",
    text: "Profile Authors MAY re-use Statement Templates from other Profiles in Patterns: one that no profile given defines cannot be checked",
    fixture: set("patterns.1.oneOrMore", "https://example.org/profiles/timing/templates/timed"),
    findings: [warning("patterns[1].oneOrMore", "member-unresolved")],
  },
];

/** What a profile may do, which the validator accepts with no finding. */
export const ACCEPTANCES: readonly ProfileRule[] = [
  {
    source: "4.0",
    text: "JSON-LD keywords that are not specified as properties in this document MAY be included anywhere they are legal in JSON-LD",
    fixture: set("concepts.0.@language", "en"),
    findings: [],
  },
  {
    source: "4.0",
    text: "a property that the specification does not describe is expressed as a compact or an absolute IRI",
    fixture: all(set("dcterms:license", "https://www.apache.org/licenses/LICENSE-2.0"), (profile) => {
      const copy = structuredClone(profile);
      Object.assign((copy.concepts as Json[])[3] ?? {}, { "https://example.org/terms/note": "A note." });
      return copy;
    }),
    findings: [],
  },
  {
    source: "10.0",
    text: "id and type are aliases of the JSON-LD keywords @id and @type in the context of the specification, legal on any object",
    fixture: set("author.id", "https://example.org"),
    findings: [],
  },
  {
    source: "6.1",
    text: "a Profile with one version names no revision",
    fixture: set("versions", [{ id: V2, generatedAtTime: "2020-02-20T20:20:20Z" }]),
    findings: [],
  },
  {
    source: "7.1",
    text: "related names a possible replacement of a deprecated Concept in the same Profile",
    fixture: all(set("concepts.1.deprecated", true), set("concepts.1.related", [PLACED])),
    findings: [],
  },
  {
    source: "9.0",
    text: "a primary Pattern that is not used elsewhere may have a sequence of a single Statement Template",
    fixture: set("patterns.0.sequence", [PLACING]),
    findings: [],
  },
  {
    source: "9.0",
    text: "Profile Authors MAY re-use Statement Templates from other Profiles in Patterns",
    fixture: set("patterns.1.oneOrMore", "https://example.org/profiles/timing/templates/timed"),
    profiles: [otherProfile()],
    findings: [],
  },
];
