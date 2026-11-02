import { resolve } from "node:path";
import fc from "fast-check";
import { schemaArbitrary } from "../../../scripts/schema-arbitrary.js";
import { readSchema, type SchemaClass, schemaClass, schemaValidator } from "../../../scripts/schema-oracle.js";
import { readSpecPage } from "../../../scripts/spec-examples.js";

const ROOT = resolve(import.meta.dirname, "../../..");

/** A JSON Schema, or any object that holds one. */
export type Json = Record<string, unknown>;

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a pinned schema file, which `pnpm schemas` downloads. */
export function fileSchema(name: string): Json {
  return readSchema(ROOT, name) as Json;
}

/** Reads the schema that a specification page prints for a class, which `pnpm spec-examples` downloads. */
export function pageSchemaNamed(id: string): Json {
  return pageSchema("open-badges-3p0.json", id);
}

function pageSchema(page: "open-badges-3p0.json" | "clr-2p0.json", id: string): Json {
  const found = readSpecPage(ROOT, page).filter(
    (block): block is Json => isJson(block) && typeof block.$id === "string" && block.$id.endsWith(`/${id}`),
  );
  if (found.length !== 1) throw new Error(`The page ${page} prints ${found.length} schemas named ${id}.`);
  return found[0] as Json;
}

/** Makes the schema of one definition of a file that holds many: the definition, with the others to refer to. */
function definition(source: Json, name: string): Json {
  return { $schema: source.$schema, $defs: source.$defs, $ref: `#/$defs/${name}` };
}

/** Makes the schema of the branch of the `anyOf` of a file that has a property, with the definitions of the file. */
function branchWith(source: Json, property: string): Json {
  const found = (Array.isArray(source.anyOf) ? source.anyOf : []).filter(
    (entry): entry is Json => isJson(entry) && isJson(entry.properties) && property in entry.properties,
  );
  if (found.length !== 1) throw new Error(`The schema has ${found.length} branches with the property ${property}.`);
  return { $schema: source.$schema, $defs: source.$defs, ...found[0] };
}

/** Tells whether a schema is a map of language codes to strings, which the compacted form of JSON-LD allows for any text. */
function isLanguageMap(schema: unknown): boolean {
  return (
    isJson(schema) && schema.type === "object" && schema.propertyNames !== undefined && schema.properties === undefined
  );
}

/** The pattern that the schemas give a term of an extension, which is looser than the specification and has a typo. */
const EXTENSION_PATTERN = "(ext:)[a-z|A-Z|0-9|.|-|_]+";
/** The term of an extension as the reader holds it: `ext:` and a name. */
const EXTENSION_TERM = /^ext:[A-Za-z0-9._-]+$/u;

/** Returns the terms that a list of the schemas must contain, when a schema is a list that must contain a term. */
function containedTerms(schema: unknown): unknown[] | undefined {
  if (!isJson(schema)) return undefined;
  if (isJson(schema.allOf) || Array.isArray(schema.allOf)) return undefined;
  const contains = schema.contains;
  if (schema.type === "array" && isJson(contains) && Array.isArray(contains.enum)) return contains.enum;
  return undefined;
}

/** Tells whether a schema is a list, or the allOf of lists, that must contain terms. */
function isTermList(schema: unknown): schema is Json {
  if (!isJson(schema)) return false;
  if (Array.isArray(schema.allOf)) return schema.allOf.every((member) => containedTerms(member) !== undefined);
  return containedTerms(schema) !== undefined;
}

/**
 * Rewrites a schema of 1EdTech into the schema that the readers keep to. The schemas write a text as a string or a map of
 * languages, a type as any string or a list that holds its class, and the contexts as one context or an ordered list. The
 * readers read a text as a string, a type as a list that holds its class, and the contexts as an ordered list, and they hold
 * an extension term to `ext:` and a name; each of these is a difference that `spec-gaps.md` states and a test pins.
 */
function tighten(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(tighten);
  if (!isJson(schema)) return schema;
  const result: Json = {};
  for (const [name, member] of Object.entries(schema)) {
    if (name === "properties" && isJson(member)) {
      result[name] = Object.fromEntries(Object.entries(member).map(([property, value]) => [property, tighten(value)]));
    } else if (name === "$defs" && isJson(member)) {
      result[name] = Object.fromEntries(Object.entries(member).map(([key, value]) => [key, tighten(value)]));
    } else if (name === "pattern" && member === EXTENSION_PATTERN) {
      result[name] = EXTENSION_TERM.source;
    } else if (name === "prefixItems") {
      // The pages print the 2020-12 form of a tuple; the files print the 2019-09 form, which the validator reads.
      result.items = tighten(member);
      result.additionalItems = tighten(schema.items);
    } else if (name === "items" && "prefixItems" in schema) {
      // Written together with prefixItems above.
    } else {
      result[name] = tighten(member);
    }
  }
  for (const key of ["oneOf", "anyOf"] as const) {
    const branches = result[key];
    if (!Array.isArray(branches)) continue;
    let kept = branches.filter((entry) => !isLanguageMap(entry));
    // A context is one context or an ordered list; only the list can hold the contexts that a class requires.
    if (kept.some((entry) => isJson(entry) && entry.type === "array")) {
      kept = kept.filter(
        (entry) => !(isJson(entry) && typeof entry.$ref === "string" && entry.$ref.endsWith("/Context")),
      );
    }
    // A type is any string or a list that holds its class: the readers read a string only when it is the class.
    const list = kept.find(isTermList);
    if (list !== undefined) {
      const terms = Array.isArray(list.allOf) ? [] : (containedTerms(list) ?? []);
      kept = kept.filter((entry) => entry === list || !(isJson(entry) && entry.type === "string"));
      if (terms.length > 0) kept.push({ enum: terms });
    }
    if (kept.length === 1 && isJson(kept[0])) {
      const { [key]: _removed, ...rest } = result;
      return { ...rest, ...kept[0] };
    }
    result[key] = kept;
  }
  return result;
}

