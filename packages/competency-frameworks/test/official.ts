import { resolve } from "node:path";
import fc from "fast-check";
import { schemaArbitrary } from "../../../scripts/schema-arbitrary.js";
import {
  readSchema,
  type SchemaClass,
  type SchemaDraft,
  schemaClass,
  schemaDefinitions,
  schemaValidator,
} from "../../../scripts/schema-oracle.js";
import type { CaseEntityKind, CaseVersion } from "../src/index.js";

const ROOT = resolve(import.meta.dirname, "../../..");

// cspell:disable
/** The files of the official schemas of each version, which `pnpm schemas` downloads at pinned hashes. */
const FILES: Readonly<Record<CaseVersion, Readonly<Record<string, string>>>> = {
  "1.1": {
    package: "case_v1p1_cfpackage-jsonschema1.json",
    CFDocument: "case_v1p1_cfdocument-jsonschema1.json",
    CFItem: "case_v1p1_cfitem-jsonschema1.json",
    CFAssociation: "case_v1p1_cfassociation-jsonschema1.json",
    CFAssociationGrouping: "case_v1p1_cfassociationgrouping-jsonschema1.json",
    CFLicense: "case_v1p1_cflicense-jsonschema1.json",
    CFRubric: "case_v1p1_cfrubric-jsonschema1.json",
    CFDocumentSet: "case_v1p1_cfdocumentset-jsonschema1.json",
    CFAssociationSet: "case_v1p1_cfassociationset-jsonschema1.json",
    CFConceptSet: "case_v1p1_cfconceptset-jsonschema1.json",
    CFSubjectSet: "case_v1p1_cfsubjectset-jsonschema1.json",
    CFItemTypeSet: "case_v1p1_cfitemtypeset-jsonschema1.json",
    imsx_StatusInfo: "case_v1p1_imsx_statusinfo-jsonschema1.json",
  },
  "1.0": {
    package: "caseservicegroupv1p0-getcfpackage-200-responsepayload-schemav2p0.json",
    CFDocument: "caseservicegroupv1p0-getcfdocument-200-responsepayload-schemav2p0.json",
    CFItem: "caseservicegroupv1p0-getcfitem-200-responsepayload-schemav2p0.json",
    CFAssociation: "caseservicegroupv1p0-getcfassociation-200-responsepayload-schemav2p0.json",
    CFAssociationGrouping: "caseservicegroupv1p0-getcfassociationgrouping-200-responsepayload-schemav2p0.json",
    CFLicense: "caseservicegroupv1p0-getcflicense-200-responsepayload-schemav2p0.json",
    CFRubric: "caseservicegroupv1p0-getcfrubric-200-responsepayload-schemav2p0.json",
    CFDocumentSet: "caseservicegroupv1p0-getallcfdocuments-200-responsepayload-schemav2p0.json",
    CFAssociationSet: "caseservicegroupv1p0-getcfitemassociations-200-responsepayload-schemav2p0.json",
    CFConceptSet: "caseservicegroupv1p0-getcfconcept-200-responsepayload-schemav2p0.json",
    CFSubjectSet: "caseservicegroupv1p0-getcfsubject-200-responsepayload-schemav2p0.json",
    CFItemTypeSet: "caseservicegroupv1p0-getcfitemtype-200-responsepayload-schemav2p0.json",
    // The status that every answer of the 1.0 binding has for an error; its schema spells two codes without an underscore.
    imsx_StatusInfo:
      "caseservicegroupv1p0-getcfpackage-400-401-403-404-429-500-default-responsepayload-schemav2p0.json",
  },
};
// cspell:enable

/** The draft of JSON Schema that the files of a version are written in. */
const DRAFTS: Readonly<Record<CaseVersion, SchemaDraft>> = { "1.1": "2019-09", "1.0": "7" };

/** The name that the schemas give the entities that have no schema of their own: each is in the answer for a set. */
const WRAPPERS: Readonly<Record<string, { readonly set: string; readonly property: string }>> = {
  CFConcept: { set: "CFConceptSet", property: "CFConcepts" },
  CFSubject: { set: "CFSubjectSet", property: "CFSubjects" },
  CFItemType: { set: "CFItemTypeSet", property: "CFItemTypes" },
};

/** Reads the official schema of a package ("package") or of an entity that has one of its own. */
export function officialSchema(version: CaseVersion, name: string) {
  const file = FILES[version][name];
  if (file === undefined) throw new Error(`No official schema of ${name} in ${version}.`);
  return readSchema(ROOT, file);
}

