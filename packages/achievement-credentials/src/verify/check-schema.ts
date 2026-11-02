import { Validator } from "@cfworker/json-schema";
import { callService, ServiceError } from "@interopkit/core";
import { isRecord } from "@interopkit/core/checks";
import { parseJsonText } from "../json-text.js";
import type { VerificationCheck } from "../model/index.js";
import { OFFICIAL_SCHEMA_IDS, SCHEMA_TYPE } from "../model/internal.js";
import type { Authentic } from "./authenticate.js";
import type { Context } from "./context.js";
import { checkOf } from "./result.js";
import { createWorkMeter, WorkLimitError, type WorkMeter } from "./work-meter.js";

/** A schema that a credential names, ready to judge credentials with the meter of its work, or the reason that it cannot be used. */
export type SchemaLoad = { readonly validator: Validator; readonly meter: WorkMeter } | { readonly reason: string };

/** The drafts of JSON Schema that the validator runs, by the `$schema` that names them, without the `#` that may end it. */
const DRAFTS = {
  "http://json-schema.org/draft-04/schema": "4",
  "http://json-schema.org/draft-07/schema": "7",
  "https://json-schema.org/draft/2019-09/schema": "2019-09",
  "https://json-schema.org/draft/2020-12/schema": "2020-12",
} as const;

/** The draft of a schema that names none: the one that the name 1EdTechJsonSchemaValidator2019 stands for. */
const DEFAULT_DRAFT = "2019-09";

/** The most reasons of a schema that a check lists. */
const MAX_LISTED = 3;

/** The most schemas of a credential, other than those of 1EdTech, that are fetched: each costs a fetch of an address it chose. */
const MAX_SCHEMAS = 4;

/**
 * The most values that the validator reads, of the schema and of the credential, to judge one credential. A keyword applied to a
 * value, and each pair of items that `uniqueItems` compares, is a read, so a schema whose work grows with the product of its size
 * and the credential's, or with the square of a list, stops here: about a second. The official schema of an AchievementCredential
 * reads 88,000 values on the complete example of Open Badges 3.0, a credential of 16,682 characters.
 */
const MAX_SCHEMA_READS = 10_000_000;

