import { DataError } from "@interopkit/core";
import { refusalOf } from "@interopkit/core/checks";
import type { CaseEntityKind, CaseEntityMap, CaseIssue } from "../model/index.js";
import { inspectEntity, issueSink } from "./inspect.js";
import { type ReadOptions, readKind, readSettings } from "./options.js";

/**
 * Reads an entity that CASE exchanges outside a package, of the class that the caller asks for, into the model of 1.1.
 *
 * @remarks
 * The checks are those of `readPackage` for one entity: every property against the schemas of 1EdTech, then the
 * identifiers that the entity holds. Links to other objects are not followed, because the entity has nothing to follow them
 * in. The result is a copy that shares nothing with the input. An entity with an error is not returned, and warnings are
 * not reported: `validateEntity` lists the findings. The check stops after `maxFindings` errors, and the error says that there
 * may be more.
 *
 * @param kind - The class of the entity: a document, an item, an association, a definition, a set or a status.
 * @param value - The entity, such as the parsed text of a response.
 * @param options - Which version the value is in, and the most errors to count.
 * @returns The entity, typed as the class of the kind.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, when the
 * kind is not one of `ENTITY_KINDS`, or when the options are not an object with a `version` of `"1.0"` or `"1.1"`.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1}
 */
export function readEntity<TKind extends CaseEntityKind>(
  kind: TKind,
  value: unknown,
  options?: ReadOptions,
): CaseEntityMap[TKind] {
  const checkedKind = readKind(kind);
  const { version, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, true);
  const entity = inspectEntity(checkedKind, value, version, sink);
  const errors = sink.list();
  if (entity === undefined || errors.length > 0)
    throw new DataError(refusalOf(`The ${checkedKind}`, errors, "validateEntity"));
  // The schema of the kind has just read the value, so it is the entity of that kind.
  return entity as CaseEntityMap[TKind];
}

/**
 * Judges an entity of a class: lists what is wrong with it, or departs from the specification, for either version.
 *
 * @param kind - The class of the entity.
 * @param value - The entity: parsed text, or an entity in the model.
 * @param options - Which version the value is in, and the most findings to list.
 * @returns The findings, errors and warnings, at most `maxFindings` of them and a last one with the rule `findings-stopped`
 * when the check stopped there. An empty list means that the entity is sound.
 * @throws `DataError` when the kind is not one of `ENTITY_KINDS`, or the options are not an object with a `version` of
 * `"1.0"` or `"1.1"` and a `maxFindings` that is a positive integer.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1}
 */
export function validateEntity(kind: CaseEntityKind, value: unknown, options?: ReadOptions): readonly CaseIssue[] {
  const checkedKind = readKind(kind);
  const { version, maxFindings } = readSettings(options);
  const sink = issueSink(maxFindings, false);
  inspectEntity(checkedKind, value, version, sink);
  return sink.list();
}