/**
 * Returns a function that tells whether a value is valid by the official schema of a package ("package") or of an entity.
 * A concept, a subject and an item type are checked as the only member of the set that holds them.
 */
export function officialValidator(version: CaseVersion, name: CaseEntityKind | "package"): (value: unknown) => boolean {
  const wrapper = WRAPPERS[name];
  const valid = (target: string) => schemaValidator(officialSchema(version, target), DRAFTS[version]);
  if (wrapper === undefined) return valid(name);
  const set = valid(wrapper.set);
  return (value) => set({ [wrapper.property]: [value] });
}

/**
 * Lists the classes that the official schemas of a version define, by the name that 1EdTech gives each: the classes of the
 * package schema, the classes that have a schema of their own outside a package, and the status.
 */
export function officialClasses(version: CaseVersion): ReadonlyMap<string, SchemaClass> {
  const classes = new Map<string, SchemaClass>();
  const pkg = officialSchema(version, "package");
  classes.set("CFPackage", schemaClass(pkg));
  for (const [name, definition] of schemaDefinitions(pkg)) {
    if (!name.endsWith("Extension")) classes.set(name.replace(/DType$/u, ""), definition);
  }
  for (const name of Object.keys(FILES[version])) {
    if (name === "package") continue;
    const schema = officialSchema(version, name);
    classes.set(name, schemaClass(schema));
    if (name === "imsx_StatusInfo") {
      for (const [inner, definition] of schemaDefinitions(schema))
        classes.set(inner.replace(/DType$/u, ""), definition);
    }
  }
  return classes;
}

/** The 1.1 forms of an identifier: 8-4-4-4-12 digits of either case, of any version. */
const UUID_1_1 = fc
  .uuid({ version: [1, 2, 3, 4, 5, 6, 7, 8] })
  .chain((uuid) => fc.constantFrom(uuid, uuid.toUpperCase()));

/** A date and time with an offset, as RFC 3339 writes it and every validator reads it. */
export const DATE_TIME = fc
  .tuple(
    fc.date({ min: new Date("1971-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true }),
    fc.constantFrom("Z", "+00:00", "+05:30", "-08:00"),
  )
  .map(([date, offset]) => `${date.toISOString().slice(0, 19)}${offset}`);

export const DATE = fc
  .date({ min: new Date("1971-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true })
  .map((date) => date.toISOString().slice(0, 10));

export const ABSOLUTE_URI = fc
  .stringMatching(/^[a-z0-9]{1,12}$/u)
  .map((name) => `https://case.example.edu/ims/case/v1p1/${name}`);

/** The forms of a `uri` that 1.1 reads, which 1.0 does not: the schemas of 1.1 give it as a plain string. */
const URI_1_1 = fc.oneof(ABSOLUTE_URI, fc.constantFrom("", "relative/path", "CFItems/1"));

/**
 * The terms of an extension of the association vocabulary on which the Information Model and the pattern of the schema agree:
 * the pattern has no hyphen in its class of characters, because `|-|` is a range.
 */
export const EXTENSION_TERM = fc.stringMatching(/^ext:[A-Za-z0-9._]+$/u);

/** The text of the pattern that the 1.1 schemas give an extension term, which is looser than the Information Model. */
const EXTENSION_PATTERN = "(ext:)[a-z|A-Z|0-9|.|-|_]+";

/**
 * Returns a generator of the values of the official schema of a package ("package") or an entity, made from the schema, with
 * the forms of each format in which the standard and the reader agree, and with the `uri` that only 1.1 reads, relative
 * ones, when `forms` is `"1.1"`.
 */
export function officialArbitrary(
  version: CaseVersion,
  name: CaseEntityKind | "package",
  forms: "agreed" | "1.1" = "agreed",
): fc.Arbitrary<Record<string, unknown>> {
  const properties: Record<string, fc.Arbitrary<unknown>> = forms === "1.1"
    ? { uri: URI_1_1, officialSourceURL: URI_1_1 }
    : {};
  const options = {
    formats: { uuid: UUID_1_1, "date-time": DATE_TIME, date: DATE, uri: ABSOLUTE_URI },
    patterns: { [EXTENSION_PATTERN]: EXTENSION_TERM },
    properties,
  };
  const wrapper = WRAPPERS[name];
  const arbitrary = schemaArbitrary(officialSchema(version, wrapper?.set ?? name), options);
  if (wrapper === undefined) return arbitrary.filter(isDictionary);
  return arbitrary
    .filter(isDictionary)
    .map((set) => set[wrapper.property])
    .filter(Array.isArray)
    .map((members) => members[0])
    .filter(isDictionary);
}

function isDictionary(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
