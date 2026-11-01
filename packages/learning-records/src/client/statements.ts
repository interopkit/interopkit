import { type CallOptions, DataError, type ServiceResponse } from "@interopkit/core";
import { parseWith, refusalOf, strictRecord, uuidSchema } from "@interopkit/core/checks";
import * as v from "valibot";
import { readMultipart, writeMultipart } from "../attachments/index.js";
import {
  type AttachmentData,
  STATEMENT_FORMATS,
  type Statement,
  type StatementFormat,
  type StatementQuery,
} from "../model/index.js";
import { mediaTypeOf } from "../model/internal.js";
import { readStatement, validateStatements } from "../read/index.js";
import { attachmentDataSchema } from "../read/internal.js";
import type { Settings } from "./config.js";
import { callOptionsSchema, signalEntry } from "./options.js";
import { readQuery } from "./query.js";
import { jsonOf, readAnswer, send, urlOf } from "./request.js";

/** The most parts of one multipart answer: a page of Statements and their Attachments, bounded in memory by `maxBytes`. */
const MAX_PAGE_PARTS = 10_000;

const CONSISTENT_THROUGH = "x-experience-api-consistent-through";

/** What a call that sends Statements may carry. */
export interface SendOptions extends CallOptions {
  /**
   * The data of the Attachments of the Statements. When it is present the request is a multipart message, even when the list is
   * empty; otherwise it is JSON, and each Attachment needs a `fileUrl`.
   *
   * @defaultValue none
   */
  readonly attachments?: readonly AttachmentData[];
}

/** What a call that fetches one Statement may ask for. */
export interface GetStatementOptions extends CallOptions {
  /**
   * How much of an Agent, Activity, Verb or Group the Statement shows.
   *
   * @defaultValue `"exact"`
   */
  readonly format?: StatementFormat;
  /**
   * Fetches a Statement that was voided, by `voidedStatementId`, and no other.
   *
   * @defaultValue false
   */
  readonly voided?: boolean;
}

/** A page of the answer to a query of Statements. */
export interface StatementPage {
  /** The Statements, as an LRS reads them. */
  readonly statements: readonly Statement[];
  /** The data of the Attachments by their hash in lower case: empty unless the query asked for them. */
  readonly attachments: ReadonlyMap<string, AttachmentData>;
  /** The time up to which every Statement stored is known to be available: `X-Experience-API-Consistent-Through`. */
  readonly consistentThrough: string;
  /**
   * The address of the next page, as the LRS wrote it.
   *
   * @defaultValue none on the last page
   */
  readonly more?: string;
}

const sendOptionsSchema = strictRecord({ attachments: v.optional(v.array(attachmentDataSchema)), ...signalEntry });

const getOptionsSchema = strictRecord({
  format: v.optional(v.picklist(STATEMENT_FORMATS)),
  voided: v.optional(v.boolean()),
  ...signalEntry,
});

const resultSchema = strictRecord({ statements: v.array(v.unknown()), more: v.optional(v.string()) });

/** The body of a request: the Statements as JSON, or as a multipart message when the caller sends Attachments. */
function bodyOf(
  document: Statement | readonly Statement[],
  attachments: readonly AttachmentData[] | undefined,
): { readonly contentType: string; readonly body: string | Uint8Array<ArrayBuffer> } {
  if (attachments !== undefined) return writeMultipart(document, attachments);
  return { contentType: "application/json", body: JSON.stringify(document) };
}

/** Stores one Statement with `PUT`, under its id. */
export async function sendStatement(
  settings: Settings,
  statement: Statement,
  options: unknown,
): Promise<"stored" | "conflict"> {
  const { attachments, signal } = parseWith(
    sendOptionsSchema,
    options === undefined ? {} : options,
    "The options object",
  );
  const read = readStatement(statement, { role: "provider" });
  if (read.id === undefined) {
    throw new DataError(
      "The Statement needs an id to be stored with PUT: deriveStatementId makes one that a resend repeats.",
    );
  }
  const { contentType, body } = bodyOf(read, attachments);
  const url = urlOf(settings, "statements", new URLSearchParams({ statementId: read.id }));
  const response = await send(
    settings,
    signal,
    url,
    { method: "PUT", headers: { "content-type": contentType }, body },
    [204, 409],
  );
  return response.status === 204 ? "stored" : "conflict";
}

/** Reads the ids that the LRS answered a `POST` with: a list of UUIDs, one for each Statement, in order. */
function storedIds(response: ServiceResponse, batch: readonly Statement[], settings: Settings): readonly string[] {
  if (response.status === 204) {
    const ids = batch.map(({ id }) => id);
    if (ids.some((id) => id === undefined)) {
      throw new DataError("The LRS answered 204 with no ids, and a Statement of the batch has none.");
    }
    return ids as string[];
  }
  const ids = parseWith(v.array(uuidSchema), jsonOf(response, settings), "The answer");
  if (ids.length !== batch.length) {
    throw new DataError(`The answer lists ${ids.length} ids for ${batch.length} Statements.`);
  }
  return ids;
}

