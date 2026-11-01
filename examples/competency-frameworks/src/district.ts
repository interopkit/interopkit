import type {
  CasePackage,
  CFPckgAssociation,
  CFPckgItem,
  LinkGenURI,
  ServedKind,
} from "@interopkit/competency-frameworks";
import { identifierOf, uriOf } from "./identifiers.ts";
import { MATHEMATICS, MINISTRY_ORIGIN } from "./ministry.ts";

/** The address of the district's own copy of its framework: the school platform serves it to its users. */
const DISTRICT_ORIGIN = "https://case.riverside.example";

/** The numbers that the identifiers of the district's framework are made from. */
const PACING_GUIDE = { document: 100, fractions: 101, time: 102 } as const;

const CHANGED = "2024-08-15T08:00:00+00:00";
const TITLE = "Riverside District Pacing Guide, Mathematics Grade 3";

const district = (kind: ServedKind, number: number, title: string): LinkGenURI => ({
  title,
  identifier: identifierOf(number),
  uri: uriOf(DISTRICT_ORIGIN, kind, number),
  targetType: "CASE",
});
const ministry = (number: number, title: string): LinkGenURI => ({
  title,
  identifier: identifierOf(number),
  uri: uriOf(MINISTRY_ORIGIN, "CFItem", number),
  targetType: "CASE",
});

const unit = (number: number, code: string, fullStatement: string): CFPckgItem => ({
  identifier: identifierOf(number),
  uri: uriOf(DISTRICT_ORIGIN, "CFItem", number),
  fullStatement,
  humanCodingScheme: code,
  CFItemType: "Unit",
  lastChangeDateTime: CHANGED,
});

const association = (
  number: number,
  associationType: CFPckgAssociation["associationType"],
  origin: LinkGenURI,
  destination: LinkGenURI,
  extra: Partial<CFPckgAssociation> = {},
): CFPckgAssociation => ({
  identifier: identifierOf(number),
  uri: uriOf(DISTRICT_ORIGIN, "CFAssociation", number),
  associationType,
  originNodeURI: origin,
  destinationNodeURI: destination,
  lastChangeDateTime: CHANGED,
  ...extra,
});

/**
 * The pacing guide of a school district: two units in the order they are taught, aligned to the standards of the ministry.
 * The district owns the guide, and the alignments point at the ministry's items by the identifiers and addresses that the
 * ministry gave them.
 */
export function pacingGuide(): CasePackage {
  const fractions = district("CFItem", PACING_GUIDE.fractions, "U4");
  const time = district("CFItem", PACING_GUIDE.time, "U5");
  const guide = district("CFDocument", PACING_GUIDE.document, TITLE);
  return {
    CFDocument: {
      identifier: identifierOf(PACING_GUIDE.document),
      uri: uriOf(DISTRICT_ORIGIN, "CFDocument", PACING_GUIDE.document),
      creator: "Riverside District",
      title: TITLE,
      lastChangeDateTime: CHANGED,
      adoptionStatus: "Implemented",
      version: "2024-25",
    },
    CFItems: [
      unit(PACING_GUIDE.fractions, "U4", "Unit 4, weeks 19 to 24: fractions on a number line."),
      unit(PACING_GUIDE.time, "U5", "Unit 5, weeks 25 to 28: telling time."),
    ],
    CFAssociations: [
      association(110, "isChildOf", fractions, guide, { sequenceNumber: 1 }),
      association(111, "isChildOf", time, guide, { sequenceNumber: 2 }),
      association(112, "exactMatchOf", fractions, ministry(MATHEMATICS.numberLine, "NF.2")),
      association(113, "isRelatedTo", fractions, ministry(MATHEMATICS.unitFractions, "NF.1")),
      association(114, "exactMatchOf", time, ministry(MATHEMATICS.time, "MD.1")),
    ],
  };
}
