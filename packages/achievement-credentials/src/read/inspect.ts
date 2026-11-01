import { copyJson, findingsOf, isRecord, type Schema } from "@interopkit/core/checks";
import * as v from "valibot";
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

/** What reading a value found: the value as the model has it when its shape is right, and every finding. */
export interface Inspection<TValue> {
  /** The value, a copy that shares nothing with the input. It is there when the shape is right, whatever else is found. */
  readonly value?: TValue;
  /** Every finding, errors and warnings. */
  readonly issues: readonly CredentialIssue[];
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
 * Copies a value that must be JSON, which also limits how deep it nests, and parses the copy with a schema. The depth limit
 * is what keeps a hostile chain of `parentOrg` or `endorsement` from exhausting the stack.
 */
function parseJson<TOutput>(schema: Schema<TOutput>, value: unknown): Inspection<TOutput> {
  const copy = copyJson(value, "");
  if ("problem" in copy)
    return { issues: [{ path: "", rule: "invalid-value", message: `${copy.problem}.`, severity: "error" }] };
  const result = v.safeParse(schema, copy.value);
  return result.success ? { value: result.output, issues: [] } : { issues: toIssues(result.issues) };
}

/** Reads a credential of a kind, or of the kind that its `type` names, and judges its subject when its shape is right. */
export function inspectCredential(value: unknown, kind?: CredentialKind): Inspection<AnyCredential> {
  const schemas = CREDENTIAL_SCHEMAS[kind ?? detectKind(value)];
  const schema: Schema<AnyCredential> = isV1p1(value) ? schemas.v1p1 : schemas.v2;
  const { value: credential, issues } = parseJson(schema, value);
  if (credential === undefined) return { issues };
  return { value: credential, issues: [...issues, ...credentialIssues(credential)] };
}

/** Reads an object of a class, and judges it when its shape is right. */
export function inspectEntity(kind: EntityKind, value: unknown): Inspection<Entity> {
  const { value: entity, issues } = parseJson(ENTITY_SCHEMAS[kind], value);
  if (entity === undefined) return { issues };
  return { value: entity, issues: [...issues, ...entityIssues(entity)] };
}

/** Judges the subject of a credential that has one the specification wants identified. */
function credentialIssues(credential: AnyCredential): CredentialIssue[] {
  const subject = credential.credentialSubject;
  return "achievement" in subject || "verifiableCredential" in subject
    ? subjectIssues(subject, "credentialSubject")
    : [];
}

/** Judges the objects that hold a subject. */
function entityIssues(entity: Entity): CredentialIssue[] {
  if ("verifiableCredential" in entity) return subjectIssues(entity, "");
  if ("credentialSubject" in entity) {
    return subjectIssues(entity.credentialSubject, "credentialSubject");
  }
  return [];
}

/** Returns the findings that are errors. */
export function errorsOf(issues: readonly CredentialIssue[]): readonly CredentialIssue[] {
  return issues.filter(({ severity }) => severity === "error");
}

/**
 * Writes the sentence of the `DataError` that a refused value gives: the first error with its path, and how many more
 * there are.
 *
 * @param label - Names the value, such as `The credential`.
 * @param errors - The errors, which are not empty when the shape is wrong.
 * @param validator - The function that lists every finding, such as `validateCredential`.
 */
export function refusal(label: string, errors: readonly CredentialIssue[], validator: string): string {
  const [first, ...others] = errors;
  const where = first === undefined || first.path === "" ? "" : ` at ${first.path}`;
  const count = others.length === 1 ? "1 more error" : `${others.length} more errors`;
  const more = others.length === 0 ? "" : ` ${count}: ${validator} lists every finding.`;
  return `${label} is invalid${where}: ${first?.message ?? "it has an error."}${more}`;
}