/** Stores a batch of Statements with `POST`, and returns the ids that the LRS gave them. */
export async function sendStatements(
  settings: Settings,
  statements: readonly Statement[],
  options: unknown,
): Promise<readonly string[]> {
  const { attachments, signal } = parseWith(
    sendOptionsSchema,
    options === undefined ? {} : options,
    "The options object",
  );
  const errors = validateStatements(statements, { role: "provider" }).filter(({ severity }) => severity === "error");
  if (errors.length > 0) throw new DataError(refusalOf("The batch of Statements", errors, "validateStatements"));
  const batch = statements.map((statement) => readStatement(statement, { role: "provider" }));
  const { contentType, body } = bodyOf(batch, attachments);
  const url = urlOf(settings, "statements");
  const response = await send(
    settings,
    signal,
    url,
    { method: "POST", headers: { "content-type": contentType }, body },
    [200, 204],
  );
  return readAnswer(url, () => storedIds(response, batch, settings));
}

/** Fetches one Statement by its id, or undefined when the LRS has none. */
export async function getStatement(settings: Settings, id: string, options: unknown): Promise<Statement | undefined> {
  const { format, voided, signal } = parseWith(
    getOptionsSchema,
    options === undefined ? {} : options,
    "The options object",
  );
  const parameters = new URLSearchParams({
    [voided === true ? "voidedStatementId" : "statementId"]: parseWith(uuidSchema, id, "The statement id"),
  });
  if (format !== undefined) parameters.set("format", format);
  const url = urlOf(settings, "statements", parameters);
  const response = await send(
    settings,
    signal,
    url,
    { method: "GET", headers: { accept: "application/json" } },
    [200, 404],
  );
  if (response.status === 404) return undefined;
  return readAnswer(url, () => readStatement(jsonOf(response, settings)));
}

/** Reads the Statements of a page from the JSON of its answer: a result whose Statements are as an LRS reads them. */
function readResult(json: unknown): { readonly statements: readonly Statement[]; readonly more: string } {
  const result = parseWith(resultSchema, json, "The page");
  const statements = result.statements.map((entry, index) => {
    try {
      return readStatement(entry);
    } catch (error) {
      if (!(error instanceof DataError)) throw error;
      throw new DataError(`The page has an invalid Statement at statements[${index}]. ${error.message}`);
    }
  });
  return { statements, more: result.more ?? "" };
}

/** Reads one answer to a query as a page: JSON, or a multipart message with the data of the Attachments. */
function readPage(response: ServiceResponse, settings: Settings): StatementPage {
  const contentType = response.headers["content-type"];
  const consistentThrough = response.headers[CONSISTENT_THROUGH];
  if (consistentThrough === undefined || consistentThrough === "") {
    throw new DataError("The answer has no X-Experience-API-Consistent-Through header, which the standard requires.");
  }
  let json: unknown;
  let attachments: ReadonlyMap<string, AttachmentData> = new Map();
  if (contentType !== undefined && mediaTypeOf(contentType) === "multipart/mixed") {
    const message = readMultipart(contentType, response.body, {
      maxParts: MAX_PAGE_PARTS,
      maxPartBytes: settings.maxBytes,
      maxTotalBytes: settings.maxBytes,
    });
    json = message.statements;
    attachments = message.parts;
  } else {
    json = jsonOf(response, settings);
  }
  const { statements, more } = readResult(json);
  return { statements, attachments, consistentThrough, ...(more === "" ? {} : { more }) };
}

/** Resolves the address of the next page, which must be on the origin of the LRS so that a credential never leaves it. */
function nextUrl(settings: Settings, current: string, more: string, followed: ReadonlySet<string>): string {
  let next: URL;
  try {
    next = new URL(more, current);
  } catch {
    throw new DataError(`The address of the next page is not an address: ${JSON.stringify(more)}.`);
  }
  if (next.origin !== settings.origin || next.username !== "" || next.password !== "") {
    throw new DataError(
      `The address of the next page, ${JSON.stringify(more)}, is not on the origin of the LRS, ${settings.origin}: the client does not send its credential elsewhere.`,
    );
  }
  if (followed.has(next.href)) {
    throw new DataError(`The LRS sent the address of a page that was fetched already: ${JSON.stringify(more)}.`);
  }
  return next.href;
}

/** The iteration of a query: one request for each page, until the LRS has no more. */
async function* pagesOf(
  settings: Settings,
  first: string,
  attachments: boolean,
  signal: AbortSignal | undefined,
): AsyncGenerator<StatementPage> {
  const followed = new Set<string>();
  const accept = attachments ? "multipart/mixed, application/json" : "application/json";
  for (let url: string | undefined = first; url !== undefined; ) {
    followed.add(url);
    const response = await send(settings, signal, url, { method: "GET", headers: { accept } }, [200]);
    const page: StatementPage = readAnswer(url, () => readPage(response, settings));
    yield page;
    url = page.more === undefined ? undefined : nextUrl(settings, url, page.more, followed);
  }
}

/** Queries Statements and returns the pages as an iteration. The query is checked now; the requests are made as it is read. */
export function queryStatements(
  settings: Settings,
  query: StatementQuery,
  options: unknown,
): AsyncIterable<StatementPage> {
  const { signal } = parseWith(callOptionsSchema, options === undefined ? {} : options, "The options object");
  const { parameters, attachments } = readQuery(query);
  return pagesOf(settings, urlOf(settings, "statements", parameters), attachments, signal);
}
