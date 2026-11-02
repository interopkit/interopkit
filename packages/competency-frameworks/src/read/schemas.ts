import {
  absoluteUriSchema,
  dateSchema,
  dateTimeSchema,
  finiteSchema,
  guardSchema,
  jsonObjectSchema,
  type Schema,
  strictRecord,
  uuidSchema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import {
  ASSOCIATION_TYPES,
  type AssociationType,
  type CaseEntity,
  type CaseEntityKind,
  type CasePackage,
  type CaseVersion,
  type ExtensionTerm,
  STATUS_CODES_MAJOR,
  STATUS_CODES_MINOR,
  STATUS_SEVERITIES,
  type TargetType,
} from "../model/index.js";
import { ASSOCIATION_TYPES_1_0, INFORMATION_MODEL_UUID } from "../model/internal.js";
import { isExtensionTerm } from "./extension-term.js";

/** The schemas that read the data of one version, and the properties of each class. */
export interface CaseSchemas {
  /** Reads a package. */
  readonly package: Schema<CasePackage>;
  /** Reads an entity of each kind. */
  readonly entities: Readonly<Record<CaseEntityKind, Schema<CaseEntity>>>;
  /** The schema of each property that a class has in this version, by the name that the JSON schemas give the class. */
  readonly classes: ReadonlyMap<string, v.ObjectEntries>;
}

const text = v.string();
const integer = v.pipe(v.number(), v.integer());

/** The schema of a list of at least one entry, which the Information Model gives the multiplicity `[1..unbounded]`. */
function nonEmpty<const TItem extends v.GenericSchema>(item: TItem) {
  return v.pipe(v.array(item), v.minLength(1));
}

/**
 * Returns a function that leaves one member out of an object that the schema of the object has read: a copy without it, or the
 * object itself when it has no such member.
 */
function leaveOut<const TKey extends string>(key: TKey) {
  return <TValue extends { readonly [K in TKey]?: unknown }>(value: TValue): Omit<TValue, TKey> => {
    if (!Object.hasOwn(value, key)) return value;
    const { [key]: _left, ...rest } = value;
    return rest;
  };
}

const informationModelUuid = v.pipe(
  v.string(),
  v.regex(
    INFORMATION_MODEL_UUID,
    (issue) => `expected a UUID of lower-case digits, of version 1 to 5, found ${issue.received}`,
  ),
);

const targetType = guardSchema(
  (value): value is TargetType => typeof value === "string" && (value === "CASE" || isExtensionTerm(value)),
  "CASE or a term of ext: and a name",
);

/**
 * Builds the schemas of one version: 1.1 adds properties to the classes of 1.0, and 1.0 holds each identifier and URI to a
 * stricter form.
 */
function build(version: CaseVersion): CaseSchemas {
  const is11 = version === "1.1";
  const identifier = is11 ? uuidSchema : informationModelUuid;
  const uri = is11 ? text : absoluteUriSchema;
  const associationTypes = is11 ? ASSOCIATION_TYPES : ASSOCIATION_TYPES_1_0;
  const associationType = guardSchema(
    (value): value is AssociationType | ExtensionTerm =>
      typeof value === "string" && (associationTypes.includes(value) || (is11 && isExtensionTerm(value))),
    `${associationTypes.join(", ")}${is11 ? " or a term of ext: and a name" : ""}`,
  );
  const classes = new Map<string, v.ObjectEntries>();

  /** An object class with the properties of 1.0, and those that 1.1 adds. */
  const object = <const TBase extends v.ObjectEntries, const TAdded extends v.ObjectEntries>(
    name: string,
    base: TBase,
    added: TAdded,
  ) => {
    classes.set(name, is11 ? { ...base, ...added } : base);
    return is11 ? strictRecord({ ...base, ...added }) : strictRecord(base);
  };

  const linkUri = object("LinkURI", { title: text, identifier, uri }, {});
  const linkGenUri = object(
    "LinkGenURI",
    { title: text, identifier: text, uri },
    { targetType: v.optional(targetType) },
  );
  const optionalLink = v.optional(linkUri);
  const optionalText = v.optional(text);
  const optionalDate = v.optional(dateSchema);
  const added = { extensions: v.optional(jsonObjectSchema) };

  const documentEntries = {
    identifier,
    uri,
    creator: text,
    title: text,
    lastChangeDateTime: dateTimeSchema,
    officialSourceURL: v.optional(uri),
    publisher: optionalText,
    description: optionalText,
    subject: v.optional(v.array(text)),
    subjectURI: v.optional(v.array(linkUri)),
    language: optionalText,
    version: optionalText,
    adoptionStatus: optionalText,
    statusStartDate: optionalDate,
    statusEndDate: optionalDate,
    licenseURI: optionalLink,
    notes: optionalText,
  };
  const documentAdded = { frameworkType: optionalText, caseVersion: v.optional(v.literal("1.1")), ...added };
  const itemEntries = {
    identifier,
    fullStatement: text,
    alternativeLabel: optionalText,
    CFItemType: optionalText,
    uri,
    humanCodingScheme: optionalText,
    listEnumeration: optionalText,
    abbreviatedStatement: optionalText,
    conceptKeywords: v.optional(v.array(text)),
    conceptKeywordsURI: optionalLink,
    notes: optionalText,
    language: optionalText,
    educationLevel: v.optional(v.array(text)),
    CFItemTypeURI: optionalLink,
    licenseURI: optionalLink,
    statusStartDate: optionalDate,
    statusEndDate: optionalDate,
    lastChangeDateTime: dateTimeSchema,
  };
  const itemAdded = { subject: v.optional(v.array(text)), subjectURI: v.optional(v.array(linkUri)), ...added };
  const associationEntries = {
    identifier,
    associationType,
    sequenceNumber: v.optional(integer),
    uri,
    originNodeURI: linkGenUri,
    destinationNodeURI: linkGenUri,
    CFAssociationGroupingURI: optionalLink,
    lastChangeDateTime: dateTimeSchema,
  };
  const associationAdded = { notes: optionalText, ...added };

  // The package form has no link to its document or to its package, and some providers write one all the same: the link is read
  // as the class outside a package has it, and left out (spec-gaps.md); `packageFormIssues` warns of it.
  const packageLink = { CFPackageURI: optionalLink };
  const documentLink = { CFDocumentURI: optionalLink };
  classes.set("CFPckgDocument", is11 ? { ...documentEntries, ...documentAdded } : documentEntries);
  classes.set("CFPckgItem", is11 ? { ...itemEntries, ...itemAdded } : itemEntries);
  classes.set("CFPckgAssociation", is11 ? { ...associationEntries, ...associationAdded } : associationEntries);
  const pckgDocument = v.pipe(
    is11
      ? strictRecord({ ...documentEntries, ...documentAdded, ...packageLink })
      : strictRecord({ ...documentEntries, ...packageLink }),
    v.transform(leaveOut("CFPackageURI")),
  );
  const pckgItem = v.pipe(
    is11
      ? strictRecord({ ...itemEntries, ...itemAdded, ...documentLink })
      : strictRecord({ ...itemEntries, ...documentLink }),
    v.transform(leaveOut("CFDocumentURI")),
  );
  const pckgAssociation = v.pipe(
    is11
      ? strictRecord({ ...associationEntries, ...associationAdded, ...documentLink })
      : strictRecord({ ...associationEntries, ...documentLink }),
    v.transform(leaveOut("CFDocumentURI")),
  );
  const grouping = object(
    "CFAssociationGrouping",
    { identifier, uri, title: text, description: optionalText, lastChangeDateTime: dateTimeSchema },
    added,
  );
  const concept = object(
    "CFConcept",
    {
      identifier,
      uri,
      title: text,
      keywords: optionalText,
      hierarchyCode: text,
      description: optionalText,
      lastChangeDateTime: dateTimeSchema,
    },
    added,
  );
  const subject = object(
    "CFSubject",
    {
      identifier,
      uri,
      title: text,
      hierarchyCode: text,
      description: optionalText,
      lastChangeDateTime: dateTimeSchema,
    },
    added,
  );
  const license = object(
    "CFLicense",
    { identifier, uri, title: text, description: optionalText, licenseText: text, lastChangeDateTime: dateTimeSchema },
    added,
  );
  const itemType = object(
    "CFItemType",
    {
      identifier,
      uri,
      title: text,
      description: text,
      hierarchyCode: text,
      typeCode: optionalText,
      lastChangeDateTime: dateTimeSchema,
    },
    added,
  );
  const definition = object(
    "CFDefinition",
    {
      CFConcepts: v.optional(v.array(concept)),
      CFSubjects: v.optional(v.array(subject)),
      CFLicenses: v.optional(v.array(license)),
      CFItemTypes: v.optional(v.array(itemType)),
      CFAssociationGroupings: v.optional(v.array(grouping)),
    },
    added,
  );
  const level = object(
    "CFRubricCriterionLevel",
    {
      identifier,
      uri,
      description: optionalText,
      quality: optionalText,
      score: v.optional(finiteSchema),
      feedback: optionalText,
      position: v.optional(integer),
      rubricCriterionId: v.optional(identifier),
      lastChangeDateTime: dateTimeSchema,
    },
    // The one class whose `extensions` is a list in the specification.
    { extensions: v.optional(v.array(jsonObjectSchema)) },
  );
  const criterion = object(
    "CFRubricCriterion",
    {
      identifier,
      uri,
      category: optionalText,
      description: optionalText,
      CFItemURI: optionalLink,
      weight: v.optional(finiteSchema),
      position: v.optional(integer),
      rubricId: v.optional(identifier),
      lastChangeDateTime: dateTimeSchema,
      CFRubricCriterionLevels: v.optional(v.array(level)),
    },
    added,
  );
  const rubric = object(
    "CFRubric",
    {
      identifier,
      uri,
      title: optionalText,
      description: optionalText,
      lastChangeDateTime: dateTimeSchema,
      CFRubricCriteria: v.optional(v.array(criterion)),
    },
    added,
  );
  const packageSchema = object(
    "CFPackage",
    {
      CFDocument: pckgDocument,
      CFItems: v.optional(v.array(pckgItem)),
      CFAssociations: v.optional(v.array(pckgAssociation)),
      CFDefinitions: v.optional(definition),
      CFRubrics: v.optional(v.array(rubric)),
    },
    added,
  );

  const document = object("CFDocument", { CFPackageURI: linkUri, ...documentEntries }, documentAdded);
  const item = object("CFItem", { CFDocumentURI: linkUri, ...itemEntries }, itemAdded);
  const association = object("CFAssociation", { CFDocumentURI: optionalLink, ...associationEntries }, associationAdded);
  const codeMinorField = object(
    "imsx_CodeMinorField",
    { imsx_codeMinorFieldName: text, imsx_codeMinorFieldValue: v.picklist(STATUS_CODES_MINOR) },
    {},
  );
  const statusInfo = object(
    "imsx_StatusInfo",
    {
      imsx_codeMajor: v.picklist(STATUS_CODES_MAJOR),
      imsx_severity: v.picklist(STATUS_SEVERITIES),
      imsx_description: optionalText,
      imsx_codeMinor: v.optional(object("imsx_CodeMinor", { imsx_codeMinorField: nonEmpty(codeMinorField) }, {})),
    },
    {},
  );

  return {
    package: packageSchema,
    entities: {
      CFDocument: document,
      CFItem: item,
      CFAssociation: association,
      CFAssociationGrouping: grouping,
      CFConcept: concept,
      CFSubject: subject,
      CFLicense: license,
      CFItemType: itemType,
      CFRubric: rubric,
      CFDocumentSet: object("CFDocumentSet", { CFDocuments: nonEmpty(document) }, {}),
      CFAssociationSet: object("CFAssociationSet", { CFItem: item, CFAssociations: nonEmpty(pckgAssociation) }, {}),
      CFConceptSet: object("CFConceptSet", { CFConcepts: nonEmpty(concept) }, {}),
      CFSubjectSet: object("CFSubjectSet", { CFSubjects: nonEmpty(subject) }, {}),
      CFItemTypeSet: object("CFItemTypeSet", { CFItemTypes: nonEmpty(itemType) }, {}),
      imsx_StatusInfo: statusInfo,
    },
    classes,
  };
}

/** The schemas of each version, built once. */
export const SCHEMAS: Readonly<Record<CaseVersion, CaseSchemas>> = { "1.0": build("1.0"), "1.1": build("1.1") };
