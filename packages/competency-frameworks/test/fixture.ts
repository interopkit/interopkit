import type { CaseIssue, CasePackage } from "../src/index.js";
import { id, uri } from "./full-package.js";

/** Returns a copy of JSON, which a test may change. */
export function copyOf<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

/** The smallest package of CASE 1.0: a document and nothing else. */
export function minimalPackage(): CasePackage {
  return {
    CFDocument: {
      identifier: id(1),
      uri: uri("CFDocuments", 1),
      creator: "Ministry of Education",
      title: "Mathematics",
      lastChangeDateTime: "2024-06-13T18:46:03+00:00",
    },
  };
}

/** Reduces findings to the parts that a test states: where, which rule and how serious. */
export function summary(issues: readonly CaseIssue[]): { path: string; rule: string; severity: string }[] {
  return issues.map(({ path, rule, severity }) => ({ path, rule, severity }));
}
