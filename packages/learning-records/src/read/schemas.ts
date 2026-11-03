import {
  absoluteUriSchema,
  dateTimeSchema,
  finiteSchema,
  guardSchema,
  isAbsoluteUri,
  isLanguageTag,
  isRecord,
  type JsonObject,
  jsonObjectSchema,
  languageTagSchema,
  mapSchema,
  type Schema,
  strictRecord,
  uuidSchema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import {
  type About,
  type Activity,
  type Actor,
  type Agent,
  type AttachmentData,
  INTERACTION_TYPES,
  isDuration,
  type LanguageMap,
  type Person,
  type Statement,
  type XapiVersion,
} from "../model/index.js";
import { isIsoTimestamp, isMailtoIri, isMediaType, isSha1Hex, isSha2Hex } from "../model/internal.js";

const text = v.string();
/** An IRI, an IRL or a URI of the tables: the Statements need a scheme (4.2.1). */
const iri = absoluteUriSchema;

const duration = v.pipe(
  v.string(),
  v.check(isDuration, (issue) => `expected an ISO 8601 duration such as PT1H30M, found ${issue.received}`),
);

const mbox = v.pipe(
  v.string(),
  v.check(
    isMailtoIri,
    (issue) => `expected a mailto IRI with one address, such as mailto:learner@example.org, found ${issue.received}`,
  ),
);

const mboxSha1sum = v.pipe(
  v.string(),
  v.check(isSha1Hex, (issue) => `expected a SHA-1 hash as 40 hexadecimal digits, found ${issue.received}`),
);

const sha2 = v.pipe(
  v.string(),
  v.check(
    isSha2Hex,
    (issue) => `expected a SHA-2 hash as 56, 64, 96 or 128 hexadecimal digits, found ${issue.received}`,
  ),
);

/** An Internet media type with its parameters. */
export const mediaTypeSchema: Schema<string> = v.pipe(
  v.string(),
  v.check(
    isMediaType,
    (issue) => `expected an Internet media type, such as text/plain; charset=utf-8, found ${issue.received}`,
  ),
);

/** Bytes. */
export const bytesSchema = guardSchema((value): value is Uint8Array => value instanceof Uint8Array, "a Uint8Array");

/** The issue of a key of a map that is not allowed, which points at the key. */
function keyIssue(
  input: Readonly<Record<string, unknown>>,
  key: string,
  expected: string,
): { readonly message: string; readonly path: [v.ObjectPathItem] } {
  return {
    message: `expected ${expected}, found ${JSON.stringify(key)}`,
    path: [{ type: "object", origin: "key", input, key, value: input[key] }],
  };
}

/** Checks the keys of a map one by one, and points at each key that `valid` refuses. */
function keysAre<TMap extends Readonly<Record<string, unknown>>>(valid: (key: string) => boolean, expected: string) {
  return v.rawCheck<TMap>(({ dataset, addIssue }) => {
    // The action runs after a schema that refused the value too, and then there is no map to look at.
    if (!dataset.typed) return;
    for (const key of Object.keys(dataset.value)) {
      if (!valid(key)) addIssue(keyIssue(dataset.value, key, expected));
    }
  });
}

/** The map of other properties, whose keys are IRIs (4.2.7). A key such as `__proto__` is data here, and is not an IRI. */
const extensions = v.pipe(
  jsonObjectSchema,
  keysAre<JsonObject>(isAbsoluteUri, "an IRI as the key, such as https://example.org/x"),
);

/** The map from a language tag to a string (4.2.7). A key such as `__proto__` is data here, and is not a language tag. */
const languageMap: Schema<LanguageMap> = v.pipe(
  mapSchema(text),
  v.transform((entries): LanguageMap => Object.fromEntries(entries)),
  keysAre<LanguageMap>(isLanguageTag, "a language tag of RFC 5646 as the key"),
);

/** The languages that a reader prefers, the first the most: language tags, or `*` for any. */
export const languageRangesSchema: Schema<readonly string[]> = v.array(
  v.pipe(
    v.string(),
    v.check(
      (range) => range === "*" || isLanguageTag(range),
      (issue) => `expected a language tag of RFC 5646 or *, found ${issue.received}`,
    ),
  ),
);

/** A list of at least one entry, which `relevantTypes` is when it is present (4.2.2.5). */
function nonEmpty<const TItem extends v.GenericSchema>(item: TItem) {
  return v.pipe(v.array(item), v.minLength(1));
}

/** The schema of one item or a list of them, read as a list: the LRS returns a single Activity as a list of one (4.2.4.2). */
function oneOrMany<T>(item: Schema<T>): Schema<readonly T[]> {
  const many = v.array(item);
  const one = v.pipe(
    item,
    v.transform((value): readonly T[] => [value]),
  );
  return v.lazy((input) => (Array.isArray(input) ? many : one));
}

/** Refuses what is not an object before a variant looks for its discriminator, since valibot reads an array as an object. */
export const objectGuard = guardSchema(isRecord, "an object");

const account = strictRecord({ homePage: iri, name: text });

const identifierEntries = {
  mbox: v.optional(mbox),
  mbox_sha1sum: v.optional(mboxSha1sum),
  openid: v.optional(iri),
  account: v.optional(account),
};
const agentEntries = { name: v.optional(text), ...identifierEntries };
const groupEntries = {
  objectType: v.literal("Group"),
  name: v.optional(text),
  ...identifierEntries,
};

const agentProperties = { objectType: v.optional(v.literal("Agent")), ...agentEntries };
const agent = strictRecord(agentProperties);
const groupProperties = { ...groupEntries, member: v.optional(v.array(agent)) };
const group = strictRecord(groupProperties);

/** An Agent or a Group, told apart by `objectType`, which an Agent may leave out. */
const actor = v.pipe(
  objectGuard,
  v.variant(
    "objectType",
    [v.strictObject(agentProperties), v.strictObject(groupProperties)],
    (issue) => `expected "Agent" or "Group", found ${issue.received}`,
  ),
);

const verb = strictRecord({ id: iri, display: v.optional(languageMap) });

const interactionComponent = strictRecord({ id: text, description: v.optional(languageMap) });
const componentList = v.optional(v.array(interactionComponent));

const activityDefinition = strictRecord({
  name: v.optional(languageMap),
  description: v.optional(languageMap),
  type: v.optional(iri),
  moreInfo: v.optional(iri),
  extensions: v.optional(extensions),
  interactionType: v.optional(v.picklist(INTERACTION_TYPES)),
  correctResponsesPattern: v.optional(v.array(text)),
  choices: componentList,
  scale: componentList,
  source: componentList,
  target: componentList,
  steps: componentList,
});

const activityProperties = {
  objectType: v.optional(v.literal("Activity")),
  id: iri,
  definition: v.optional(activityDefinition),
};
const activity = strictRecord(activityProperties);

const statementRef = { objectType: v.literal("StatementRef"), id: uuidSchema };

const score = strictRecord({
  scaled: v.optional(finiteSchema),
  raw: v.optional(finiteSchema),
  min: v.optional(finiteSchema),
  max: v.optional(finiteSchema),
});

const result = strictRecord({
  score: v.optional(score),
  success: v.optional(v.boolean()),
  completion: v.optional(v.boolean()),
  response: v.optional(text),
  duration: v.optional(duration),
  extensions: v.optional(extensions),
});

const activities = v.optional(oneOrMany(activity));
const contextActivities = strictRecord({
  parent: activities,
  grouping: activities,
  category: activities,
  other: activities,
});

/** The properties of a context that both versions have (4.2.2.5; 1.0.3 Data 2.4.6). */
const contextEntries = {
  registration: v.optional(uuidSchema),
  instructor: v.optional(actor),
  team: v.optional(group),
  contextActivities: v.optional(contextActivities),
  revision: v.optional(text),
  platform: v.optional(text),
  language: v.optional(languageTagSchema),
  statement: v.optional(strictRecord(statementRef)),
  extensions: v.optional(extensions),
};

/** The context of xAPI 2.0, which adds the Agents and Groups that take part with their relevant types (4.2.2.5). */
const context = strictRecord({
  ...contextEntries,
  contextAgents: v.optional(
    v.array(strictRecord({ objectType: v.literal("contextAgent"), agent, relevantTypes: v.optional(nonEmpty(iri)) })),
  ),
  contextGroups: v.optional(
    v.array(strictRecord({ objectType: v.literal("contextGroup"), group, relevantTypes: v.optional(nonEmpty(iri)) })),
  ),
});

/** The context of xAPI 1.0.3, which has no `contextAgents` and no `contextGroups` (Data 2.4.6). */
const contextV1 = strictRecord(contextEntries);

/** A Timestamp of xAPI 1.0.3: ISO 8601 with a time zone (Data 4.5). */
const isoTimestamp = v.pipe(
  v.string(),
  v.check(
    isIsoTimestamp,
    (issue) =>
      `expected a date and time as ISO 8601 with a time zone, such as 2024-06-13T18:46:03.250Z, found ${issue.received}`,
  ),
);

/** What the Statements of the two versions write differently: the form of a Timestamp, and the properties of a context. */
const FORMS = {
  "2.0.0": { time: dateTimeSchema, context },
  "1.0.3": { time: isoTimestamp, context: contextV1 },
} as const;

/** The forms of one version. */
type Forms = (typeof FORMS)[XapiVersion];

const attachment = strictRecord({
  usageType: iri,
  display: languageMap,
  description: v.optional(languageMap),
  contentType: mediaTypeSchema,
  length: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  sha2,
  fileUrl: v.optional(iri),
});

/** Reads the data of an Attachment: the hash that names them, their media type and the bytes. */
export const attachmentDataSchema: Schema<AttachmentData> = strictRecord({
  sha2,
  contentType: mediaTypeSchema,
  body: bytesSchema,
});

/** Reads an Agent, as a request names one for a query or a document. */
export const agentSchema: Schema<Agent> = agent;

/** Reads an Agent or a Group, as a request names one for a query. */
export const actorSchema: Schema<Actor> = actor;

/** Reads an Activity as the Activities resource returns it (4.1.6.4). */
export const activitySchema: Schema<Activity> = activity;

/** Reads the Person that the Agents resource returns (4.1.6.3): the identifiers of an Agent, each as a list. */
export const personSchema: Schema<Person> = strictRecord({
  objectType: v.literal("Person"),
  name: v.optional(v.array(text)),
  mbox: v.optional(v.array(mbox)),
  mbox_sha1sum: v.optional(v.array(mboxSha1sum)),
  openid: v.optional(v.array(iri)),
  account: v.optional(v.array(account)),
});

/** Reads what the About resource returns (4.1.6.7). */
export const aboutSchema: Schema<About> = strictRecord({
  version: v.pipe(v.array(text), v.minLength(1)),
  extensions: v.optional(jsonObjectSchema),
});

/** The options of an Object that a SubStatement may have, told apart by `objectType`. */
const subStatementObjects = [
  v.strictObject(activityProperties),
  v.strictObject({ ...agentProperties, objectType: v.literal("Agent") }),
  v.strictObject(groupProperties),
  v.strictObject(statementRef),
] as const;

/** The properties that a Statement and a SubStatement share, around the Object that each allows, in the forms of a version. */
function statementProperties<const TObject extends v.GenericSchema>(object: TObject, forms: Forms) {
  return {
    actor,
    verb,
    object,
    result: v.optional(result),
    context: v.optional(forms.context),
    timestamp: v.optional(forms.time),
    attachments: v.optional(v.array(attachment)),
  };
}

/** The Object of a SubStatement: an Activity, an Agent, a Group or a Statement Reference, but no SubStatement (4.2.4.2). */
const subStatementObject = v.pipe(
  objectGuard,
  v.variant(
    "objectType",
    subStatementObjects,
    (issue) => `expected "Activity", "Agent", "Group" or "StatementRef", found ${issue.received}`,
  ),
);

/** Builds the schema of a Statement in the forms of a version. */
function statementOf(forms: Forms): Schema<Statement> {
  const subStatement = v.strictObject({
    objectType: v.literal("SubStatement"),
    ...statementProperties(subStatementObject, forms),
  });
  /** The Object of a Statement, told apart by `objectType`, which an Activity may leave out (4.2.2.3). */
  const statementObject = v.pipe(
    objectGuard,
    v.variant(
      "objectType",
      [...subStatementObjects, subStatement],
      (issue) => `expected "Activity", "Agent", "Group", "StatementRef" or "SubStatement", found ${issue.received}`,
    ),
  );
  return strictRecord({
    id: v.optional(uuidSchema),
    ...statementProperties(statementObject, forms),
    stored: v.optional(forms.time),
    authority: v.optional(actor),
    version: v.optional(text),
  });
}

/**
 * Reads a Statement of a version into the model: every property, its type and its form. The rules between properties are in
 * `rules.ts`.
 */
export const STATEMENT_SCHEMAS: Readonly<Record<XapiVersion, Schema<Statement>>> = {
  "2.0.0": statementOf(FORMS["2.0.0"]),
  "1.0.3": statementOf(FORMS["1.0.3"]),
};
