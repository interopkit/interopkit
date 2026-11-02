import {
  copyJson,
  createFindingSink,
  DEFAULT_MAX_FINDINGS,
  type FindingSink,
  findingsOf,
  isRecord,
  refusalOf,
  type Schema,
  safeParseBounded,
} from "@interopkit/core/checks";
import type * as v from "valibot";
import {
  type AnyVerifiableCredential,
  type ClrCredentialJwtPayload,
  CONTEXTS,
  type CredentialIssue,
  type CredentialKind,
  type Entity,
  type EntityKind,
} from "../model/index.js";
import { clrCredentialJwtPayloadSchema } from "./clr-schemas.js";
import { CREDENTIAL_SCHEMAS, ENTITY_SCHEMAS } from "./registry.js";
import {
  criteriaIssues,
  emptySubjectIssues,
  periodIssues,
  relatedResourceIssues,
  resultIssues,
  subjectIssues,
} from "./rules.js";

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
  return parseInto(schema, copy.value, sink);
}

/**
 * Parses a value with a schema into a sink of findings, and stops once the sink is full.
 *
 * @returns The value as the schema reads it when its shape is right.
 */
export function parseInto<TOutput>(
  schema: Schema<TOutput>,
  value: unknown,
  sink: FindingSink<CredentialIssue>,
): TOutput | undefined {
  const result = safeParseBounded(schema, value, sink.room);
  if (result.success) return result.output;
  sink.add(toIssues(result.issues));
  return undefined;
}

/** Reads a credential of a kind, or of the kind that its `type` names, and judges its subject when its shape is right. */
export function inspectCredential(
  value: unknown,
  kind: CredentialKind | undefined,
  sink: FindingSink<CredentialIssue>,
): AnyVerifiableCredential | undefined {
  const schemas = CREDENTIAL_SCHEMAS[kind ?? detectKind(value)];
  const schema: Schema<AnyVerifiableCredential> = isV1p1(value) ? schemas.v1p1 : schemas.v2;
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

/**
 * Reads the payload of a CLR that is signed as a JWT, and judges it when its shape is right. Its nested credentials are
 * compact JWS, which CLR 7.2.4.1 asks for.
 */
function inspectClrPayload(value: unknown, sink: FindingSink<CredentialIssue>): ClrCredentialJwtPayload | undefined {
  const payload = parseJson(clrCredentialJwtPayloadSchema, value, sink);
  if (payload !== undefined) sink.add(ruleIssues(payload));
  return payload;
}

/**
 * Reads a value as a credential of the Data Model 2.0 or 1.1, or as the payload of a CLR in a JWT, for a function that signs or
 * verifies it, and says in a sentence what is wrong when it is not one.
 *
 * @param value - The value.
 * @param label - Names the value in the sentence, such as `The credential`.
 * @param payload - Whether the value is the payload of a CLR whose credentials are compact JWS.
 * @returns The credential, or the sentence that names the path of the first error and counts the others.
 */
export function credentialOrReason(
  value: unknown,
  label: string,
  payload = false,
): { readonly value: AnyVerifiableCredential } | { readonly reason: string } {
  const sink = issueSink(DEFAULT_MAX_FINDINGS, true);
  const credential = payload ? inspectClrPayload(value, sink) : inspectCredential(value, undefined, sink);
  const errors = sink.list();
  return credential === undefined || errors.length > 0
    ? { reason: refusalOf(label, errors, "validateCredential") }
    : { value: credential };
}

/**
 * Judges what the schemas leave to the specifications: the subject of a credential, or of a CLR in a JWT, which the specification
 * wants identified or to say something, the results and the criteria of its achievement, the validity period and the related
 * resources. An achievement on its own is judged for its criteria.
 */
export function* ruleIssues(value: AnyVerifiableCredential | Entity): Generator<CredentialIssue> {
  if ("verifiableCredential" in value) {
    yield* subjectIssues(value, "");
    return;
  }
  if ("criteria" in value) yield* criteriaIssues(value, "");
  if (!("credentialSubject" in value)) return;
  yield* periodIssues(value);
  const subject = value.credentialSubject;
  if ("achievement" in subject || "verifiableCredential" in subject) {
    yield* subjectIssues(subject, "credentialSubject");
    yield* resultIssues(subject, "credentialSubject");
    if ("achievement" in subject) yield* criteriaIssues(subject.achievement, "credentialSubject.achievement");
  } else {
    yield* emptySubjectIssues(subject);
  }
  yield* relatedResourceIssues(value);
}
