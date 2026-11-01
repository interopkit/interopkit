import type {
  CasePackage,
  CFDefinition,
  CFPckgAssociation,
  CFPckgDocument,
  CFPckgItem,
  CFRubric,
  LinkGenURI,
  LinkURI,
  ServedKind,
} from "@interopkit/competency-frameworks";
import { identifierOf, linkTo, partUriOf, uriOf } from "./identifiers.ts";

/** The address of the ministry's CASE provider, before the path of the version. */
export const MINISTRY_ORIGIN = "https://case.ministry.example";

/** The numbers that the identifiers of the framework are made from. */
export const MATHEMATICS = {
  document: 1,
  fractions: 2,
  unitFractions: 3,
  numberLine: 4,
  equivalence: 5,
  measurement: 6,
  time: 7,
  /** The standard that the second edition adds. */
  generate: 8,
  /** The standard that replaces the one on telling time in the second edition. */
  timeProblems: 9,
  concept: 40,
  conceptChild: 41,
  subject: 42,
  subjectChild: 43,
  license: 44,
  domainType: 45,
  standardType: 46,
  structure: 47,
  progression: 48,
  rubric: 50,
  criterion: 51,
  excellent: 52,
  developing: 53,
} as const;

const FIRST_EDITION = "2024-06-13T18:46:03+00:00";
const SECOND_EDITION = "2025-03-02T09:15:00+00:00";
const TITLE = "Mathematics, Grade 3";

const link = (kind: ServedKind, number: number, title: string): LinkURI => linkTo(MINISTRY_ORIGIN, kind, number, title);
const node = (kind: ServedKind, number: number, title: string): LinkGenURI => ({
  ...link(kind, number, title),
  targetType: "CASE",
});

/** An item of the second level: a standard of grade 3 under a domain. */
function standard(number: number, code: string, fullStatement: string, extra: Partial<CFPckgItem> = {}): CFPckgItem {
  return {
    identifier: identifierOf(number),
    uri: uriOf(MINISTRY_ORIGIN, "CFItem", number),
    fullStatement,
    humanCodingScheme: code,
    CFItemType: "Standard",
    CFItemTypeURI: link("CFItemType", MATHEMATICS.standardType, "Standard"),
    educationLevel: ["03"],
    lastChangeDateTime: FIRST_EDITION,
    ...extra,
  };
}

/** The items of the first edition. The first domain has every property that an item may have. */
function firstItems(): readonly CFPckgItem[] {
  return [
    {
      identifier: identifierOf(MATHEMATICS.fractions),
      uri: uriOf(MINISTRY_ORIGIN, "CFItem", MATHEMATICS.fractions),
      fullStatement: "Develop understanding of **fractions** as numbers.",
      alternativeLabel: "Fractions",
      CFItemType: "Domain",
      CFItemTypeURI: link("CFItemType", MATHEMATICS.domainType, "Domain"),
      humanCodingScheme: "NF",
      listEnumeration: "1",
      abbreviatedStatement: "Fractions as numbers",
      conceptKeywords: ["fraction", "number line", "equal parts"],
      conceptKeywordsURI: link("CFConcept", MATHEMATICS.concept, "Fractions"),
      notes: "Grade 3 expectations are limited to fractions with denominators 2, 3, 4, 6 and 8.",
      subject: ["Mathematics"],
      subjectURI: [link("CFSubject", MATHEMATICS.subject, "Mathematics")],
      language: "eng",
      educationLevel: ["03"],
      licenseURI: link("CFLicense", MATHEMATICS.license, "CC BY 4.0"),
      statusStartDate: "2024-08-01",
      statusEndDate: "2030-07-31",
      lastChangeDateTime: FIRST_EDITION,
      extensions: { sourceCode: "G3.NF", weight: { instruction: 0.4, assessment: 0.35 } },
    },
    standard(
      MATHEMATICS.unitFractions,
      "NF.1",
      "Understand a fraction $1/b$ as the quantity formed by 1 part when a whole is partitioned into $b$ equal parts.",
    ),
    standard(MATHEMATICS.numberLine, "NF.2", "Represent a fraction $a/b$ on a number line diagram."),
    standard(
      MATHEMATICS.equivalence,
      "NF.3",
      "Explain equivalence of fractions in special cases, and compare fractions by reasoning about their size.",
    ),
    {
      identifier: identifierOf(MATHEMATICS.measurement),
      uri: uriOf(MINISTRY_ORIGIN, "CFItem", MATHEMATICS.measurement),
      fullStatement: "Solve problems involving measurement and estimation.",
      CFItemType: "Domain",
      humanCodingScheme: "MD",
      lastChangeDateTime: FIRST_EDITION,
    },
    standard(MATHEMATICS.time, "MD.1", "Tell and write time to the nearest minute."),
  ];
}

