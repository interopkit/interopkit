import {
  finiteSchema,
  httpsUrlSchema,
  issueText,
  mapSchema,
  nonEmptyStringSchema,
  positiveSchema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { LtiError } from "../../errors.js";

/** The claims of a token: a JSON object. */
export type Claims = Readonly<Record<string, unknown>>;

/** The most characters of an identifier of a deployment, a resource link or a user (LTI 1.3 Core sections 5.3.3 and 5.3.5, section 5.3.6). */
export const MAX_IDENTIFIER_LENGTH = 255;

/** A string. */
export const STRING = v.string();

/** A non-empty string, such as a `jti`. */
export const NON_EMPTY_STRING = nonEmptyStringSchema;

/** A non-empty string of at most 255 characters, such as a `deployment_id` or a `sub`. */
export const IDENTIFIER = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_IDENTIFIER_LENGTH));

/** A finite number, such as `exp`. */
export const NUMBER = finiteSchema;

/** A finite number above 0, such as a maximum score. */
export const POSITIVE_NUMBER = positiveSchema;

/** A boolean. */
export const BOOLEAN = v.boolean();

/** An absolute `https` URL: LTI requires HTTPS for every URL of a message (LTI 1.3 Core section 3.5). */
export const HTTPS_URL = httpsUrlSchema;

/** An array of strings. */
export const STRING_ARRAY = v.array(v.string());

/** An object whose values are strings. */
export const STRING_RECORD = mapSchema(v.string());

/**
 * A string that a platform may send as `null`, which is read as absent: Canvas sends `"title": null` and `"description": null`
 * for a resource link, though LTI 1.3 Core section 5.3.5 has them as strings.
 */
export const NULLABLE_STRING = v.pipe(
  v.nullish(v.string()),
  v.transform((text) => text ?? undefined),
);

/**
 * A number of the `custom` claim that has a text of its own: a finite number, and a whole number only when it is a safe integer.
 * JSON parsing has already rounded a larger number (`9007199254740993` reads as `9007199254740992`) and turns `1e400` into
 * `Infinity`, so their text would not be the value that the platform sent.
 */
const CUSTOM_NUMBER = v.pipe(
  v.number(),
  v.check(
    (item) => Number.isFinite(item) && (!Number.isInteger(item) || Number.isSafeInteger(item)),
    (issue) => `expected a finite number, and a whole number of at most 2^53 - 1, found ${issue.received}`,
  ),
);

/**
 * The `custom` claim: an object of strings (LTI 1.3 Core section 5.4.6: a custom value is always a string). A platform that
 * sends a number or a boolean, as Canvas does for `canvas_user_uuid`, has it read as its text, when the number is one that
 * keeps its value as text.
 */
export const CUSTOM_RECORD = mapSchema(
  v.pipe(
    v.union([v.string(), CUSTOM_NUMBER, v.boolean()]),
    v.transform((item) => String(item)),
  ),
);

/** The failure of a claim: `claim-missing` when it is absent, else `claim-invalid`. */
function invalid(owner: string, name: string, issue: v.BaseIssue<unknown>): LtiError {
  return new LtiError(
    `${owner} is invalid at ${JSON.stringify(name)}: ${issueText(issue)}.`,
    issue.received === "undefined" ? "claim-missing" : "claim-invalid",
  );
}

/**
 * Reads a property that must be present.
 *
 * @param owner - Names the object in the error message, such as `The id_token`.
 * @param schema - What the value must be.
 * @throws `LtiError` (`claim-missing`) when it is absent and (`claim-invalid`) when it has another shape.
 */
export function required<TSchema extends v.GenericSchema>(
  source: Claims,
  name: string,
  owner: string,
  schema: TSchema,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, source[name], { abortEarly: true });
  if (!result.success) throw invalid(owner, name, result.issues[0]);
  return result.output;
}

/**
 * Reads several properties of the object at once, which a schema of that object describes.
 *
 * @param owner - Names the object in the error message, such as `The id_token`.
 * @param schema - What the object must be.
 * @throws `LtiError` (`claim-missing`) when a required property is absent and (`claim-invalid`) when one has another shape.
 */
export function requiredFrom<TSchema extends v.GenericSchema>(
  source: Claims,
  owner: string,
  schema: TSchema,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, source, { abortEarly: true });
  if (!result.success) {
    const [issue] = result.issues;
    throw invalid(owner, String(issue.path?.[0]?.key ?? ""), issue);
  }
  return result.output;
}

/**
 * Reads a property that may be absent.
 *
 * @param owner - Names the object in the error message, such as `The id_token`.
 * @param schema - What the value must be, when it is there.
 * @throws `LtiError` (`claim-invalid`) when it is present with another shape.
 */
export function optional<TSchema extends v.GenericSchema>(
  source: Claims,
  name: string,
  owner: string,
  schema: TSchema,
): v.InferOutput<TSchema> | undefined {
  return source[name] === undefined ? undefined : required(source, name, owner, schema);
}
