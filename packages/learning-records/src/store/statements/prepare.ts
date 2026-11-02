import { callPort, DataError, readClock } from "@interopkit/core";
import { isUuid, refusalOf } from "@interopkit/core/checks";
import { type AttachmentData, formatTimestamp, type Statement, type StatementIssue } from "../../model/index.js";
import { mediaTypeOf, STATEMENT_VERSIONS, VERSION_PATTERNS } from "../../model/internal.js";
import { attachmentHeadersOf, inspectBatch, issueSink } from "../../read/internal.js";
import { SIGNATURE_USAGE_TYPE, verifyStatementSignature } from "../../signing/index.js";
import { type Context, isRefusal, type Refusal, refused, type Verdict } from "../verdict.js";
import type { StatementsBody } from "./body.js";
import { inUtcTimestamps } from "./timestamps.js";

/** A Statement that has its id. */
type IdentifiedStatement = Statement & { readonly id: string };

/** The Statements of a request as the LRS stores them, and the data of their Attachments. */
export interface Prepared {
  /** The Statements, each with its `id`, `stored`, `timestamp`, `authority` and `version`. */
  readonly statements: readonly IdentifiedStatement[];
  /** The time the Statements were stored. */
  readonly stored: string;
  /** The data of the Attachments that the Statements name, with the type that the header of each gives. */
  readonly attachments: readonly AttachmentData[];
}

/**
 * Tells whether the route of 2.0 takes a version of a Statement: 2.0 and 2.0.x, and 1.0 and 1.0.x, which are the Statements of
 * xAPI 1.0.3. The rules of 1.0.3 take 1.0 and 1.0.x alone, and refuse the others with the path of the Statement.
 */
function isTakenVersion(version: string): boolean {
  return Object.values(VERSION_PATTERNS).some((pattern) => pattern.test(version));
}

/** The messages about a signature that is not good, by the reason that `verifyStatementSignature` gives. */
const SIGNATURE_PROBLEMS = {
  malformed: "is not a compact JWS whose payload is a Statement",
  algorithm: "does not use RS256, RS384 or RS512, or its key is too short or made for another hash",
  signature: "does not verify against the certificate in its header",
  "not-equivalent": "signs another Statement than the one received",
} as const;

/** Gives a Statement what the LRS sets (4.2.4.2). */
function completed(statement: Statement, stored: string, context: Context): IdentifiedStatement {
  const id = statement.id ?? context.settings.newId();
  if (!isUuid(id)) {
    throw new DataError(`The option newId must make a UUID, found ${JSON.stringify(id)}.`);
  }
  const { authority } = context.access;
  return {
    ...statement,
    id: id.toLowerCase(),
    stored,
    timestamp: statement.timestamp ?? stored,
    authority:
      context.settings.keepSubmittedAuthority && statement.authority !== undefined ? statement.authority : authority,
    version: statement.version ?? STATEMENT_VERSIONS[context.version],
  };
}

/**
 * Matches the Attachments of the Statements with the data that came with them (4.1.3): an Attachment without a `fileUrl` needs
 * its part, and a part that no Attachment names is refused. The `length` of an Attachment is not compared to its part: the hash
 * is what binds the data to the Attachment, and the standard asks the LRS to reject only an Attachment that has neither a
 * `fileUrl` nor a part with its hash.
 */
function matchAttachments(
  statements: readonly Statement[],
  parts: ReadonlyMap<string, AttachmentData>,
): Verdict<readonly AttachmentData[]> {
  const matched = new Map<string, AttachmentData>();
  for (const header of statements.flatMap(attachmentHeadersOf)) {
    const hash = header.sha2.toLowerCase();
    const data = parts.get(hash);
    if (data === undefined) {
      if (header.fileUrl === undefined) {
        return refused(400, `The Attachment with the hash ${hash} has no fileUrl, and no part holds its data.`);
      }
      continue;
    }
    if (!matched.has(hash)) matched.set(hash, { sha2: hash, contentType: header.contentType, body: data.body });
  }
  for (const hash of parts.keys()) {
    if (!matched.has(hash)) {
      return refused(400, `The part with the hash ${hash} belongs to no Attachment of the Statements.`);
    }
  }
  return { value: [...matched.values()] };
}

