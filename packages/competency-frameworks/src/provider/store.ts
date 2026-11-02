import type { CallOptions } from "@interopkit/core";
import { guardSchema, isRecord, methodsSchema, nonNegativeIntegerSchema, strictRecord } from "@interopkit/core/checks";
import type { OffsetPage } from "@interopkit/core/http";
import * as v from "valibot";
import type {
  CaseEntity,
  CasePackage,
  CFAssociation,
  CFAssociationGrouping,
  CFAssociationSet,
  CFConceptSet,
  CFDocument,
  CFItem,
  CFItemTypeSet,
  CFLicense,
  CFRubric,
  CFSubjectSet,
} from "../model/index.js";
import type { ParsedCaseQuery } from "./parse-query.js";

/** A page of the list of documents, and the number of documents that match the query, whatever the page. */
export interface DocumentPage {
  /** The documents of the page, at most the limit. */
  readonly documents: readonly CFDocument[];
  /** The number of documents that match the query. */
  readonly total: number;
}

/**
 * Where a provider keeps its frameworks. The provider asks it for one object by identifier, and for a page of documents.
 *
 * @remarks
 * Every method is read-only and may be called again. A method answers `undefined` for an identifier it does not hold, and
 * rejects when it fails; the provider answers 500 and passes nothing of the failure on. Every method receives the `signal` of
 * the provider, and ends its work when it aborts. An identifier is a UUID as the consumer wrote it, in either case, so a store
 * compares it without regard to case, as the readers of the package compare identifiers.
 */
export interface FrameworkStore {
  /**
   * Returns a page of the documents that match the query, and the number of documents that match, whatever the page.
   *
   * @remarks
   * The store applies `query.filter` and `query.sort` before it takes the page, in the collation `query.collation` names.
   * `queryEntities` does it for a store that holds the documents in memory. `query.fields` is for stores that read less when
   * they can: the provider selects the fields of the page itself.
   */
  documents(query: ParsedCaseQuery, page: OffsetPage, options?: CallOptions): Promise<DocumentPage>;
  /** Returns the document with the identifier, or `undefined`. */
  document(id: string, options?: CallOptions): Promise<CFDocument | undefined>;
  /** Returns the package of the document with the identifier, or `undefined`. */
  package(id: string, options?: CallOptions): Promise<CasePackage | undefined>;
  /** Returns the item with the identifier, or `undefined`. */
  item(id: string, options?: CallOptions): Promise<CFItem | undefined>;
  /** Returns the item with the identifier and its associations, or `undefined`. */
  itemAssociations(id: string, options?: CallOptions): Promise<CFAssociationSet | undefined>;
  /** Returns the association with the identifier, or `undefined`. */
  association(id: string, options?: CallOptions): Promise<CFAssociation | undefined>;
  /** Returns the association grouping with the identifier, or `undefined`. */
  associationGrouping(id: string, options?: CallOptions): Promise<CFAssociationGrouping | undefined>;
  /** Returns the concept with the identifier and its child concepts, or `undefined`. */
  concept(id: string, options?: CallOptions): Promise<CFConceptSet | undefined>;
  /** Returns the subject with the identifier and its child subjects, or `undefined`. */
  subject(id: string, options?: CallOptions): Promise<CFSubjectSet | undefined>;
  /** Returns the license with the identifier, or `undefined`. */
  license(id: string, options?: CallOptions): Promise<CFLicense | undefined>;
  /** Returns the item type with the identifier and its child item types, or `undefined`. */
  itemType(id: string, options?: CallOptions): Promise<CFItemTypeSet | undefined>;
  /** Returns the rubric with the identifier, or `undefined`. */
  rubric(id: string, options?: CallOptions): Promise<CFRubric | undefined>;
}

/** The names of the methods of a store. */
const STORE_METHODS = [
  "documents",
  "document",
  "package",
  "item",
  "itemAssociations",
  "association",
  "associationGrouping",
  "concept",
  "subject",
  "license",
  "itemType",
  "rubric",
] as const satisfies readonly (keyof FrameworkStore)[];

/** The schema of a store: an object with every method, which passes on whole so that a class instance keeps its methods. */
export const storeSchema = methodsSchema<FrameworkStore>(...STORE_METHODS);

// The shape is what a port promises and a store is trusted with the rest, so these guards check that a value is an object and
// say what the model would call it.
const objectOf = <TObject extends object>() => guardSchema((value): value is TObject => isRecord(value), "an object");

/** What a method that looks up one object answers: the object, or `undefined` for an identifier it does not hold. */
export const lookupSchema = v.optional(objectOf<CaseEntity | CasePackage>());

/** What `documents` answers: the documents of the page, and how many match. */
export const pageSchema = strictRecord({ documents: v.array(objectOf<CFDocument>()), total: nonNegativeIntegerSchema });