/** An association from a node to another, in the framework. */
function association(
  number: number,
  associationType: CFPckgAssociation["associationType"],
  origin: LinkGenURI,
  destination: LinkGenURI,
  extra: Partial<CFPckgAssociation> = {},
  lastChangeDateTime = FIRST_EDITION,
): CFPckgAssociation {
  return {
    identifier: identifierOf(number),
    uri: uriOf(MINISTRY_ORIGIN, "CFAssociation", number),
    associationType,
    originNodeURI: origin,
    destinationNodeURI: destination,
    lastChangeDateTime,
    ...extra,
  };
}

/** The `isChildOf` association of the tree: the item under its parent, in the order of teaching. */
function childOf(
  number: number,
  child: readonly [number, string],
  parent: readonly [ServedKind, number, string],
  sequenceNumber: number,
  lastChangeDateTime = FIRST_EDITION,
): CFPckgAssociation {
  return association(
    number,
    "isChildOf",
    node("CFItem", ...child),
    node(parent[0], parent[1], parent[2]),
    { sequenceNumber, CFAssociationGroupingURI: link("CFAssociationGrouping", MATHEMATICS.structure, "Structure") },
    lastChangeDateTime,
  );
}

/** The associations of the first edition: the tree, the order of teaching, and links to other frameworks and media. */
function firstAssociations(): readonly CFPckgAssociation[] {
  const unit: readonly [number, string] = [MATHEMATICS.unitFractions, "NF.1"];
  const line: readonly [number, string] = [MATHEMATICS.numberLine, "NF.2"];
  const equivalence: readonly [number, string] = [MATHEMATICS.equivalence, "NF.3"];
  const fractions: readonly [ServedKind, number, string] = ["CFItem", MATHEMATICS.fractions, "NF"];
  const progression = link("CFAssociationGrouping", MATHEMATICS.progression, "Progression");
  return [
    childOf(20, [MATHEMATICS.fractions, "NF"], ["CFDocument", MATHEMATICS.document, TITLE], 1),
    childOf(21, [MATHEMATICS.measurement, "MD"], ["CFDocument", MATHEMATICS.document, TITLE], 2),
    childOf(22, unit, fractions, 1),
    childOf(23, line, fractions, 2),
    childOf(24, equivalence, fractions, 3),
    childOf(25, [MATHEMATICS.time, "MD.1"], ["CFItem", MATHEMATICS.measurement, "MD"], 1),
    association(26, "precedes", node("CFItem", ...unit), node("CFItem", ...line), {
      CFAssociationGroupingURI: progression,
    }),
    association(27, "precedes", node("CFItem", ...line), node("CFItem", ...equivalence), {
      CFAssociationGroupingURI: progression,
      notes: "Equivalence is shown on the number line first.",
    }),
    association(28, "isRelatedTo", node("CFItem", ...line), node("CFItem", MATHEMATICS.time, "MD.1"), {
      notes: "A clock face is a number line that closes on itself.",
      extensions: { strength: "weak" },
    }),
    association(
      29,
      "exemplar",
      node("CFItem", ...unit),
      {
        title: "Halves, thirds and fourths",
        identifier: "lesson-video-7",
        uri: "https://video.example.org/lessons/7",
        targetType: "ext:video",
      },
      {},
    ),
    association(30, "isTranslationOf", node("CFItem", MATHEMATICS.fractions, "NF"), {
      // cspell:disable-next-line -- the title of the framework in Spanish
      title: "Fracciones como números",
      identifier: "c4f1a2d0-6b3e-4d58-9a7c-2e1f0b8d4a63",
      uri: "https://estandares.ministry.example/ims/case/v1p1/CFItems/c4f1a2d0-6b3e-4d58-9a7c-2e1f0b8d4a63",
      targetType: "CASE",
    }),
  ];
}

