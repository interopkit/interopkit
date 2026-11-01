import { callPort, DataError } from "@interopkit/core";
import { isUuid, refusalOf } from "@interopkit/core/checks";
import {
  type Attachment,
  type AttachmentData,
  formatTimestamp,
  type Statement,
  type StatementIssue,
} from "../../model/index.js";
import { mediaTypeOf } from "../../model/internal.js";
import { readStatement, validateStatements } from "../../read/index.js";
import { SIGNATURE_USAGE_TYPE, verifyStatementSignature } from "../../signing/index.js";
import { type Context, isRefusal, refused, type Verdict } from "../verdict.js";
import type { StatementsBody } from "./body.js";

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

/** The version a Statement gets when it brings none (4.2.4.3). */
const DEFAULT_VERSION = "2.0.0";

/** The messages about a signature that is not good, by the reason that `verifyStatementSignature` gives. */
const SIGNATURE_PROBLEMS = {
  malformed: "is not a compact JWS whose payload is a Statement",
  algorithm: "does not use RS256, RS384 or RS512, or its key is too short or made for another hash",
  signature: "does not verify against the certificate in its header",
  "not-equivalent": "signs another Statement than the one received",
} as const;

/** Lists the headers of the Attachments of a Statement and of the SubStatement that is its Object. */
function attachmentsOf(statement: Statement): readonly Attachment[] {
  const inner = statement.object.objectType === "SubStatement" ? (statement.object.attachments ?? []) : [];
  return [...(statement.attachments ?? []), ...inner];
}

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
    version: statement.version ?? DEFAULT_VERSION,
  };
}

/** Matches the Attachments of the Statements with the data that came with them (4.1.3). */
function matchAttachments(
  statements: readonly Statement[],
  parts: ReadonlyMap<string, AttachmentData>,
): Verdict<readonly AttachmentData[]> {
  const matched = new Map<string, AttachmentData>();
  for (const header of statements.flatMap(attachmentsOf)) {
    const hash = header.sha2.toLowerCase();
    const data = parts.get(hash);
    if (data === undefined) {
      if (header.fileUrl === undefined) {
        return refused(400, `The Attachment with the hash ${hash} has no fileUrl, and no part holds its data.`);
      }
      continue;
    }
    if (header.length !== data.body.byteLength) {
      return refused(
        400,
        `The Attachment with the hash ${hash} declares ${header.length} bytes, and its part holds ${data.body.byteLength}.`,
      );
    }
    if (!matched.has(hash)) matched.set(hash, { sha2: hash, contentType: header.contentType, body: data.body });
  }
  return { value: [...matched.values()] };
}

/** Checks the signature of a Statement that has one (4.2.6): it must be well formed, and it must verify when the key is known. */
async function checkSignature(
  statement: Statement,
  parts: ReadonlyMap<string, AttachmentData>,
  context: Context,
): Promise<Verdict<undefined>> {
  const { signal, trustCertificate } = context.settings;
  for (const header of statement.attachments ?? []) {
    if (header.usageType !== SIGNATURE_USAGE_TYPE) continue;
    const data = parts.get(header.sha2.toLowerCase());
    if (mediaTypeOf(header.contentType) !== "application/octet-stream" || data === undefined) {
      return refused(
        400,
        "The signature of a Statement is an Attachment of the type application/octet-stream whose data come with the request.",
      );
    }
    const checked = await callPort(
      () =>
        verifyStatementSignature(statement, data.body, {
          ...(trustCertificate === undefined ? {} : { trustCertificate }),
          ...(signal === undefined ? {} : { signal }),
        }),
      signal,
    );
    if (checked === undefined) return refused(500, "The LRS could not check the signature.");
    // Without a certificate in the header and a key the LRS has no key, and the signature is well formed all the same.
    if (checked.value.valid || checked.value.reason === "no-key") continue;
    return refused(400, `The signature of the Statement ${statement.id} ${SIGNATURE_PROBLEMS[checked.value.reason]}.`);
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

/**
 * Reads the Statements of a request, completes them, and checks their Attachments and signatures: everything that can refuse
 * the request before the store is called.
 */
export async function prepare(
  context: Context,
  body: StatementsBody,
  single: { readonly id: string } | undefined,
): Promise<Verdict<Prepared>> {
  const list = Array.isArray(body.json) ? body.json : [body.json];
  const { maxBatch } = context.settings.limits;
  if (single !== undefined && Array.isArray(body.json)) {
    return refused(400, "A PUT stores one Statement, and the body is a list.");
  }
  if (list.length > maxBatch) {
    return refused(413, `The request has ${list.length} Statements, above the limit of ${maxBatch} for one request.`);
  }
  const errors = validateStatements(list).filter(({ severity }) => severity === "error");
  if (errors.length > 0) return refused(400, refusalOf("The batch of Statements", errors, "validateStatements"));
  const read = list.map((entry) => readStatement(entry));
  if (single !== undefined) {
    const [only] = read;
    if (only?.id !== undefined && only.id.toLowerCase() !== single.id) {
      return refused(400, `The id of the Statement, ${only.id}, is not the statementId of the request, ${single.id}.`);
    }
  }
  const stored = formatTimestamp(context.settings.clock.now());
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