/** A date and time with an offset, as RFC 3339 writes it and every validator reads it. */
const DATE_TIME = fc
  .tuple(
    fc.date({ min: new Date("1971-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true }),
    fc.constantFrom("Z", "+00:00", "+05:30", "-08:00"),
  )
  .map(([date, offset]) => `${date.toISOString().slice(0, 19)}${offset}`);

const DATE = fc
  .date({ min: new Date("1971-01-01T00:00:00Z"), max: new Date("2099-12-31T23:59:59Z"), noInvalidDate: true })
  .map((date) => date.toISOString().slice(0, 10));

/** The terms of an extension on which the reader and the tightened pattern agree. */
const EXTENSION = fc.stringMatching(/^ext:[A-Za-z0-9._-]+$/u);

/** What a schema of the standards gives the tests: a verdict, and values the schema accepts. */
export interface Oracle {
  /** Tells whether the schema accepts a value. */
  readonly valid: (value: unknown) => boolean;
  /** Generates values that the schema accepts. */
  readonly arbitrary: fc.Arbitrary<Record<string, unknown>>;
}

/**
 * Builds the oracle of a schema, in the form that the readers keep to.
 *
 * @param schema - The schema, as 1EdTech prints it.
 * @param depth - How many references a value follows: a value of the oracle with `full` set has every property of every class
 * until then.
 */
export function oracleOf(schema: Json, { full = false, depth = 3 }: { full?: boolean; depth?: number } = {}): Oracle {
  const tight = tighten(schema) as Json;
  const arbitrary = schemaArbitrary(tight, {
    formats: { "date-time": DATE_TIME, date: DATE },
    patterns: { [EXTENSION_TERM.source]: EXTENSION },
    maxDepth: depth,
    allProperties: full,
  });
  return {
    valid: schemaValidator(tight as never, "2019-09"),
    arbitrary: arbitrary.filter(isJson),
  };
}

/**
 * Gives a full value a validity period that ends after it begins. The schemas generate both times independently, and the
 * readers refuse a credential that ends before it begins, which the schemas do not state.
 */
export function withOrderedPeriod(value: Json | undefined): Json | undefined {
  if (value === undefined) return value;
  const [begins, ends] = "validFrom" in value ? ["validFrom", "validUntil"] : ["issuanceDate", "expirationDate"];
  const [from, until] = [value[begins ?? ""], value[ends ?? ""]];
  if (typeof from !== "string" || typeof until !== "string" || Date.parse(until) >= Date.parse(from)) return value;
  return { ...value, [ends ?? ""]: from };
}

/** Reads the properties and the required properties of a schema, of its definition, or of the class it refers to. */
export function classOf(schema: Json): SchemaClass {
  const target = typeof schema.$ref === "string" ? lookup(schema, schema.$ref) : schema;
  return schemaClass(target);
}

function lookup(root: Json, reference: string): Json {
  let node: unknown = root;
  for (const part of reference.replace(/^#\//u, "").split("/")) node = isJson(node) ? node[part] : undefined;
  if (!isJson(node)) throw new Error(`The reference ${reference} leads nowhere.`);
  return node;
}

/** A class of the model that a schema of 1EdTech describes, and the way the package reads it. */
export interface OfficialCase {
  /** The name of the class as the package reads it: a `CredentialKind` or an `EntityKind`. */
  readonly name: string;
  /** Whether the class is a credential. */
  readonly credential: boolean;
  /** Reads the schema of the class, in the form that 1EdTech prints it. */
  readonly schema: () => Json;
}

// cspell:disable
const OB = (name: string) => `ob_v3p0_${name}_schema.json`;
const CLR = (name: string) => `clr_v2p0_${name}_schema.json`;

/** The classes whose schema is a file that 1EdTech publishes. */
export const FILE_CASES: readonly OfficialCase[] = [
  { name: "AchievementCredential", credential: true, schema: () => fileSchema(OB("achievementcredential")) },
  { name: "EndorsementCredential", credential: true, schema: () => fileSchema(OB("endorsementcredential")) },
  {
    name: "VerifiableCredential",
    credential: true,
    schema: () => definition(fileSchema(CLR("clrcredential")), "VerifiableCredential"),
  },
  { name: "ClrCredential", credential: true, schema: () => fileSchema(CLR("clrcredential")) },
  {
    name: "AchievementCredentialV1p1",
    credential: true,
    schema: () => branchWith(fileSchema(OB("anyachievementcredential")), "issuanceDate"),
  },
  {
    name: "EndorsementCredentialV1p1",
    credential: true,
    schema: () => branchWith(fileSchema(OB("anyendorsementcredential")), "issuanceDate"),
  },
  {
    name: "VerifiableCredentialV1p1",
    credential: true,
    schema: () => definition(fileSchema(CLR("anyclrcredential")), "VerifiableCredentialv1p1"),
  },
  {
    name: "ClrCredentialV1p1",
    credential: true,
    schema: () => branchWith(fileSchema(CLR("anyclrcredential")), "issuanceDate"),
  },
  {
    name: "Achievement",
    credential: false,
    schema: () => definition(fileSchema(OB("anyachievementcredential")), "Achievement"),
  },
  { name: "Profile", credential: false, schema: () => fileSchema(OB("profile")) },
  {
    name: "GetOpenBadgeCredentialsResponse",
    credential: false,
    schema: () => fileSchema(OB("getopenbadgecredentialsresponse")),
  },
  { name: "GetClrCredentialsResponse", credential: false, schema: () => fileSchema(CLR("getclrcredentialsresponse")) },
  { name: "imsx_StatusInfo", credential: false, schema: () => fileSchema(OB("imsx_statusinfo")) },
  { name: "ServiceDescriptionDocument", credential: false, schema: () => fileSchema(OB("servicedescriptiondocument")) },
];

/** The classes whose schema only a specification page prints. */
export const PAGE_CASES: readonly OfficialCase[] = [
  {
    name: "Multikey",
    credential: false,
    schema: () => pageSchema("open-badges-3p0.json", "ob_v3p0_multikey-jsonschema1.json"),
  },
  { name: "JWK", credential: false, schema: () => pageSchema("open-badges-3p0.json", "ob_v3p0_jwk-jsonschema1.json") },
  {
    name: "JWKS",
    credential: false,
    schema: () => pageSchema("open-badges-3p0.json", "ob_v3p0_jwks-jsonschema1.json"),
  },
  {
    name: "ClrCredentialJwtPayload",
    credential: false,
    schema: () => pageSchema("clr-2p0.json", "clr_v2p0_clrcredentialjwtpayload-jsonschema1.json"),
  },
  {
    name: "ClrSubjectJwtPayload",
    credential: false,
    schema: () => pageSchema("clr-2p0.json", "clr_v2p0_clrsubjectjwtpayload-jsonschema1.json"),
  },
];

/** What the readers hold of a class, read from its schema: the names of its properties, the required ones, and whether it is closed. */
export interface HeldClass {
  readonly properties: readonly string[];
  readonly required: readonly string[];
  readonly strict: boolean;
}

/** Finds the object schema inside a schema of the readers, which may be piped through checks and transforms. */
export function heldClass(schema: unknown): HeldClass | undefined {
  if (!isJson(schema)) return undefined;
  if (isJson(schema.entries)) {
    const entries = schema.entries;
    return {
      properties: Object.keys(entries),
      required: Object.entries(entries)
        .filter(([, entry]) => !(isJson(entry) && entry.type === "optional"))
        .map(([name]) => name),
      strict: schema.type === "strict_object",
    };
  }
  if (Array.isArray(schema.pipe)) {
    for (const step of schema.pipe) {
      const found = heldClass(step);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** The name of the export of the readers that holds a class, from the name that 1EdTech gives it. */
export function schemaExportName(className: string): string {
  const name = className.replace(/v1p1$/u, "V1p1").replace(/^[Ii]msx_/u, "Imsx");
  return `${/^[A-Z]+$/u.test(name) ? name.toLowerCase() : name.charAt(0).toLowerCase() + name.slice(1)}Schema`;
}

/** Lists the classes of a schema file: its definitions, by the name that the schema gives each. */
export function definitionsOf(source: Json): ReadonlyMap<string, SchemaClass> {
  const defs = isJson(source.$defs) ? source.$defs : {};
  return new Map(
    Object.entries(defs)
      .filter(([, value]) => isJson(value) && isJson(value.properties))
      .map(([name, value]) => [name, schemaClass(value)]),
  );
}

/** Tells whether a class of a schema is closed to properties it does not list. */
export function isClosed(source: Json, name: string): boolean {
  const defs = isJson(source.$defs) ? source.$defs : {};
  const value = defs[name];
  return isJson(value) && value.additionalProperties === false;
}
// cspell:enable
