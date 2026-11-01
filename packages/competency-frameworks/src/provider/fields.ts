import type { CaseVersion } from "../model/index.js";
import { SCHEMAS } from "../read/internal.js";

/** The separator of the names in a path through nested objects (REST binding 3.3). */
const PATH_SEPARATOR = ".";

/** Reads the names of the properties that a CFDocument has in a version from the schemas that read it. */
function documentFields(version: CaseVersion): ReadonlySet<string> {
  const classes = [...SCHEMAS[version].classes];
  return new Set(classes.filter(([name]) => name === "CFDocument").flatMap(([, entries]) => Object.keys(entries)));
}

/** The properties of a CFDocument in each version, which is what a request for the list of documents may name. */
const DOCUMENT_FIELDS: Readonly<Record<CaseVersion, ReadonlySet<string>>> = {
  "1.0": documentFields("1.0"),
  "1.1": documentFields("1.1"),
};

/** Tells whether a name is a property of a CFDocument in a version. */
export function isDocumentField(version: CaseVersion, name: string): boolean {
  return DOCUMENT_FIELDS[version].has(name);
}

/**
 * Tells whether a path names data of a CFDocument: its first name is a property of the class and no name is empty. The names
 * after the first are not checked, because the binding types the properties of nested objects loosely.
 */
export function isDocumentPath(version: CaseVersion, path: string): boolean {
  const dot = path.indexOf(PATH_SEPARATOR);
  const first = dot === -1 ? path : path.slice(0, dot);
  return !path.split(PATH_SEPARATOR).includes("") && isDocumentField(version, first);
}

/** Returns a copy of an object with only the properties that the names pick, in the order of the object. */
export function selectFields(entity: object, names: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entity).filter(([name]) => names.includes(name)));
}
