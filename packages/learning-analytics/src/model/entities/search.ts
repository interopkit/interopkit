import type { Entity, Ref } from "./entity.js";
import type { CaliperEntity } from "./entity-map.js";
import type { Person, SoftwareApplication } from "./people.js";

/** The search criteria that an actor aims at a searchable resource (Caliper 1.2 B.47). */
export interface Query extends Entity<"Query"> {
  /** The person who devised the query. */
  readonly creator?: Ref<Person>;
  /** The entity that the query is aimed at, typically a digital resource or an application. */
  readonly searchTarget?: Ref<CaliperEntity>;
  /** The terms that the creator searched for. */
  readonly searchTerms?: string;
}

/** The answer of a search engine to a query (Caliper 1.2 B.58). */
export interface SearchResponse extends Entity<"SearchResponse"> {
  /** The application that provided the response. */
  readonly searchProvider?: Ref<SoftwareApplication>;
  /** The entity that was searched. */
  readonly searchTarget?: Ref<CaliperEntity>;
  /** The query that was submitted. */
  readonly query?: Ref<Query>;
  /** How many results the response holds, 0 when the query found none. */
  readonly searchResultsItemCount?: number;
}
