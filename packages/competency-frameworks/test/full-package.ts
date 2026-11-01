import type {
  CaseEntity,
  CaseEntityKind,
  CasePackage,
  CFAssociationSet,
  CFConceptSet,
  CFDocumentSet,
  CFItemTypeSet,
  CFPckgAssociation,
  CFPckgItem,
  CFSubjectSet,
  ImsxStatusInfo,
  LinkURI,
} from "../src/index.js";

/** The identifier of the entity with a number: a UUID of version 4 in the form that the Information Model gives. */
export function id(number: number): string {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

/** The URI that an entity of a framework has at a provider. */
export function uri(kind: string, number: number): string {
  return `https://case.example.edu/ims/case/v1p1/${kind}/${id(number)}`;
}

/** The link to an entity of the package. */
function link(kind: string, number: number, title: string): LinkURI {
  return { title, identifier: id(number), uri: uri(kind, number) };
}

const TIME = "2024-06-13T18:46:03+00:00";
const DOCUMENT_ID = 1;
const PARENT_ID = 2;
const CHILD_ID = 3;
const SIBLING_ID = 4;
const CONCEPT_ID = 10;
const SUBJECT_ID = 11;
const LICENSE_ID = 12;
const ITEM_TYPE_ID = 13;
const GROUPING_ID = 14;
const RUBRIC_ID = 20;
const CRITERION_ID = 21;
const LEVEL_ID = 22;

/**
 * A package of CASE 1.1 in which every class has every property, whose links resolve and whose URIs agree, so that it has no
 * finding. Each call returns a new package, which a test may change.
 */
export function fullPackage(): CasePackage {
  const subjectLink = () => link("CFSubjects", SUBJECT_ID, "Mathematics");
  const parent: CFPckgItem = {
    identifier: id(PARENT_ID),
    fullStatement: "Understand **fractions** as numbers, $a/b$.",
    alternativeLabel: "Outcome",
    CFItemType: "Domain",
    uri: uri("CFItems", PARENT_ID),
    humanCodingScheme: "NF",
    listEnumeration: "1",
    abbreviatedStatement: "Fractions",
    conceptKeywords: ["fraction", "number line"],
    conceptKeywordsURI: link("CFConcepts", CONCEPT_ID, "Fractions"),
    notes: "A clarifying statement.",
    subject: ["Mathematics"],
    subjectURI: [subjectLink()],
    language: "eng",
    educationLevel: ["03", "04"],
    CFItemTypeURI: link("CFItemTypes", ITEM_TYPE_ID, "Domain"),
    licenseURI: link("CFLicenses", LICENSE_ID, "CC BY"),
    statusStartDate: "2024-08-01",
    statusEndDate: "2030-07-31",
    lastChangeDateTime: TIME,
    extensions: { sourceItemIdentifier: "NF.1", nested: { list: [1, 2.5, null, true, "text"] } },
  };
  const child: CFPckgItem = {
    identifier: id(CHILD_ID),
    fullStatement: "Partition a whole into equal parts.",
    uri: uri("CFItems", CHILD_ID),
    lastChangeDateTime: TIME,
  };
  const sibling: CFPckgItem = {
    identifier: id(SIBLING_ID),
    fullStatement: "Compare two fractions with the same numerator.",
    uri: uri("CFItems", SIBLING_ID),
    lastChangeDateTime: TIME,
  };
  const childOfDocument: CFPckgAssociation = {
    identifier: id(30),
    associationType: "isChildOf",
    sequenceNumber: 1,
    uri: uri("CFAssociations", 30),
    originNodeURI: { title: "NF", identifier: id(PARENT_ID), uri: uri("CFItems", PARENT_ID), targetType: "CASE" },
    destinationNodeURI: { title: "Mathematics", identifier: id(DOCUMENT_ID), uri: uri("CFDocuments", DOCUMENT_ID) },
    CFAssociationGroupingURI: link("CFAssociationGroupings", GROUPING_ID, "Structure"),
    lastChangeDateTime: TIME,
    notes: "The domain heads the framework.",
    extensions: { weight: 1 },
  };
  const childOfParent = (number: number, origin: CFPckgItem, sequenceNumber: number): CFPckgAssociation => ({
    identifier: id(number),
    associationType: "isChildOf",
    sequenceNumber,
    uri: uri("CFAssociations", number),
    originNodeURI: { title: origin.fullStatement, identifier: origin.identifier, uri: origin.uri },
    destinationNodeURI: { title: "NF", identifier: id(PARENT_ID), uri: uri("CFItems", PARENT_ID) },
    lastChangeDateTime: TIME,
  });
  return {
    CFDocument: {
      identifier: id(DOCUMENT_ID),
      uri: uri("CFDocuments", DOCUMENT_ID),
      frameworkType: "CourseCodes",
      caseVersion: "1.1",
      creator: "Ministry of Education",
      title: "Mathematics",
      lastChangeDateTime: TIME,
      officialSourceURL: "https://education.example.gov/standards/mathematics.pdf",
      publisher: "Standards Office",
      description: "The *mathematics* standards.",
      subject: ["Mathematics"],
      subjectURI: [subjectLink()],
      language: "eng",
      version: "2024",
      adoptionStatus: "Implemented",
      statusStartDate: "2024-08-01",
      statusEndDate: "2030-07-31",
      licenseURI: link("CFLicenses", LICENSE_ID, "CC BY"),
      notes: "Replaces the 2018 standards.",
      extensions: { sourceDocumentIdentifier: "math-2024" },
    },
    CFItems: [parent, child, sibling],
    CFAssociations: [
      childOfDocument,
      childOfParent(31, child, 1),
      childOfParent(32, sibling, 2),
      {
        identifier: id(33),
        associationType: "exactMatchOf",
        uri: uri("CFAssociations", 33),
        originNodeURI: { title: "Partition", identifier: id(CHILD_ID), uri: uri("CFItems", CHILD_ID) },
        destinationNodeURI: {
          title: "Other framework",
          identifier: "9c1f4d8e-5a0b-4a7e-8b2c-6d3e1f0a2b4c",
          uri: "https://standards.example.org/ims/case/v1p1/CFItems/9c1f4d8e-5a0b-4a7e-8b2c-6d3e1f0a2b4c",
          targetType: "CASE",
        },
        lastChangeDateTime: TIME,
      },
      {
        identifier: id(34),
        associationType: "ext:prerequisite",
        uri: uri("CFAssociations", 34),
        originNodeURI: { title: "Compare", identifier: id(SIBLING_ID), uri: uri("CFItems", SIBLING_ID) },
        destinationNodeURI: {
          title: "A lesson video",
          identifier: "lesson-video-7",
          uri: "https://video.example.org/lessons/7",
          targetType: "ext:video",
        },
        lastChangeDateTime: TIME,
      },
      {
        identifier: id(35),
        associationType: "isTranslationOf",
        uri: uri("CFAssociations", 35),
        originNodeURI: { title: "NF", identifier: id(PARENT_ID), uri: uri("CFItems", PARENT_ID) },
        destinationNodeURI: {
          title: "Fractions in Spanish",
          identifier: "b7d2f6a0-3c4e-4f1a-9e8d-0a1b2c3d4e5f",
          uri: "https://estandares.example.org/ims/case/v1p1/CFItems/b7d2f6a0-3c4e-4f1a-9e8d-0a1b2c3d4e5f",
        },
        lastChangeDateTime: TIME,
      },
    ],
    CFDefinitions: {
      CFConcepts: [
        {
          identifier: id(CONCEPT_ID),
          uri: uri("CFConcepts", CONCEPT_ID),
          title: "Fractions",
          keywords: "fraction, part, whole",
          hierarchyCode: "1.2",
          description: "Numbers of the form a/b.",
          lastChangeDateTime: TIME,
          extensions: { source: "thesaurus" },
        },
      ],
      CFSubjects: [
        {
          identifier: id(SUBJECT_ID),
          uri: uri("CFSubjects", SUBJECT_ID),
          title: "Mathematics",
          hierarchyCode: "1",
          description: "The study of number.",
          lastChangeDateTime: TIME,
          extensions: { source: "thesaurus" },
        },
      ],
      CFLicenses: [
        {
          identifier: id(LICENSE_ID),
          uri: uri("CFLicenses", LICENSE_ID),
          title: "CC BY",
          description: "Creative Commons Attribution",
          licenseText: "https://creativecommons.org/licenses/by/4.0/",
          lastChangeDateTime: TIME,
          extensions: { spdx: "CC-BY-4.0" },
        },
      ],
      CFItemTypes: [
        {
          identifier: id(ITEM_TYPE_ID),
          uri: uri("CFItemTypes", ITEM_TYPE_ID),
          title: "Domain",
          description: "The highest level of a framework.",
          hierarchyCode: "1",
          typeCode: "DOM",
          lastChangeDateTime: TIME,
          extensions: { level: 1 },
        },
      ],
      CFAssociationGroupings: [
        {
          identifier: id(GROUPING_ID),
          uri: uri("CFAssociationGroupings", GROUPING_ID),
          title: "Structure",
          description: "The associations that give the tree.",
          lastChangeDateTime: TIME,
          extensions: { order: 1 },
        },
      ],
      extensions: { generator: "test" },
    },
    CFRubrics: [
      {
        identifier: id(RUBRIC_ID),
        uri: uri("CFRubrics", RUBRIC_ID),
        title: "Fractions rubric",
        description: "How to tell that fractions are understood.",
        lastChangeDateTime: TIME,
        CFRubricCriteria: [
          {
            identifier: id(CRITERION_ID),
            uri: uri("CFRubricCriteria", CRITERION_ID),
            category: "Reasoning",
            description: "Explains a comparison.",
            CFItemURI: link("CFItems", SIBLING_ID, "Compare"),
            weight: 0.5,
            position: 1,
            rubricId: id(RUBRIC_ID),
            lastChangeDateTime: TIME,
            CFRubricCriterionLevels: [
              {
                identifier: id(LEVEL_ID),
                uri: uri("CFRubricCriterionLevels", LEVEL_ID),
                description: "Gives a complete explanation.",
                quality: "Excellent",
                score: 4,
                feedback: "Well done.",
                position: 1,
                rubricCriterionId: id(CRITERION_ID),
                lastChangeDateTime: TIME,
                extensions: [{ band: "top" }, { band: "upper" }],
              },
            ],
            extensions: { scale: "four-point" },
          },
        ],
        extensions: { author: "committee" },
      },
    ],
    extensions: { exportedBy: "test" },
  };
}

/** One entity of each kind, taken from the full package, in the form that a provider serves it. */
export function fullEntities(): Readonly<Record<CaseEntityKind, CaseEntity>> {
  const pkg = fullPackage();
  const [parent, child] = pkg.CFItems ?? [];
  const definitions = pkg.CFDefinitions ?? {};
  if (parent === undefined || child === undefined) throw new Error("The full package has items.");
  const documentLink = link("CFDocuments", DOCUMENT_ID, "Mathematics");
  const document = { ...pkg.CFDocument, CFPackageURI: link("CFPackages", DOCUMENT_ID, "Mathematics") };
  const item = { ...parent, CFDocumentURI: documentLink };
  const [firstAssociation] = pkg.CFAssociations ?? [];
  const [concept] = definitions.CFConcepts ?? [];
  const [subject] = definitions.CFSubjects ?? [];
  const [license] = definitions.CFLicenses ?? [];
  const [itemType] = definitions.CFItemTypes ?? [];
  const [grouping] = definitions.CFAssociationGroupings ?? [];
  const [rubric] = pkg.CFRubrics ?? [];
  if (!firstAssociation || !concept || !subject || !license || !itemType || !grouping || !rubric) {
    throw new Error("The full package has an entity of each class.");
  }
  const documentSet: CFDocumentSet = { CFDocuments: [document] };
  const associationSet: CFAssociationSet = { CFItem: item, CFAssociations: pkg.CFAssociations?.slice(0, 3) ?? [] };
  const conceptSet: CFConceptSet = { CFConcepts: [concept] };
  const subjectSet: CFSubjectSet = { CFSubjects: [subject] };
  const itemTypeSet: CFItemTypeSet = { CFItemTypes: [itemType] };
  const status: ImsxStatusInfo = {
    imsx_codeMajor: "failure",
    imsx_severity: "error",
    imsx_description: "The fields cannot be read.",
    imsx_codeMinor: {
      imsx_codeMinorField: [{ imsx_codeMinorFieldName: "fields", imsx_codeMinorFieldValue: "invalid_selection_field" }],
    },
  };
  return {
    CFDocument: document,
    CFItem: item,
    CFAssociation: { ...firstAssociation, CFDocumentURI: documentLink },
    CFAssociationGrouping: grouping,
    CFConcept: concept,
    CFSubject: subject,
    CFLicense: license,
    CFItemType: itemType,
    CFRubric: rubric,
    CFDocumentSet: documentSet,
    CFAssociationSet: associationSet,
    CFConceptSet: conceptSet,
    CFSubjectSet: subjectSet,
    CFItemTypeSet: itemTypeSet,
    imsx_StatusInfo: status,
  };
}
