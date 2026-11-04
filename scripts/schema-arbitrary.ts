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
  /**
   * The most references that one value may follow in a row. Past it a value leaves its optional properties out and takes a
   * branch without a reference, so that classes that refer to each other end. Without it a cycle of references throws.
   */
  readonly maxDepth?: number;
  /**
   * Whether every property of an object is generated, not only the required ones, until `maxDepth` is reached, a list has a
   * member, and a choice takes the branches that refer to a class when there are such. A value of this kind holds an instance of every class that
   * the schema reaches, so that a fixture written from it exercises a reader whole.
   */
  readonly allProperties?: boolean;
}

type Node = Readonly<Record<string, unknown>>;

/**
 * The names of members that every reader of the family refuses, since they name the prototype chain (STANDARDS section 5,
 * "Errors"), though a schema that takes any member takes them: a generated value holds none, and the `spec-gaps.md` of each
 * package lists the difference.
 */
const PROTOTYPE_NAMES: readonly string[] = ["__proto__", "constructor", "prototype"];

/** A name of a member that a reader of the family takes: any text but a name of the prototype chain. */
export const memberName = (text: fc.Arbitrary<string>): fc.Arbitrary<string> =>
  text.filter((name) => !PROTOTYPE_NAMES.includes(name));

/** A JSON value of at most the given depth, with no member named by the prototype chain. */
export const memberJson = (maxDepth: number): fc.Arbitrary<unknown> =>
  fc
    .jsonValue({ maxDepth })
    .map((value) =>
      JSON.parse(JSON.stringify(value), (name, member) => (PROTOTYPE_NAMES.includes(name) ? undefined : member)),
    );

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
  "additionalItems",
  "contains",
  "allOf",
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
 * `items` as one schema or as a list for a tuple, `additionalItems` as a schema, `contains` as the terms that a list must hold,
 * `allOf` of such lists, `minItems`, `format` and `pattern`.
 *
 * @param root - The schema, as parsed.
 * @param options - The forms of the formats and the patterns, and how deep references go.
 * @returns A generator of values that the schema accepts when the options give valid forms.
 * @throws `Error` for a keyword it does not read (`not`, `maxLength`), an `allOf` of anything but lists that must hold terms, a
 * `type` that is a list or a name it does not generate, a `$ref` to another file, an `additionalProperties` that is a schema, and a required property with no schema.
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
  // The references that the value being built follows, from its root to the schema at hand.
  let depth = 0;
  const tooDeep = () => depth > (options.maxDepth ?? Number.POSITIVE_INFINITY);
  const follow = (reference: unknown): fc.Arbitrary<unknown> => {
    depth += 1;
    try {
      return build(resolve(reference));
    } finally {
      depth -= 1;
    }
  };
  const choose = (branches: readonly unknown[]): fc.Arbitrary<unknown> => {
    const plain = branches.filter((branch) => !(isNode(branch) && branch.$ref !== undefined));
    if (tooDeep() && plain.length > 0) return fc.oneof(...plain.map(build));
    // A value with all its properties reaches the classes, so it takes the branches that refer to one.
    const referring = branches.filter((branch) => JSON.stringify(branch).includes('"$ref"'));
    return fc.oneof(...(options.allProperties === true && referring.length > 0 ? referring : branches).map(build));
  };
  const build = (schema: unknown): fc.Arbitrary<unknown> => {
    if (!isNode(schema)) throw new Error("A schema is an object.");
    checkKeywords(schema);
    if (schema.$ref !== undefined) return follow(schema.$ref);
    if ("const" in schema) return fc.constant(schema.const);
    if (Array.isArray(schema.enum)) return fc.constantFrom(...schema.enum);
    const branches = schema.oneOf ?? schema.anyOf;
    if (Array.isArray(branches)) return choose(branches);
    if (Array.isArray(schema.allOf)) return containingList(schema.allOf.map(asNode));
    return buildTyped(schema);
  };
  const asNode = (schema: unknown): Node => {
    if (!isNode(schema)) throw new Error("A schema is an object.");
    return schema;
  };
  /** The terms that a `contains` names: the values of its `enum` or its `const`. */
  const termsOf = (contains: unknown): readonly unknown[] => {
    const node = asNode(contains);
    if (Array.isArray(node.enum)) return node.enum;
    if ("const" in node) return [node.const];
    throw new Error("A contains that names no enum or const is not generated.");
  };
  /** A list that holds one term of each `contains`, and a few more members of the items. */
  const containingList = (lists: readonly Node[]): fc.Arbitrary<unknown> => {
    for (const list of lists) {
      checkKeywords(list);
      if (list.type !== "array" || list.contains === undefined) {
        throw new Error("An allOf of anything but lists that must hold terms is not generated.");
      }
    }
    const required = fc.tuple(...lists.map((list) => fc.constantFrom(...termsOf(list.contains))));
    const extra = fc.array(build(lists[0]?.items), { maxLength: EXTRA_ENTRIES });
    return fc.tuple(required, extra).map(([terms, more]) => [...terms, ...more]);
  };
  const arrayOf = (schema: Node): fc.Arbitrary<unknown> => {
    if (Array.isArray(schema.items)) {
      const head = fc.tuple(...schema.items.map(build));
      const tail = isNode(schema.additionalItems)
        ? fc.array(build(schema.additionalItems), { maxLength: EXTRA_ENTRIES })
        : fc.constant([]);
      return fc.tuple(head, tail).map(([fixed, more]) => [...fixed, ...more]);
    }
    if (schema.contains !== undefined) return containingList([schema]);
    const declared = typeof schema.minItems === "number" ? schema.minItems : 0;
    // A list of a value with all its properties has a member, so that the value reaches the class of its members.
    const minItems = options.allProperties === true ? Math.max(declared, 1) : declared;
    return fc.array(build(schema.items), { minLength: minItems, maxLength: minItems + EXTRA_ENTRIES });
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
      case "array":
        return arrayOf(schema);
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
  /** Reads the properties and the required names of an object, and refuses what the generator does not read. */
  const classOf = (schema: Node): { properties: Node; required: string[] } => {
    const properties = isNode(schema.properties) ? schema.properties : {};
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const name of required) {
      if (!(name in properties)) throw new Error(`The property ${name} is required and has no schema.`);
    }
    if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
      throw new Error("An additionalProperties that is a schema is not generated.");
    }
    return { properties, required };
  };
  const objectOf = (schema: Node): fc.Arbitrary<unknown> => {
    const { properties, required } = classOf(schema);
    const kept = Object.entries(properties).filter(([name]) => !tooDeep() || required.includes(name));
    const all = options.allProperties === true && !tooDeep();
    const listed = fc.record(
      Object.fromEntries(kept.map(([name, property]) => [name, options.properties?.[name] ?? build(property)])),
      { requiredKeys: all ? kept.map(([name]) => name) : required },
    );
    if (schema.additionalProperties !== true) return listed;
    const free = fc.dictionary(
      memberName(fc.string({ minLength: 1, maxLength: 8 })).filter((name) => !(name in properties)),
      memberJson(2),
      { maxKeys: MAX_FREE_PROPERTIES },
    );
    return fc.tuple(listed, free).map(([known, extra]) => ({ ...extra, ...known }));
  };
  return build(root);
}