/** Reads the draft that a schema names in `$schema`. */
function draftOf(schema: unknown): (typeof DRAFTS)[keyof typeof DRAFTS] | typeof DEFAULT_DRAFT {
  const name = typeof schema === "string" ? schema.replace(/#$/u, "") : "";
  return Object.entries(DRAFTS).find(([uri]) => uri === name)?.[1] ?? DEFAULT_DRAFT;
}

/**
 * Tells whether a schema holds a keyword that runs a regular expression. A pattern can be written to backtrack for longer than
 * a verifier can wait, and the credential that a pattern is run on is written by the same issuer as the schema, so none runs.
 * The validator checks every `format` with a regular expression too, and that of `url` takes four times as long for each two more
 * characters of its value.
 */
function runsRegularExpressions(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(runsRegularExpressions);
  if (!isRecord(node)) return false;
  return Object.entries(node).some(
    ([keyword, value]) =>
      ((keyword === "pattern" || keyword === "format") && typeof value === "string") ||
      (keyword === "patternProperties" && isRecord(value)) ||
      runsRegularExpressions(value),
  );
}

/** Fetches a schema that a credential names, within the limits of a fetch and of the JSON that the package reads. */
async function loadSchema(url: string, context: Context): Promise<SchemaLoad> {
  const { settings } = context;
  const label = `The schema at ${url}`;
  if (!url.startsWith("https://") || !URL.canParse(url)) return { reason: `${label} is not at an HTTPS address.` };
  if (settings.fetch === undefined) return { reason: `${label} cannot be read: no fetch was given.` };
  let text: string;
  try {
    text = await callService(
      {
        fetch: settings.fetch,
        timeoutMs: settings.timeoutMs,
        ...(settings.jwt.signal === undefined ? {} : { signal: settings.jwt.signal }),
      },
      label,
      url,
      { method: "GET", headers: { accept: "application/schema+json, application/json" } },
      { maxBytes: settings.maxBytes },
    );
  } catch (error) {
    if (error instanceof ServiceError) return { reason: error.message };
    throw error;
  }
  const { maxDepth, maxTokens } = settings.jwt;
  const parsed = parseJsonText(text, { maxDepth, maxTokens }, label);
  if ("reason" in parsed) return { reason: parsed.reason };
  const schema = parsed.value;
  if (!isRecord(schema)) return { reason: `${label} is not a JSON object.` };
  if (runsRegularExpressions(schema)) {
    return { reason: `${label} runs regular expressions, which no schema that a credential names is allowed to do.` };
  }
  const meter = createWorkMeter(MAX_SCHEMA_READS);
  try {
    // The validator reads the schema as it reads the credential: through the meter, which starts again for each credential.
    return { validator: new Validator(meter.wrap(schema), draftOf(schema.$schema)), meter };
  } catch (error) {
    if (error instanceof WorkLimitError) return { reason: `${label} is larger than a verifier reads.` };
    return { reason: `${label} cannot be used: ${error instanceof Error ? error.message : "it is not a schema"}.` };
  }
}

/** Judges a credential with a schema: what is wrong with it, or `undefined`; or the reason that the schema could not judge. */
function judge(
  { validator, meter }: { readonly validator: Validator; readonly meter: WorkMeter },
  raw: unknown,
  url: string,
): { readonly failed: string } | { readonly unavailable: string } | undefined {
  meter.reset();
  try {
    const { valid, errors } = validator.validate(meter.wrap(raw));
    if (valid) return undefined;
    const listed = errors
      .slice(0, MAX_LISTED)
      .map(({ instanceLocation, error }) => `${instanceLocation}: ${error}`)
      .join("; ");
    return { failed: `The credential does not conform to the schema at ${url}: ${listed}.` };
  } catch (error) {
    if (error instanceof WorkLimitError) {
      return {
        unavailable: `The schema at ${url} needs to read more than ${MAX_SCHEMA_READS} values to judge the credential, more than a verifier gives it.`,
      };
    }
    // The validator throws for what it cannot resolve, such as a $ref to another document, and when it recurses too deep.
    return {
      unavailable: `The schema at ${url} cannot judge the credential: ${error instanceof Error ? error.message : "it failed"}.`,
    };
  }
}

/** Judges a credential with the schema at an address, which is fetched once for the call. */
async function judgeWith(url: string, raw: unknown, context: Context) {
  const cached = context.schemas.get(url) ?? loadSchema(url, context);
  context.schemas.set(url, cached);
  const loaded = await cached;
  return "reason" in loaded ? { unavailable: loaded.reason } : judge(loaded, raw, url);
}

/**
 * Checks that a credential conforms to the schema that it names (Open Badges 9.1): a `credentialSchema` of the type
 * `1EdTechJsonSchemaValidator2019` whose schema is one of 1EdTech's is what the readers already checked, and any other schema is
 * fetched once for the call and judges the credential as it was written.
 */
export async function checkSchema({ credential, raw }: Authentic, context: Context): Promise<VerificationCheck> {
  const named = (credential.credentialSchema ?? []).filter(({ type }) => type === SCHEMA_TYPE);
  if (named.length === 0) {
    return checkOf("schema", "skipped", `The credential names no credentialSchema of the type ${SCHEMA_TYPE}.`);
  }
  const others = named.filter(({ id }) => !OFFICIAL_SCHEMA_IDS.includes(id));
  if (others.length > MAX_SCHEMAS) {
    return checkOf(
      "schema",
      "unavailable",
      `The credential names ${others.length} schemas other than those of 1EdTech, more than the ${MAX_SCHEMAS} that a verifier fetches.`,
    );
  }
  const failures: string[] = [];
  const unavailable: string[] = [];
  for (const { id } of others) {
    const verdict = await judgeWith(id, raw, context);
    if (verdict === undefined) continue;
    if ("failed" in verdict) failures.push(verdict.failed);
    else unavailable.push(verdict.unavailable);
  }
  if (failures.length > 0) return checkOf("schema", "failed", failures.slice(0, MAX_LISTED).join(" "));
  if (unavailable.length > 0) return checkOf("schema", "unavailable", unavailable.slice(0, MAX_LISTED).join(" "));
  return checkOf(
    "schema",
    "passed",
    others.length === 0
      ? "The credential names a schema of 1EdTech, which the readers check."
      : "The credential conforms to the schemas that it names.",
  );
}
