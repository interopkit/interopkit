import type { CallOptions } from "@interopkit/core";
import type { CaseEntity, CasePackage, CaseVersion } from "../model/index.js";
import { SERVICE_PATHS } from "../model/internal.js";
import { DISCOVERY_FILE } from "./discovery.js";
import type { ProviderSettings } from "./options.js";
import type { FrameworkStore } from "./store.js";

/** What a store answers for an identifier: an object of CASE, or `undefined` when it holds none. */
type Lookup = (store: FrameworkStore, id: string, call: CallOptions) => Promise<CaseEntity | CasePackage | undefined>;

/** The request a path names. */
export type Route =
  | { readonly kind: "documents"; readonly version: CaseVersion }
  | { readonly kind: "entity"; readonly version: CaseVersion; readonly id: string; readonly lookup: Lookup }
  | { readonly kind: "discovery" };

const DOCUMENTS = "CFDocuments";
const DISCOVERY = "discovery";

/** The endpoints that answer for one identifier (REST binding 2.1), each with the method of the store that serves it. */
const LOOKUPS: ReadonlyMap<string, Lookup> = new Map<string, Lookup>([
  [DOCUMENTS, (store, id, call) => store.document(id, call)],
  ["CFPackages", (store, id, call) => store.package(id, call)],
  ["CFItems", (store, id, call) => store.item(id, call)],
  ["CFItemAssociations", (store, id, call) => store.itemAssociations(id, call)],
  ["CFAssociations", (store, id, call) => store.association(id, call)],
  ["CFAssociationGroupings", (store, id, call) => store.associationGrouping(id, call)],
  ["CFConcepts", (store, id, call) => store.concept(id, call)],
  ["CFSubjects", (store, id, call) => store.subject(id, call)],
  ["CFLicenses", (store, id, call) => store.license(id, call)],
  ["CFItemTypes", (store, id, call) => store.itemType(id, call)],
  ["CFRubrics", (store, id, call) => store.rubric(id, call)],
]);

/** Finds the request that a path names in a version, or `undefined` when it names none. */
function routeIn(version: CaseVersion, rest: string): Route | undefined {
  const [segment = "", id, ...more] = rest.split("/");
  if (more.length > 0) return undefined;
  if (segment === DOCUMENTS && id === undefined) return { kind: "documents", version };
  const lookup = LOOKUPS.get(segment);
  if (lookup !== undefined && id !== undefined) return { kind: "entity", version, id, lookup };
  return segment === DISCOVERY && id === DISCOVERY_FILE && version === "1.1" ? { kind: "discovery" } : undefined;
}

/**
 * Finds the request that the path of a URL names, under the base path and in one of the versions the provider serves.
 *
 * @param pathname - The path of the request URL, as `URL` writes it.
 * @returns The route, or `undefined` for a path that is not an endpoint of a version the provider serves.
 */
export function routeOf(pathname: string, { basePath, versions }: ProviderSettings): Route | undefined {
  if (!pathname.startsWith(basePath)) return undefined;
  const below = pathname.slice(basePath.length);
  for (const version of versions) {
    const root = `${SERVICE_PATHS[version]}/`;
    if (below.startsWith(root)) return routeIn(version, below.slice(root.length));
  }
  return undefined;
}
