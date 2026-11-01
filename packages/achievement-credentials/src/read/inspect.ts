import {
  copyJson,
  createFindingSink,
  type FindingSink,
  findingsOf,
  isRecord,
  type Schema,
  safeParseBounded,
} from "@interopkit/core/checks";
import type * as v from "valibot";
import {
  type AnyCredential,
  CONTEXTS,
  type CredentialIssue,
  type CredentialKind,
  type Entity,
  type EntityKind,
} from "../model/index.js";
import { CREDENTIAL_SCHEMAS, ENTITY_SCHEMAS } from "./registry.js";
import { subjectIssues } from "./rules.js";

/**
 * Makes the list of findings of a call that stops at a limit. A reader keeps the errors alone, because it does not report
 * warnings, and a warning does not count toward the limit.
 */
export function issueSink(maxFindings: number, errorsOnly: boolean): FindingSink<CredentialIssue> {
  return createFindingSink(
    maxFindings,
    (finding) => ({ ...finding, severity: "error" }),
    errorsOnly ? ({ severity }) => severity === "error" : undefined,
  );
}

/** The classes whose name in `type` says what kind of credential a value is, strongest first. */
const KIND_TYPES: readonly (readonly [CredentialKind, readonly string[]])[] = [
  ["ClrCredential", ["ClrCredential"]],
  ["EndorsementCredential", ["EndorsementCredential"]],
  ["AchievementCredential", ["AchievementCredential", "OpenBadgeCredential"]],
];

/** Reads the kind of credential that the `type` of a value names; a value that names none is a `VerifiableCredential`. */
function detectKind(value: unknown): CredentialKind {
  const type = isRecord(value) ? value.type : undefined;
  const names = Array.isArray(type) ? type : [type];
  return KIND_TYPES.find(([, classes]) => classes.some((name) => names.includes(name)))?.[0] ?? "VerifiableCredential";
}

/** Tells whether the first context of a value is that of the Verifiable Credentials Data Model 1.1. */
function isV1p1(value: unknown): boolean {
  const context = isRecord(value) ? value["@context"] : undefined;
  return Array.isArray(context) && context[0] === CONTEXTS.credentialsV1;
}

/** Turns the issues of a parse into findings that are all errors. */
function toIssues(issues: readonly v.BaseIssue<unknown>[]): CredentialIssue[] {
  return findingsOf(issues).map((finding) => ({ ...finding, severity: "error" }));
}

/**
 * Copies a value that must be JSON, which also limits how deep it nests, and parses the copy with a schema into a sink of
 * findings. The depth limit is what keeps a hostile chain of `parentOrg` or `endorsement` from exhausting the stack.
 *
 * @returns The value as the schema reads it when its shape is right.
 */
export function parseJson<TOutput>(
  schema: Schema<TOutput>,
  value: unknown,
  sink: FindingSink<CredentialIssue>,
): TOutput | undefined {
  const copy = copyJson(value, "");
  if ("problem" in copy) {
    sink.add([{ path: "", rule: "invalid-value", message: `${copy.problem}.`, severity: "error" }]);
    return undefined;
  }
  const result = safeParseBounded(schema, copy.value, sink.room);
  if (result.success) return result.output;
  sink.add(toIssues(result.issues));
  return undefined;
}

/** Reads a credential of a kind, or of the kind that its `type` names, and judges its subject when its shape is right. */
export function inspectCredential(
  value: unknown,
  kind: CredentialKind | undefined,
  sink: FindingSink<CredentialIssue>,
): AnyCredential | undefined {
  const schemas = CREDENTIAL_SCHEMAS[kind ?? detectKind(value)];
  const schema: Schema<AnyCredential> = isV1p1(value) ? schemas.v1p1 : schemas.v2;
  const credential = parseJson(schema, value, sink);
  if (credential !== undefined) sink.add(ruleIssues(credential));
  return credential;
}

/** Reads an object of a class, and judges it when its shape is right. */
export function inspectEntity(
  kind: EntityKind,
  value: unknown,
  sink: FindingSink<CredentialIssue>,
): Entity | undefined {
  const entity = parseJson(ENTITY_SCHEMAS[kind], value, sink);
  if (entity !== undefined) sink.add(ruleIssues(entity));
  return entity;
}

/** Judges the subject of a credential, or the subject of a CLR in a JWT, that the specification wants identified. */
export function ruleIssues(value: AnyCredential | Entity): CredentialIssue[] {
  if ("verifiableCredential" in value) return subjectIssues(value, "");
  if (!("credentialSubject" in value)) return [];
  const subject = value.credentialSubject;
  return "achievement" in subject || "verifiableCredential" in subject
    ? subjectIssues(subject, "credentialSubject")
    : [];
}
