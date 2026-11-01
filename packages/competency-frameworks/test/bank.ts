import type { CasePackage, CFPckgAssociation, CFPckgItem } from "../src/index.js";
import { id, uri } from "./full-package.js";

/** The number of children of a node in the generated framework. */
const BRANCHING = 10;
const TIME = "2024-06-13T18:46:03+00:00";
/** The number of the document, which the items and associations are numbered after. */
const DOCUMENT = 1;

/**
 * Builds a framework of CASE 1.1 with the given number of items, which a reader of the package sees as a real one: a tree with
 * ten children to a node, a document, an `isChildOf` association for each item and an `exactMatchOf` to another framework for
 * one in fifty. It is built from the number alone, so the same call gives the same framework.
 */
export function framework(itemCount: number): CasePackage {
  const itemNumber = (index: number): number => 1000 + index;
  const associationNumber = (index: number): number => 100_000 + index;
  const items: CFPckgItem[] = Array.from({ length: itemCount }, (_, index) => ({
    identifier: id(itemNumber(index)),
    uri: uri("CFItems", itemNumber(index)),
    fullStatement: `Explain how the quantity in standard ${index} changes when the whole is partitioned again.`,
    humanCodingScheme: `S.${index}`,
    CFItemType: index < BRANCHING ? "Domain" : "Standard",
    language: "eng",
    educationLevel: ["03"],
    conceptKeywords: ["quantity", "whole"],
    lastChangeDateTime: TIME,
  }));
  const childOf = (index: number): CFPckgAssociation => {
    const parent = index < BRANCHING ? undefined : Math.floor(index / BRANCHING) - 1;
    const destination =
      parent === undefined
        ? { title: "Document", identifier: id(DOCUMENT), uri: uri("CFDocuments", DOCUMENT) }
        : { title: `S.${parent}`, identifier: id(itemNumber(parent)), uri: uri("CFItems", itemNumber(parent)) };
    return {
      identifier: id(associationNumber(index)),
      uri: uri("CFAssociations", associationNumber(index)),
      associationType: "isChildOf",
      sequenceNumber: (index % BRANCHING) + 1,
      originNodeURI: { title: `S.${index}`, identifier: id(itemNumber(index)), uri: uri("CFItems", itemNumber(index)) },
      destinationNodeURI: destination,
      lastChangeDateTime: TIME,
    };
  };
  const matchEvery = 50;
  const matches: CFPckgAssociation[] = items.flatMap((_, index) =>
    index % matchEvery === 0
      ? [
          {
            identifier: id(associationNumber(itemCount + index)),
            uri: uri("CFAssociations", associationNumber(itemCount + index)),
            associationType: "exactMatchOf" as const,
            originNodeURI: {
              title: `S.${index}`,
              identifier: id(itemNumber(index)),
              uri: uri("CFItems", itemNumber(index)),
            },
            destinationNodeURI: {
              title: "Other",
              identifier: id(500_000 + index),
              uri: `https://standards.example.org/ims/case/v1p1/CFItems/${id(500_000 + index)}`,
              targetType: "CASE" as const,
            },
            lastChangeDateTime: TIME,
          },
        ]
      : [],
  );
  return {
    CFDocument: {
      identifier: id(DOCUMENT),
      uri: uri("CFDocuments", DOCUMENT),
      creator: "Ministry of Education",
      title: "A framework of many items",
      lastChangeDateTime: TIME,
    },
    CFItems: items,
    CFAssociations: [...items.map((_, index) => childOf(index)), ...matches],
  };
}