/** The definitions that the items and associations link to, with every property of each class. */
function definitions(): CFDefinition {
  const description = (text: string) => ({ description: text, lastChangeDateTime: FIRST_EDITION });
  return {
    CFConcepts: [
      {
        identifier: identifierOf(MATHEMATICS.concept),
        uri: uriOf(MINISTRY_ORIGIN, "CFConcept", MATHEMATICS.concept),
        title: "Fractions",
        keywords: "fraction, part, whole",
        hierarchyCode: "1.2",
        ...description("Numbers of the form a/b."),
        extensions: { thesaurus: "ministry" },
      },
      {
        identifier: identifierOf(MATHEMATICS.conceptChild),
        uri: uriOf(MINISTRY_ORIGIN, "CFConcept", MATHEMATICS.conceptChild),
        title: "Unit fractions",
        keywords: "unit fraction",
        hierarchyCode: "1.2.1",
        ...description("Fractions with a numerator of 1."),
      },
    ],
    CFSubjects: [
      {
        identifier: identifierOf(MATHEMATICS.subject),
        uri: uriOf(MINISTRY_ORIGIN, "CFSubject", MATHEMATICS.subject),
        title: "Mathematics",
        hierarchyCode: "1",
        ...description("The study of number, shape and change."),
        extensions: { subjectCode: "MAT" },
      },
      {
        identifier: identifierOf(MATHEMATICS.subjectChild),
        uri: uriOf(MINISTRY_ORIGIN, "CFSubject", MATHEMATICS.subjectChild),
        title: "Arithmetic",
        hierarchyCode: "1.1",
        ...description("Computation with whole numbers and fractions."),
      },
    ],
    CFLicenses: [
      {
        identifier: identifierOf(MATHEMATICS.license),
        uri: uriOf(MINISTRY_ORIGIN, "CFLicense", MATHEMATICS.license),
        title: "CC BY 4.0",
        ...description("Creative Commons Attribution 4.0 International"),
        licenseText: "https://creativecommons.org/licenses/by/4.0/legalcode",
        extensions: { spdx: "CC-BY-4.0" },
      },
    ],
    CFItemTypes: [
      {
        identifier: identifierOf(MATHEMATICS.domainType),
        uri: uriOf(MINISTRY_ORIGIN, "CFItemType", MATHEMATICS.domainType),
        title: "Domain",
        hierarchyCode: "1",
        typeCode: "DOM",
        ...description("A group of standards on one topic."),
        extensions: { level: 1 },
      },
      {
        identifier: identifierOf(MATHEMATICS.standardType),
        uri: uriOf(MINISTRY_ORIGIN, "CFItemType", MATHEMATICS.standardType),
        title: "Standard",
        hierarchyCode: "1.1",
        typeCode: "STD",
        ...description("What a student is expected to know or do."),
      },
    ],
    CFAssociationGroupings: [
      {
        identifier: identifierOf(MATHEMATICS.structure),
        uri: uriOf(MINISTRY_ORIGIN, "CFAssociationGrouping", MATHEMATICS.structure),
        title: "Structure",
        ...description("The associations that make the tree of the framework."),
        extensions: { order: 1 },
      },
      {
        identifier: identifierOf(MATHEMATICS.progression),
        uri: uriOf(MINISTRY_ORIGIN, "CFAssociationGrouping", MATHEMATICS.progression),
        title: "Progression",
        ...description("The order in which standards are taught."),
      },
    ],
    extensions: { generator: "ministry-editor 4.2" },
  };
}

