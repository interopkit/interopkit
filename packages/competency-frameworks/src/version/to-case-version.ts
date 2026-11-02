import { DataError } from "@interopkit/core";
import {
  checkArray,
  checkRecord,
  copyJson,
  isAbsoluteUri,
  isRecord,
  MAX_JSON_DEPTH,
  parseWith,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type { CaseEntity, CaseIssue, CasePackage, CFAssociation, CFAssociationSet } from "../model/index.js";
import { ASSOCIATION_TYPES_1_0, INFORMATION_MODEL_UUID } from "../model/internal.js";

/** A value in the form of CASE 1.0, and what the conversion left out of it. */
export interface VersionedValue<TValue> {
  /** The value in the form of 1.0. It shares nothing with the input. */
  readonly value: TValue;
  /** What 1.0 cannot hold and the conversion left out, and what 1.0 would refuse, as warnings. An empty list means that nothing was lost. */
  readonly dropped: readonly CaseIssue[];
}

/**
 * The type of what `toCaseVersion` returns for an entity: an association, and a set of the associations of an item, may
 * have no form in 1.0.
 */
export type Converted<TValue> = TValue extends CFAssociation | CFAssociationSet ? TValue | undefined : TValue;

/** An object whose properties are read as data. */
type Dictionary = Readonly<Record<string, unknown>>;

/** The properties whose value is an object of the model. */
const OBJECT_MEMBERS: ReadonlySet<string> = new Set(["CFDocument", "CFItem", "CFDefinitions"]);

/** The properties whose value is a list of objects of the model. */
const LIST_MEMBERS: ReadonlySet<string> = new Set([
  "CFItems",
  "CFDocuments",
  "CFConcepts",
  "CFSubjects",
  "CFLicenses",
  "CFItemTypes",
  "CFAssociationGroupings",
  "CFRubrics",
  "CFRubricCriteria",
  "CFRubricCriterionLevels",
]);

/** The properties that point to the node at either end of an association. */
const NODE_MEMBERS: ReadonlySet<string> = new Set(["originNodeURI", "destinationNodeURI"]);

/** The properties whose value is a link, or a list of links, to an object of CASE: a title, an identifier and a URI. */
const LINK_MEMBERS: ReadonlySet<string> = new Set([
  "CFPackageURI",
  "CFDocumentURI",
  "licenseURI",
  "CFItemTypeURI",
  "conceptKeywordsURI",
  "CFAssociationGroupingURI",
  "CFItemURI",
  "subjectURI",
]);

/** The properties whose value is an identifier of the form of a UUID, which 1.0 holds to the form of the Information Model. */
const IDENTIFIER_MEMBERS: ReadonlySet<string> = new Set(["identifier", "rubricId", "rubricCriterionId"]);

/** The properties whose value is a URI, which 1.0 holds to a URI with a scheme. */
const URI_MEMBERS: ReadonlySet<string> = new Set(["uri", "officialSourceURL"]);

const versionSchema = v.literal("1.0");

function warning(path: string, rule: string, message: string): CaseIssue {
  return { path, rule, message, severity: "warning" };
}

/** Joins a path and a property name. */
function member(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

/** Throws when an object of the model nests deeper than any package or entity of CASE does. */
function checkDepth(depth: number, path: string): void {
  if (depth > MAX_JSON_DEPTH) {
    throw new DataError(`${path} nests more than ${MAX_JSON_DEPTH} levels, the most that a package or an entity has.`);
  }
}

/** Tells whether an object has a property that only CASE 1.1 gives its class, which the other properties of it show. */
function isOnlyIn11(entity: Dictionary, name: string): boolean {
  if (name === "extensions" || name === "frameworkType" || name === "caseVersion") return true;
  if ("fullStatement" in entity) return name === "subject" || name === "subjectURI";
  return "associationType" in entity && name === "notes";
}

/** Copies a value that the model holds as it is, and says where it is not JSON. */
function copyValue(value: unknown, path: string): unknown {
  const copy = copyJson(value, path);
  if ("problem" in copy) throw new DataError(`${copy.problem}.`);
  return copy.value;
}

/** Reports an identifier or a URI that 1.0 would refuse, and leaves it as it is. */
function reportForms(name: string, value: unknown, path: string, dropped: CaseIssue[]): void {
  if (typeof value === "string" && IDENTIFIER_MEMBERS.has(name) && !INFORMATION_MODEL_UUID.test(value)) {
    dropped.push(
      warning(
        path,
        "form-not-in-1.0",
        `the identifier ${JSON.stringify(value)} is not of the form that CASE 1.0 asks for, a UUID of lower-case digits, of version 1 to 5; it is kept as it is.`,
      ),
    );
  }
  if (typeof value === "string" && URI_MEMBERS.has(name) && !isAbsoluteUri(value)) {
    dropped.push(
      warning(
        path,
        "form-not-in-1.0",
        `the URI ${JSON.stringify(value)} is not of the form that CASE 1.0 asks for, a URI with a scheme; it is kept as it is.`,
      ),
    );
  }
}

/** Reports the forms of a link, or of each link of a list. */
function reportLinkForms(value: unknown, path: string, dropped: CaseIssue[]): void {
  const links = Array.isArray(value) ? value : [value];
  for (const [index, link] of links.entries()) {
    if (!isRecord(link)) continue;
    const at = Array.isArray(value) ? `${path}[${index}]` : path;
    for (const name of ["identifier", "uri"]) reportForms(name, link[name], member(at, name), dropped);
  }
}

/** Copies a node of an association without its `targetType`, which 1.0 has no property for. */
function convertNode(node: unknown, path: string, dropped: CaseIssue[]): unknown {
  checkRecord(node, `${path} must be an object`);
  const { targetType: _targetType, ...rest } = node;
  reportForms("uri", rest.uri, member(path, "uri"), dropped);
  return copyValue(rest, path);
}

/** Why an association has no form in 1.0, or `undefined` when it has one. */
function whyNotIn10(association: Dictionary): { readonly rule: string; readonly reason: string } | undefined {
  const type = association.associationType;
  if (typeof type === "string" && !ASSOCIATION_TYPES_1_0.includes(type)) {
    return {
      rule: "association-type-not-in-1.0",
      reason: `its type ${JSON.stringify(type)} is not one of the association types of CASE 1.0`,
    };
  }
  for (const side of NODE_MEMBERS) {
    const node = association[side];
    const target = isRecord(node) ? node.targetType : undefined;
    if (target !== undefined && target !== "CASE") {
      return {
        rule: "target-type-not-in-1.0",
        reason: `its ${side} is not a node of CASE, which 1.0 cannot say and would read as one`,
      };
    }
  }
  return undefined;
}

/** Converts the properties of an object of the model, and the objects that it holds. */
function convertObject(entity: Dictionary, path: string, dropped: CaseIssue[], depth: number): Record<string, unknown> {
  checkDepth(depth, path);
  const members: [string, unknown][] = [];
  for (const [name, value] of Object.entries(entity)) {
    const at = member(path, name);
    if (isOnlyIn11(entity, name)) {
      dropped.push(warning(at, "property-not-in-1.0", "CASE 1.0 has no such property here; it is left out."));
    } else if (OBJECT_MEMBERS.has(name)) {
      checkRecord(value, `${at} must be an object`);
      members.push([name, convertObject(value, at, dropped, depth + 1)]);
    } else if (name === "CFAssociations") {
      members.push([name, convertAssociations(value, at, dropped, depth + 1)]);
    } else if (LIST_MEMBERS.has(name)) {
      checkArray(value, `${at} must be an array`);
      members.push([
        name,
        value.map((each, index) => {
          checkRecord(each, `${at}[${index}] must be an object`);
          return convertObject(each, `${at}[${index}]`, dropped, depth + 1);
        }),
      ]);
    } else if (NODE_MEMBERS.has(name)) {
      members.push([name, convertNode(value, at, dropped)]);
    } else {
      members.push([name, copyValue(value, at)]);
      reportForms(name, value, at, dropped);
      if (LINK_MEMBERS.has(name)) reportLinkForms(value, at, dropped);
    }
  }
  // `Object.fromEntries` defines each member, so that a member named `__proto__` stays a member and not a prototype.
  return Object.fromEntries(members);
}

/** Converts an association, or reports why it has no form in 1.0. */
function convertAssociation(
  association: Dictionary,
  path: string,
  dropped: CaseIssue[],
  depth: number,
): Record<string, unknown> | undefined {
  const why = whyNotIn10(association);
  if (why !== undefined) {
    dropped.push(warning(path, why.rule, `the association is left out, because ${why.reason}.`));
    return undefined;
  }
  return convertObject(association, path, dropped, depth);
}

/** Converts the associations of a package or of an item, leaving out those that have no form in 1.0. */
function convertAssociations(
  value: unknown,
  path: string,
  dropped: CaseIssue[],
  depth: number,
): Record<string, unknown>[] {
  checkArray(value, `${path} must be an array`);
  const kept: Record<string, unknown>[] = [];
  for (const [index, each] of value.entries()) {
    checkRecord(each, `${path}[${index}] must be an object`);
    const converted = convertAssociation(each, `${path}[${index}]`, dropped, depth);
    if (converted !== undefined) kept.push(converted);
  }
  return kept;
}

/**
 * Converts a package or an entity of CASE 1.1 to the form of CASE 1.0, and reports what the conversion left out.
 *
 * @remarks
 * 1.0 has no `extensions`, no `frameworkType` or `caseVersion` of a document, no `subject` or `subjectURI` of an item, no
 * `notes` of an association, no `targetType` of a node, and no association type but the nine that it defines. The conversion
 * leaves out the properties, and leaves out an association whose type is not one of the nine or whose node is not a node of
 * CASE, because 1.0 would read the node as a node of CASE. The value is `undefined` for an association that has no form in
 * 1.0, and for the set of an item's associations when none of them has one: a provider answers that it has no such object.
 *
 * 1.0 also holds an identifier to the form of the Information Model (lower case, version 1 to 5) and a URI to a form with a
 * scheme, where 1.1 reads any UUID and any string. The conversion keeps such a value as it is and reports it, so that the
 * result is valid 1.0 when `dropped` holds no `form-not-in-1.0`.
 *
 * The conversion reads the structure of the value as far as it converts it, and not the properties that it copies:
 * `readPackage` and `readEntity` check those.
 *
 * @param value - The package or the entity in the model of 1.1.
 * @param version - The version to convert to.
 * @returns The value in the form of 1.0, which shares nothing with the input, and what was left out.
 * @throws `DataError` when the version is not `"1.0"`, the value is not an object, a part of it that the conversion reads
 * has the wrong type or nests more than `MAX_JSON_DEPTH` levels, or a property that it copies is not JSON.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1, section 1.3}
 */
export function toCaseVersion(value: CasePackage, version: "1.0"): VersionedValue<CasePackage>;
export function toCaseVersion<TEntity extends CaseEntity>(
  value: TEntity,
  version: "1.0",
): VersionedValue<Converted<TEntity>>;
export function toCaseVersion(
  value: CasePackage | CaseEntity,
  version: "1.0",
): VersionedValue<CasePackage | CaseEntity | undefined>;
export function toCaseVersion(value: unknown, version: unknown): VersionedValue<unknown> {
  parseWith(versionSchema, version, "The version");
  checkRecord(value, "The value must be an object");
  const dropped: CaseIssue[] = [];
  const converted =
    "associationType" in value ? convertAssociation(value, "", dropped, 0) : convertObject(value, "", dropped, 0);
  if (
    converted !== undefined &&
    "CFItem" in converted &&
    Array.isArray(converted.CFAssociations) &&
    converted.CFAssociations.length === 0
  ) {
    dropped.push(
      warning(
        "",
        "association-set-empty",
        "the associations of the item are all left out, so that the set has none; a provider answers that it has no such object.",
      ),
    );
    return { value: undefined, dropped };
  }
  return { value: converted, dropped };
}
