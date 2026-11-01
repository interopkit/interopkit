import { DataError } from "@interopkit/core";
import type { AnyCredential, CredentialIssue } from "../model/index.js";
import { errorsOf, inspectCredential, refusal } from "./inspect.js";
import { type ReadOptions, readKind } from "./options.js";

/**
 * Reads a credential of Open Badges 3.0 or CLR 2.0, under either Verifiable Credentials data model, into the model: checks
 * every property against the schemas of 1EdTech, then the subject, and returns a copy.
 *
 * @remarks
 * The result is the data model and not the text that was read. A list that the compacted form of JSON-LD writes as its only
 * member (`evidence`, `proof`, `type`) is a list in the result, so a credential that is read and written again has the same
 * meaning and may differ in bytes: read the original text, not the result, to check a signature. The result shares nothing
 * with the input. A value with an error is not returned, and warnings are not reported: `validateCredential` lists every
 * finding. The value is JSON that nests at most 64 levels. The first context says which data model it is under.
 *
 * @param value - The credential, such as the parsed text of a response.
 * @param options - Which kind of credential the value must be.
 * @returns The credential.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, or when the
 * options are not an object with a `kind` of `CREDENTIAL_KINDS`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/ | CLR 2.0}
 */
export function readCredential(value: unknown, options?: ReadOptions): AnyCredential {
  const { value: credential, issues } = inspectCredential(value, readKind(options));
  const errors = errorsOf(issues);
  if (credential === undefined || errors.length > 0) {
    throw new DataError(refusal("The credential", errors, "validateCredential"));
  }
  return credential;
}

/**
 * Judges a credential of Open Badges 3.0 or CLR 2.0: lists what is wrong with it, or departs from the specification, under
 * either Verifiable Credentials data model.
 *
 * @remarks
 * The findings are those that `readCredential` bases its refusal on, the warnings among them. A value that is not a
 * credential gives findings and does not throw.
 *
 * @param value - The credential: parsed text, or a credential in the model.
 * @param options - Which kind of credential the value must be.
 * @returns Every finding: an error such as a missing property or a subject that nothing identifies, or a warning such as an
 * identity hash in no form that the specification names. An empty list means that the credential is sound.
 * @throws `DataError` when the options are not an object with a `kind` of `CREDENTIAL_KINDS`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/ | CLR 2.0}
 */
export function validateCredential(value: unknown, options?: ReadOptions): readonly CredentialIssue[] {
  return inspectCredential(value, readKind(options)).issues;
}
