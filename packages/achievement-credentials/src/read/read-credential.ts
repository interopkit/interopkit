import { DataError } from "@interopkit/core";
import { type FindingSink, refusalOf } from "@interopkit/core/checks";
import type { AnyCredential, AnyVerifiableCredential, CredentialIssue, CredentialKind } from "../model/index.js";
import { inspectCredential, issueSink } from "./inspect.js";
import {
  DOCUMENT_PLACES,
  inspectBadgeAssertionV2,
  inspectBadgeV2,
  isBadgeAssertionV2,
  isDocumentV2,
} from "./inspect-v2.js";
import { type ReadOptions, readSettings } from "./options.js";

/**
 * Reads a credential of any kind: an Open Badges 2.0 assertion when the value is a document under the context of Open Badges
 * 2.0 or a `BadgeAssertionV2` and no kind is asked for, else a credential of Open Badges 3.0 or CLR 2.0.
 */
function inspectAny(
  value: unknown,
  kind: CredentialKind | undefined,
  sink: FindingSink<CredentialIssue>,
): AnyCredential | undefined {
  if (kind === undefined && isDocumentV2(value)) return inspectBadgeV2(value, {}, DOCUMENT_PLACES, sink);
  if (kind === undefined && isBadgeAssertionV2(value)) return inspectBadgeAssertionV2(value, sink);
  return inspectCredential(value, kind, sink);
}

/**
 * Reads a credential into the model: a credential of Open Badges 3.0 or CLR 2.0 under either Verifiable Credentials data
 * model, or an Open Badges 2.0 assertion with its BadgeClass and issuer. Checks every property against the schemas of 1EdTech
 * or the vocabulary of Open Badges 2.0, then the rules of the specification, and returns a copy.
 *
 * @remarks
 * The result is the data model and not the text that was read. A list that the compacted form of JSON-LD writes as its only
 * member (`evidence`, `proof`, `type`) is a list in the result, so a credential that is read and written again has the same
 * meaning and may differ in bytes: read the original text, not the result, to check a signature. The result shares nothing
 * with the input. A value with an error is not returned, and warnings are not reported: `validateCredential` lists the
 * findings. The value is JSON that nests at most 64 levels. The check stops after `maxFindings` errors, and the error says that
 * there may be more.
 *
 * Without the option `kind`, a value whose only context is that of Open Badges 2.0 is read as a 2.0 assertion that embeds its
 * BadgeClass, which embeds the profile of its issuer, and a value with the `version` `2.0` and no context as a
 * `BadgeAssertionV2`. Any other value is a credential of Open Badges 3.0 or CLR 2.0, whose first context says which data model
 * it is under.
 *
 * @param value - The credential, such as the parsed text of a response.
 * @param options - Which kind of credential the value must be, and the most errors to count.
 * @returns The credential.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, or when the
 * options are not an object with a `kind` of `CREDENTIAL_KINDS` and a `maxFindings` that is a positive integer.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/ | CLR 2.0}
 * @see {@link https://www.imsglobal.org/sites/default/files/Badges/OBv2p0Final/index.html | Open Badges 2.0}
 */
export function readCredential(
  value: unknown,
  options: ReadOptions & { readonly kind: CredentialKind },
): AnyVerifiableCredential;
export function readCredential(value: unknown, options?: ReadOptions): AnyCredential;
export function readCredential(value: unknown, options?: ReadOptions): AnyCredential {
  const { kind, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, true);
  const credential = inspectAny(value, kind, sink);
  const errors = sink.list();
  if (credential === undefined || errors.length > 0) {
    throw new DataError(refusalOf("The credential", errors, "validateCredential"));
  }
  return credential;
}

/**
 * Judges a credential: lists what is wrong with it, or departs from the specification, for a credential of Open Badges 3.0 or
 * CLR 2.0 under either Verifiable Credentials data model, or an Open Badges 2.0 assertion.
 *
 * @remarks
 * The findings are those that `readCredential` bases its refusal on, the warnings among them, and the kind of value is told
 * the same way. A value that is not a credential gives findings and does not throw.
 *
 * @param value - The credential: parsed text, or a credential in the model.
 * @param options - Which kind of credential the value must be.
 * @returns Every finding: an error such as a missing property or a subject that nothing identifies, or a warning such as an
 * identity hash in no form that the specification names. An empty list means that the credential is sound.
 * @throws `DataError` when the options are not an object with a `kind` of `CREDENTIAL_KINDS`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/ | CLR 2.0}
 * @see {@link https://www.imsglobal.org/sites/default/files/Badges/OBv2p0Final/index.html | Open Badges 2.0}
 */
export function validateCredential(value: unknown, options?: ReadOptions): readonly CredentialIssue[] {
  const { kind, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, false);
  inspectAny(value, kind, sink);
  return sink.list();
}