/** Judges one signature of a Statement, and says why it is refused, if it is. */
async function refusalOfSignature(
  statement: Statement,
  signature: Uint8Array,
  context: Context,
): Promise<Refusal | undefined> {
  const { signal, trustCertificate } = context.settings;
  const checked = await callPort(
    () =>
      verifyStatementSignature(statement, signature, {
        version: context.version,
        ...(trustCertificate === undefined ? {} : { trustCertificate }),
        ...(signal === undefined ? {} : { signal }),
      }),
    signal,
  );
  if (checked === undefined) return refused(500, "The LRS could not check the signature.");
  if (checked.value.valid) {
    // A signature that verifies here verified against its chain, since the LRS passes no key.
    if (trustCertificate === undefined || checked.value.certified) return undefined;
    return refused(400, `The certificate of the signature of the Statement ${statement.id} is not trusted.`);
  }
  // Without a certificate in the header the LRS has no key, and the signature is well formed all the same.
  if (checked.value.reason === "no-key") return undefined;
  return refused(400, `The signature of the Statement ${statement.id} ${SIGNATURE_PROBLEMS[checked.value.reason]}.`);
}

/** Checks the signature of a Statement that has one (4.2.6): it must be well formed, and it must verify when the key is known. */
async function checkSignature(
  statement: Statement,
  parts: ReadonlyMap<string, AttachmentData>,
  context: Context,
): Promise<Verdict<undefined>> {
  for (const header of statement.attachments ?? []) {
    if (header.usageType !== SIGNATURE_USAGE_TYPE) continue;
    const data = parts.get(header.sha2.toLowerCase());
    if (mediaTypeOf(header.contentType) !== "application/octet-stream" || data === undefined) {
      return refused(
        400,
        "The signature of a Statement is an Attachment of the type application/octet-stream whose data come with the request.",
      );
    }
    const refusal = await refusalOfSignature(statement, data.body, context);
    if (refusal !== undefined) return refusal;
  }
  return { value: undefined };
}

/** Runs the check of the host on the Statements. */
async function acceptable(statements: readonly Statement[], context: Context): Promise<Verdict<undefined>> {
  const { accept, signal } = context.settings;
  if (accept === undefined) return { value: undefined };
  const asked = await callPort(
    () => accept(statements, context.access, signal === undefined ? undefined : { signal }),
    signal,
  );
  if (asked === undefined) return refused(500, "The LRS could not check the Statements.");
  const errors = asked.value.filter((issue: StatementIssue) => issue.severity === "error");
  return errors.length === 0
    ? { value: undefined }
    : refused(400, refusalOf("The batch of Statements", errors, "accept"));
}

/** Refuses a Statement of a version that the LRS does not take, and a Statement whose id is not the `statementId` of a PUT. */
function checkIdentity(read: readonly Statement[], single: { readonly id: string } | undefined): Refusal | undefined {
  for (const [index, statement] of read.entries()) {
    if (statement.version !== undefined && !isTakenVersion(statement.version)) {
      return refused(
        400,
        `The version of the Statement at [${index}], ${JSON.stringify(statement.version)}, is not one that the LRS takes: write 2.0.x, or 1.0.x for a Statement of xAPI 1.0.`,
      );
    }
  }
  const only = read[0];
  if (single !== undefined && only?.id !== undefined && only.id.toLowerCase() !== single.id) {
    return refused(400, `The id of the Statement, ${only.id}, is not the statementId of the request, ${single.id}.`);
  }
  return undefined;
}

/**
 * Reads the Statements of a request, completes them, and checks their Attachments and signatures: everything that can refuse
 * the request before the store is called.
 */
export async function prepare(
  context: Context,
  body: StatementsBody,
  single: { readonly id: string } | undefined,
): Promise<Verdict<Prepared>> {
  const submitted = Array.isArray(body.json) ? body.json : [body.json];
  const { maxBatch, maxFindings } = context.settings.limits;
  if (single !== undefined && Array.isArray(body.json)) {
    return refused(400, "A PUT stores one Statement, and the body is a list.");
  }
  if (submitted.length > maxBatch) {
    return refused(
      413,
      `The request has ${submitted.length} Statements, above the limit of ${maxBatch} for one request.`,
    );
  }
  const converted = inUtcTimestamps(submitted, context.version);
  if (isRefusal(converted)) return converted;
  const list = converted.value;
  const sink = issueSink(maxFindings, true);
  const read = inspectBatch(list, { role: "lrs", version: context.version }, sink);
  const errors = sink.list();
  if (errors.length > 0) return refused(400, refusalOf("The batch of Statements", errors, "validateStatements"));
  const refusal = checkIdentity(read, single);
  if (refusal !== undefined) return refusal;
  const stored = formatTimestamp(readClock(context.settings.clock));
  const statements = read.map((statement, index) =>
    completed(index === 0 && single !== undefined ? { ...statement, id: single.id } : statement, stored, context),
  );
  const attachments = matchAttachments(statements, body.parts);
  if (isRefusal(attachments)) return attachments;
  for (const statement of statements) {
    const signed = await checkSignature(statement, body.parts, context);
    if (isRefusal(signed)) return signed;
  }
  const accepted = await acceptable(statements, context);
  if (isRefusal(accepted)) return accepted;
  return { value: { statements, stored, attachments: attachments.value } };
}
