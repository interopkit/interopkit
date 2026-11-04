import { DataError } from "@interopkit/core";
import { describeRefusal, type Issue } from "@interopkit/core/checks";
import type { Entity, EntityByKind, EntityKind } from "../model/index.js";
import { inspectEntity, issueSink } from "./inspect.js";
import { type EntityReadOptions, readEntityKind, readEntityLimit } from "./options.js";

/**
 * Reads an object that is not a credential, of the class that the caller asks for, into the model: an achievement, a profile,
 * the answer of an API, the status of an answer, a service description, or a key.
 *
 * @remarks
 * The checks are those of `readCredential` for one object. The result is a copy that shares nothing with the input, and a
 * list that the compacted form of JSON-LD writes as its only member is a list in it. An object with an error is not returned,
 * and warnings are not reported: `validateEntity` lists the findings. The check stops after `maxFindings` errors, and the error
 * says that there may be more.
 *
 * @param kind - The class of the object.
 * @param value - The object, such as the parsed text of a response.
 * @param options - The most errors to count.
 * @returns The object.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, when the
 * kind is not one of `ENTITY_KINDS`, or when the options are not an object with a `maxFindings` that is a positive integer.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 */
export function readEntity<TKind extends EntityKind>(
  kind: TKind,
  value: unknown,
  options?: EntityReadOptions,
): EntityByKind[TKind];
export function readEntity(kind: EntityKind, value: unknown, options?: EntityReadOptions): Entity {
  const checkedKind = readEntityKind(kind);
  const sink = issueSink(readEntityLimit(options), true);
  const entity = inspectEntity(checkedKind, value, sink);
  const errors = sink.list();
  if (entity === undefined || errors.length > 0) {
    throw new DataError(describeRefusal(`The ${checkedKind}`, errors, "validateEntity"));
  }
  return entity;
}

/**
 * Judges an object that is not a credential: lists what is wrong with it, or departs from the specification.
 *
 * @param kind - The class of the object.
 * @param value - The object: parsed text, or an object in the model.
 * @param options - The most findings to list.
 * @returns The findings, errors and warnings, at most `maxFindings` of them and a last one with the rule `findings-stopped`
 * when the check stopped there. An empty list means that the object is sound.
 * @throws `DataError` when the kind is not one of `ENTITY_KINDS`, or when the options are not an object with a `maxFindings`
 * that is a positive integer.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/ | Open Badges 3.0}
 */
export function validateEntity(kind: EntityKind, value: unknown, options?: EntityReadOptions): readonly Issue[] {
  const checkedKind = readEntityKind(kind);
  const sink = issueSink(readEntityLimit(options), false);
  inspectEntity(checkedKind, value, sink);
  return sink.list();
}
