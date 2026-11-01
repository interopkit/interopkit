import fc from "fast-check";

/** What `schemaArbitrary` needs besides the schema. */
export interface SchemaArbitraryOptions {
  /**
   * The values of each `format` that a validator and the reader under test agree on. A format that is not listed gives any
   * string.
   */
  readonly formats?: Readonly<Record<string, fc.Arbitrary<string>>>;
  /** The values of a `pattern`, by the pattern, where its text is looser than the standard that it states. */
  readonly patterns?: Readonly<Record<string, fc.Arbitrary<string>>>;
  /** The values of a property, by its name in any object, where the schema gives only a plain string. */
  readonly properties?: Readonly<Record<string, fc.Arbitrary<unknown>>>;
}

type Node = Readonly<Record<string, unknown>>;

/** The keywords that only describe: they say nothing about the values, or they hold the definitions that a `$ref` names. */
const DESCRIPTIVE_KEYWORDS = new Set([
  "$schema",
  "$id",
  "$comment",
  "title",
  "description",
  "default",
  "examples",
  "$defs",
  "definitions",
]);
/** The keywords that the generator reads. A keyword outside both lists would narrow or widen the values unseen, so it throws. */
const GENERATED_KEYWORDS = new Set([
  "$ref",
  "const",
  "enum",
  "oneOf",
  "anyOf",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "minItems",
  "format",
  "pattern",
]);

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The most entries of a list that is generated beyond its least. */
const EXTRA_ENTRIES = 2;
/** The most properties of an object that holds any JSON. */
const MAX_FREE_PROPERTIES = 3;

/** Throws for a keyword that the generator does not read, so that no constraint is dropped unseen. */
function checkKeywords(schema: Node): void {
  for (const keyword of Object.keys(schema)) {
    if (!DESCRIPTIVE_KEYWORDS.has(keyword) && !GENERATED_KEYWORDS.has(keyword)) {
      throw new Error(`The schema keyword ${keyword} is not generated.`);
    }
  }
}

/**
 * Builds a generator of the values that a JSON Schema accepts, from the schema itself, so that a test does not restate its
 * classes. It reads `$ref` to a place of the same file (`#/$defs/Name`), `type` as one name, `enum`, `const`, `oneOf`, `anyOf`,
 * `properties`, `required`, `additionalProperties` as `true`, `false` or absent (extras are generated for `true` only),
 * `items`, `minItems`, `format` and `pattern`.
 *
 * @param root - The schema, as parsed.
 * @param options - The forms of the formats and the patterns.
 * @returns A generator of values that the schema accepts when the options give valid forms.
 * @throws `Error` for a keyword it does not read (`allOf`, `not`, `maxLength`), a `type` that is a list or a name it does not
 * generate, a `$ref` to another file, an `additionalProperties` that is a schema, and a required property with no schema.
 */
export function schemaArbitrary(root: unknown, options: SchemaArbitraryOptions = {}): fc.Arbitrary<unknown> {
  const resolve = (reference: unknown): unknown => {
    if (typeof reference !== "string" || !reference.startsWith("#/")) {
      throw new Error(`The reference ${String(reference)} is not to a place of the same file.`);
    }
    let node: unknown = root;
    for (const part of reference.replace(/^#\//u, "").split("/")) node = isNode(node) ? node[part] : undefined;
    return node;
  };
  const build = (schema: unknown): fc.Arbitrary<unknown> => {
    if (!isNode(schema)) throw new Error("A schema is an object.");
    checkKeywords(schema);
    if (schema.$ref !== undefined) return build(resolve(schema.$ref));
    if ("const" in schema) return fc.constant(schema.const);
    if (Array.isArray(schema.enum)) return fc.constantFrom(...schema.enum);
    const branches = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(branches)) return fc.oneof(...branches.map(build));
    return buildTyped(schema);
  };
  const buildTyped = (schema: Node): fc.Arbitrary<unknown> => {
    switch (schema.type) {
      case "string":
        return stringOf(schema);
      case "integer":
        return fc.integer({ min: 0, max: 1000 });
      case "number":
        // A negative zero is a number that JSON writes as 0.
        return fc.double({ noNaN: true, noDefaultInfinity: true }).map((value) => (value === 0 ? 0 : value));
      case "boolean":
        return fc.boolean();
      case "array": {
        const minItems = typeof schema.minItems === "number" ? schema.minItems : 0;
        return fc.array(build(schema.items), { minLength: minItems, maxLength: minItems + EXTRA_ENTRIES });
      }
      case "object":
        return objectOf(schema);
      default:
        throw new Error(`The schema type ${JSON.stringify(schema.type)} is not generated.`);
    }
  };
  const stringOf = (schema: Node): fc.Arbitrary<string> => {
    const { format, pattern } = schema;
    if (typeof pattern === "string") {
      const override = options.patterns?.[pattern];
      return override ?? fc.stringMatching(new RegExp(`^(?:${pattern})$`, "u"));
    }
    return (typeof format === "string" ? options.formats?.[format] : undefined) ?? fc.string({ maxLength: 24 });
  };
  const objectOf = (schema: Node): fc.Arbitrary<unknown> => {
    const properties = isNode(schema.properties) ? schema.properties : {};
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const name of required) {
      if (!(name in properties)) throw new Error(`The property ${name} is required and has no schema.`);
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
      throw new Error("An additionalProperties that is a schema is not generated.");
    }
    const listed = fc.record(
      Object.fromEntries(
        Object.entries(properties).map(([name, property]) => [name, options.properties?.[name] ?? build(property)]),
      ),
      { requiredKeys: required },
    );
    if (schema.additionalProperties !== true) return listed;
    const free = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 8 }).filter((name) => name !== "__proto__" && !(name in properties)),
      fc.jsonValue({ maxDepth: 2 }),
      { maxKeys: MAX_FREE_PROPERTIES },
    );
    return fc.tuple(listed, free).map(([known, extra]) => ({ ...extra, ...known }));
  };
  return build(root);
}
