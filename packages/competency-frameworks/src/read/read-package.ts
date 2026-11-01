import { DataError } from "@interopkit/core";
import type { CaseIssue, CasePackage } from "../model/index.js";
import { errorsOf, inspectPackage, refusal } from "./inspect.js";
import { type ReadOptions, readVersion } from "./options.js";

/**
 * Reads a framework package of either version into the model of 1.1: checks every property against the schemas of 1EdTech,
 * then the identifiers, links and tree of the package, and returns a copy.
 *
 * @remarks
 * The result shares nothing with the input. A package of 1.0 is a package of 1.1 without what 1.1 adds, so reading it needs
 * no change of the data. A package with an error is not returned, and warnings are not reported: `validatePackage` lists
 * every finding, with its severity.
 *
 * @param value - The package, such as the parsed text of a response.
 * @param options - Which version the value is in.
 * @returns The package.
 * @throws `DataError` that names the path of the first error and counts the others, when the value has an error, or when the
 * options are not an object with a `version` of `"1.0"` or `"1.1"`.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1}
 */
export function readPackage(value: unknown, options?: ReadOptions): CasePackage {
  const { value: pkg, issues } = inspectPackage(value, readVersion(options));
  const errors = errorsOf(issues);
  if (pkg === undefined || errors.length > 0) throw new DataError(refusal("The package", errors, "validatePackage"));
  return pkg;
}

/**
 * Judges a framework package: lists what is wrong with it, or departs from the specification, for either version.
 *
 * @remarks
 * The findings are those that `readPackage` bases its refusal on, the warnings among them. A value that is not a package
 * gives findings and does not throw.
 *
 * @param value - The package: parsed text, or a package in the model.
 * @param options - Which version the value is in.
 * @returns Every finding: an error such as a missing property, an identifier that two entities share or a tree that loops,
 * or a warning such as a link that points to nothing in the package. An empty list means that the package is sound.
 * @throws `DataError` when the options are not an object with a `version` of `"1.0"` or `"1.1"`.
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1}
 */
export function validatePackage(value: unknown, options?: ReadOptions): readonly CaseIssue[] {
  return inspectPackage(value, readVersion(options)).issues;
}