/** The rubric that says how well a student meets the standard on equivalence. */
function rubrics(): readonly CFRubric[] {
  const level = (number: number, position: number, quality: string, score: number, text: string) => ({
    identifier: identifierOf(number),
    uri: partUriOf(MINISTRY_ORIGIN, "CFRubricCriterionLevels", identifierOf(number)),
    description: text,
    quality,
    score,
    feedback: `${quality}: ${text}`,
    position,
    rubricCriterionId: identifierOf(MATHEMATICS.criterion),
    lastChangeDateTime: FIRST_EDITION,
    extensions: [{ band: quality.toLowerCase() }],
  });
  return [
    {
      identifier: identifierOf(MATHEMATICS.rubric),
      uri: uriOf(MINISTRY_ORIGIN, "CFRubric", MATHEMATICS.rubric),
      title: "Comparing fractions",
      description: "How well a student reasons about the size of fractions.",
      lastChangeDateTime: FIRST_EDITION,
      CFRubricCriteria: [
        {
          identifier: identifierOf(MATHEMATICS.criterion),
          uri: partUriOf(MINISTRY_ORIGIN, "CFRubricCriteria", identifierOf(MATHEMATICS.criterion)),
          category: "Reasoning",
          description: "Explains why one fraction is larger than another.",
          CFItemURI: link("CFItem", MATHEMATICS.equivalence, "NF.3"),
          weight: 0.5,
          position: 1,
          rubricId: identifierOf(MATHEMATICS.rubric),
          lastChangeDateTime: FIRST_EDITION,
          CFRubricCriterionLevels: [
            level(MATHEMATICS.excellent, 1, "Excellent", 4, "Gives a complete explanation with a model."),
            level(MATHEMATICS.developing, 2, "Developing", 2, "Compares correctly without a reason."),
          ],
          extensions: { scale: "four-point" },
        },
      ],
      extensions: { author: "curriculum committee" },
    },
  ];
}

/** The document of an edition. */
function document(edition: "2024" | "2025", lastChangeDateTime: string): CFPckgDocument {
  return {
    identifier: identifierOf(MATHEMATICS.document),
    uri: uriOf(MINISTRY_ORIGIN, "CFDocument", MATHEMATICS.document),
    frameworkType: "Standards",
    caseVersion: "1.1",
    creator: "Ministry of Education",
    title: TITLE,
    lastChangeDateTime,
    officialSourceURL: "https://ministry.example/standards/mathematics-3.pdf",
    publisher: "Standards Office",
    description: "What a student in *grade 3* is expected to know and do in mathematics.",
    subject: ["Mathematics"],
    subjectURI: [link("CFSubject", MATHEMATICS.subject, "Mathematics")],
    language: "eng",
    version: edition,
    adoptionStatus: "Implemented",
    statusStartDate: "2024-08-01",
    statusEndDate: "2030-07-31",
    licenseURI: link("CFLicense", MATHEMATICS.license, "CC BY 4.0"),
    notes: edition === "2024" ? "Replaces the 2018 standards." : "Adds equivalent fractions and word problems on time.",
    extensions: { sourceDocument: `math-3-${edition}` },
  };
}

/** The first edition of the ministry's framework. Every class of CASE appears in it, with every property of each. */
export function mathematics2024(): CasePackage {
  return {
    CFDocument: document("2024", FIRST_EDITION),
    CFItems: firstItems(),
    CFAssociations: firstAssociations(),
    CFDefinitions: definitions(),
    CFRubrics: rubrics(),
    extensions: { exportedBy: "ministry-editor 4.2" },
  };
}

/**
 * The second edition: one standard reworded, one retired and replaced, and one added. The identifiers of the items that
 * remain are the same, which is how a consumer matches the editions.
 */
