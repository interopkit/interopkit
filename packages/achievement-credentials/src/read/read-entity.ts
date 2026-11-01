import { DataError } from "@interopkit/core";
import type { CredentialIssue, Entity, EntityKind } from "../model/index.js";
import { errorsOf, inspectEntity, refusal } from "./inspect.js";
import { readEntityKind } from "./options.js";

/**
 * Reads an object that is not a credential, of the class that the caller asks for, into the model: an achievement, a profile,
 * the answer of an API, the status of an answer, a service description, or a key.
 *
 * @remarks
 * The checks are those of `readCredential` for one object. The result is a copy that shares nothing with the input, and a
 * list that the compacted form of JSON-LD writes as its only member is a list in it. An object with an error is not returned,
 * and warnings are not reported: `validateEntity` lists every finding.
 *
 * @param kind - The class of the object.
 * @param value - The object, such as the parsed text of a response.
 * @returns The object.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, or when the
 * kind is not one of `ENTITY_KINDS`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 */
export function readEntity(kind: EntityKind, value: unknown): Entity {
  const checkedKind = readEntityKind(kind);
  const { value: entity, issues } = inspectEntity(checkedKind, value);
  const errors = errorsOf(issues);
  if (entity === undefined || errors.length > 0) {
    throw new DataError(refusal(`The ${checkedKind}`, errors, "validateEntity"));
  }
  return entity;
}

/**
 * Judges an object that is not a credential: lists what is wrong with it, or departs from the specification.
 *
 * @param kind - The class of the object.
 * @param value - The object: parsed text, or an object in the model.
 * @returns Every finding, errors and warnings. An empty list means that the object is sound.
 * @throws `DataError` when the kind is not one of `ENTITY_KINDS`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 */
export function validateEntity(kind: EntityKind, value: unknown): readonly CredentialIssue[] {
  return inspectEntity(readEntityKind(kind), value).issues;
}
