/**
 * The comparisons of a filter (REST binding 3.3): equal, not equal, greater than, greater than or equal, less than, less than
 * or equal, and contains.
 */
export const FILTER_PREDICATES = ["=", "!=", ">", ">=", "<", "<=", "~"] as const;

/** A comparison of a filter. */
export type FilterPredicate = (typeof FILTER_PREDICATES)[number];

/** The directions of a sort (REST binding 3.2): ascending and descending. */
export const SORT_ORDERS = ["asc", "desc"] as const;

/** The direction of a sort. */
export type SortOrder = (typeof SORT_ORDERS)[number];

/** One comparison of a filter: a field of the object, a predicate, and the text to compare it with. */
export interface CaseCondition {
  /** The name of a field, or a path through nested objects with a dot between the names, such as `licenseURI.title`. */
  readonly field: string;
  /** How the field is compared with the value. */
  readonly predicate: FilterPredicate;
  /** The text to compare with. It is compared without regard to case. */
  readonly value: string;
}

/** A filter: one condition, or two conditions joined by `AND` or by `OR`. The binding recommends at most one operator. */
export type CaseFilter =
  | CaseCondition
  | {
      /** Both conditions must hold. */
      readonly and: readonly [CaseCondition, CaseCondition];
    }
  | {
      /** One of the conditions must hold. */
      readonly or: readonly [CaseCondition, CaseCondition];
    };

/** The parameters of a request for the list of documents that sort, filter and select (REST binding 3.2 to 3.4). */
export interface CaseQuery {
  /**
   * The field to sort by.
   *
   * @defaultValue none: the provider's order
   */
  readonly sort?: string;
  /**
   * The direction of the sort.
   *
   * @defaultValue none
   */
  readonly orderBy?: SortOrder;
  /**
   * The documents to keep.
   *
   * @defaultValue none: every document
   */
  readonly filter?: CaseFilter;
  /**
   * The fields to return and no others.
   *
   * @defaultValue none: every field
   */
  readonly fields?: readonly string[];
}