export function mathematics2025(): CasePackage {
  const first = mathematics2024();
  const retired = (item: CFPckgItem): CFPckgItem =>
    item.identifier === identifierOf(MATHEMATICS.time)
      ? { ...item, statusEndDate: "2025-07-31", lastChangeDateTime: SECOND_EDITION }
      : item;
  const reworded = (item: CFPckgItem): CFPckgItem =>
    item.identifier === identifierOf(MATHEMATICS.equivalence)
      ? {
          ...item,
          fullStatement: "Explain equivalence of fractions, and compare fractions by reasoning about their size.",
          lastChangeDateTime: SECOND_EDITION,
        }
      : item;
  return {
    ...first,
    CFDocument: document("2025", SECOND_EDITION),
    CFItems: [
      ...(first.CFItems ?? []).map(retired).map(reworded),
      standard(MATHEMATICS.generate, "NF.4", "Generate simple equivalent fractions, such as $1/2 = 2/4$.", {
        lastChangeDateTime: SECOND_EDITION,
      }),
      standard(MATHEMATICS.timeProblems, "MD.2", "Solve word problems about time intervals in minutes.", {
        lastChangeDateTime: SECOND_EDITION,
      }),
    ],
    CFAssociations: [
      ...(first.CFAssociations ?? []),
      childOf(31, [MATHEMATICS.generate, "NF.4"], ["CFItem", MATHEMATICS.fractions, "NF"], 4, SECOND_EDITION),
      childOf(32, [MATHEMATICS.timeProblems, "MD.2"], ["CFItem", MATHEMATICS.measurement, "MD"], 2, SECOND_EDITION),
      association(
        33,
        "replacedBy",
        node("CFItem", MATHEMATICS.time, "MD.1"),
        node("CFItem", MATHEMATICS.timeProblems, "MD.2"),
        {},
        SECOND_EDITION,
      ),
    ],
  };
}

/** The numbers that the identifiers of the reading framework are made from. */
export const READING = { document: 200, strand: 201, fluency: 202, comprehension: 203 } as const;

/** A second framework of the ministry, small and plain: a document, one strand and two standards. */
export function reading2024(): CasePackage {
  const at = "2024-02-20T10:00:00+00:00";
  const item = (number: number, code: string, fullStatement: string): CFPckgItem => ({
    identifier: identifierOf(number),
    uri: uriOf(MINISTRY_ORIGIN, "CFItem", number),
    fullStatement,
    humanCodingScheme: code,
    lastChangeDateTime: at,
  });
  const childOfStrand = (number: number, child: number, code: string, sequenceNumber: number) =>
    association(
      number,
      "isChildOf",
      node("CFItem", child, code),
      node("CFItem", READING.strand, "RF"),
      { sequenceNumber },
      at,
    );
  return {
    CFDocument: {
      identifier: identifierOf(READING.document),
      uri: uriOf(MINISTRY_ORIGIN, "CFDocument", READING.document),
      creator: "Ministry of Education",
      title: "English Language Arts, Grade 3",
      lastChangeDateTime: at,
      adoptionStatus: "Implemented",
      language: "eng",
    },
    CFItems: [
      item(READING.strand, "RF", "Read with sufficient accuracy and fluency to support comprehension."),
      item(READING.fluency, "RF.1", "Read grade-level text orally with accuracy, appropriate rate and expression."),
      item(READING.comprehension, "RF.2", "Use context to confirm or self-correct word recognition and understanding."),
    ],
    CFAssociations: [
      association(
        210,
        "isChildOf",
        node("CFItem", READING.strand, "RF"),
        node("CFDocument", READING.document, "English Language Arts, Grade 3"),
        { sequenceNumber: 1 },
        at,
      ),
      childOfStrand(211, READING.fluency, "RF.1", 1),
      childOfStrand(212, READING.comprehension, "RF.2", 2),
    ],
  };
}
