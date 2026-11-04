import { type CallOptions, DataError, readAnswer, type ServiceResponse } from "@interopkit/core";
import {
  checkString,
  DEFAULT_MAX_FINDINGS,
  describe,
  describeRefusal,
  parseWith,
  strictRecord,
  uuidSchema,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { readMultipart, writeMultipart } from "../attachments/index.js";
import { convertStatementVersion } from "../compare/index.js";
import {
  type AttachmentData,
  RULE_ROLES,
  type RuleRole,
  STATEMENT_FORMATS,
  type Statement,
  type StatementFormat,
  type StatementQuery,
  type XapiVersion,
} from "../model/index.js";
import { mediaTypeOf } from "../model/internal.js";
import { readStatement } from "../read/index.js";
import {
  attachmentDataSchema,
  inspectBatch,
  issueSink,
  languageRangesSchema,
  readEitherVersion,
} from "../read/internal.js";
import type { Settings } from "./config.js";
import { readOptions, signalEntry } from "./options.js";
import { readQuery } from "./query.js";
import { jsonOf, STANDARD, send, urlOf, whatOf } from "./request.js";

/** The most parts of one multipart answer: a page of Statements and their Attachments, bounded in memory by `maxBytes`. */
const MAX_PAGE_PARTS = 10_000;

const CONSISTENT_THROUGH = "x-experience-api-consistent-through";

/** The `Accept` of a request whose answer may hold the data of Attachments. */
const ACCEPT_WITH_DATA = "multipart/mixed, application/json";

/** What a call that sends Statements may carry. */
export interface SendOptions extends CallOptions {
  /**
   * The data of the Attachments of the Statements. When it is present the request is a multipart message, even when the list is
   * empty; otherwise it is JSON, and each Attachment needs a `fileUrl`.
   *
   * @defaultValue none
   */
  readonly attachments?: readonly AttachmentData[];
  /**
   * Whose rules the Statements are read with before they are sent: `provider`, or `lrs` for a host that forwards what another
   * LRS holds, whose Statements carry what that LRS set (`stored`, `authority`, `version`) and that a provider does not write.
   *
   * @defaultValue `"provider"`
   */
  readonly role?: RuleRole;
}

/** What a call that fetches Statements may carry. */
export interface ReadStatementsOptions extends CallOptions {
  /**
   * The languages to prefer, the first the most, as language tags or `*`: the `Accept-Language` of the request, by which an LRS
   * picks one language of each language map of the format `canonical`.
   *
   * @defaultValue none: the LRS picks
   */
  readonly languages?: readonly string[];
}

/** What a call that fetches one Statement may ask for. */
export interface GetStatementOptions extends ReadStatementsOptions {
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
  /**
   * Asks for the data of the Attachments too. The answer is then a `StatementWithAttachments`.
   *
   * @defaultValue false
   */
  readonly attachments?: boolean;
}

/** One Statement with the data of its Attachments, by their hash in lower case. */
export interface StatementWithAttachments {
  /** The Statement, as an LRS reads it. */
  readonly statement: Statement;
  /** The data of the Attachments that the LRS sent. */
  readonly attachments: ReadonlyMap<string, AttachmentData>;
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

const sendOptionsSchema = strictRecord({
  attachments: v.optional(v.array(attachmentDataSchema)),
  role: v.optional(v.picklist(RULE_ROLES)),
  ...signalEntry,
});

const readEntries = { languages: v.optional(languageRangesSchema), ...signalEntry };

const readOptionsSchema = strictRecord(readEntries);

const getOptionsSchema = strictRecord({
  format: v.optional(v.picklist(STATEMENT_FORMATS)),
  voided: v.optional(v.boolean()),
  attachments: v.optional(v.boolean()),
  ...readEntries,
});

/** The quality of the second language of an `Accept-Language` header, and how much less each next one has, in tenths. */
const QUALITY_STEPS = 10;

/** Writes the `Accept-Language` header of languages in the order of preference: `fr-CA, fr;q=0.9, en;q=0.8`. */
function languageHeader(languages: readonly string[] | undefined): Readonly<Record<string, string>> {
  if (languages === undefined || languages.length === 0) return {};
  const ranges = languages.map((range, order) =>
    order === 0 ? range : `${range};q=${Math.max(QUALITY_STEPS - order, 1) / QUALITY_STEPS}`,
  );
  return { "accept-language": ranges.join(", ") };
}

const resultSchema = strictRecord({ statements: v.array(v.unknown()), more: v.optional(v.string()) });

/**
 * Reads a Statement of an answer. A client of 1.0.3 tolerates a data structure with additional properties and ignores what
 * version 1.0.0 does not define (1.0.3 Communication 3.3), so it reads a Statement of either version into the form of 1.0.3: an
 * LRS that serves both versions may answer a Statement of 2.0 as it holds it.
 */
function readAnswered(value: unknown, version: XapiVersion): Statement {
  return version === "1.0.3" ? convertStatementVersion(readEitherVersion(value), "1.0.3") : readStatement(value);
}

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
  const { attachments, role = "provider", signal } = readOptions(sendOptionsSchema, options);
  const read = readStatement(statement, { role, version: settings.version });
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

/**
 * Reads the ids that the LRS answered a `POST` with. Where every Statement of the batch has an id, the ids are the batch's: the
 * answer may list them all, only the Statements that are new, or none, which is how real LRSs answer a resend, and it must name
 * no Statement that the batch does not have. Where a Statement has none, the LRS gives it one, so the answer lists one id for
 * each Statement, in order.
 */
function storedIds(response: ServiceResponse, batch: readonly Statement[], settings: Settings): readonly string[] {
  const sent = batch.map(({ id }) => id);
  const known = sent.every((id): id is string => id !== undefined);
  if (response.status === 204) {
    if (!known) throw new DataError("The LRS answered 204 with no ids, and a Statement of the batch has none.");
    return sent;
  }
  const ids = parseWith(v.array(uuidSchema), jsonOf(response, settings), "The answer");
  if (!known) {
    if (ids.length !== batch.length) {
      throw new DataError(`The answer lists ${ids.length} ids for ${batch.length} Statements.`);
    }
    return ids;
  }
  const held = new Set(sent.map((id) => id.toLowerCase()));
  const stranger = ids.find((id) => !held.has(id.toLowerCase()));
  if (stranger !== undefined)
    throw new DataError(`The answer lists the id ${stranger}, which no Statement of the batch has.`);
  return sent;
}

/** Stores a batch of Statements with `POST`, and returns the ids that the LRS gave them. */
export async function sendStatements(
  settings: Settings,
  statements: readonly Statement[],
  options: unknown,
): Promise<readonly string[]> {
  const { attachments, role = "provider", signal } = readOptions(sendOptionsSchema, options);
  const sink = issueSink(DEFAULT_MAX_FINDINGS, true);
  const batch = inspectBatch(statements, { role, version: settings.version }, sink);
  const errors = sink.list();
  if (errors.length > 0) throw new DataError(describeRefusal("The batch of Statements", errors, "validateStatements"));
  const { contentType, body } = bodyOf(batch, attachments);
  const url = urlOf(settings, "statements");
  const response = await send(
    settings,
    signal,
    url,
    { method: "POST", headers: { "content-type": contentType }, body },
    [200, 204],
  );
  return readAnswer(whatOf(url), STANDARD, () => storedIds(response, batch, settings));
}

/** The JSON of an answer and the data of the Attachments: a multipart message gives both, and JSON gives no data. */
function readBody(
  response: ServiceResponse,
  settings: Settings,
): { readonly json: unknown; readonly attachments: ReadonlyMap<string, AttachmentData> } {
  const contentType = response.headers["content-type"];
  if (contentType === undefined || mediaTypeOf(contentType) !== "multipart/mixed") {
    return { json: jsonOf(response, settings), attachments: new Map() };
  }
  const message = readMultipart(contentType, response.body, {
    maxParts: MAX_PAGE_PARTS,
    maxPartBytes: settings.maxBytes,
    maxTotalBytes: settings.maxBytes,
    maxTokens: settings.maxTokens,
  });
  return { json: message.statements, attachments: message.parts };
}

/** Fetches one Statement by its id, or undefined when the LRS has none. With `attachments` it fetches their data too. */
export async function getStatement(
  settings: Settings,
  id: string,
  options: unknown,
): Promise<Statement | StatementWithAttachments | undefined> {
  const { format, voided, attachments, languages, signal } = readOptions(getOptionsSchema, options);
  const parameters = new URLSearchParams({
    [voided === true ? "voidedStatementId" : "statementId"]: parseWith(uuidSchema, id, "The statement id"),
  });
  if (format !== undefined) parameters.set("format", format);
  if (attachments !== undefined) parameters.set("attachments", String(attachments));
  const url = urlOf(settings, "statements", parameters);
  const accept = attachments === true ? ACCEPT_WITH_DATA : "application/json";
  const headers = { accept, ...languageHeader(languages) };
  const response = await send(settings, signal, url, { method: "GET", headers }, [200, 404]);
  if (response.status === 404) return undefined;
  return readAnswer(whatOf(url), STANDARD, () => {
    const body = readBody(response, settings);
    const statement = readAnswered(body.json, settings.version);
    // The case of a UUID does not make it another UUID.
    if (statement.id?.toLowerCase() !== id.toLowerCase()) {
      throw new DataError(`The Statement has the id ${describe(statement.id)}, and the request asked for ${id}.`);
    }
    return attachments === true ? { statement, attachments: body.attachments } : statement;
  });
}

/** Reads the Statements of a page from the JSON of its answer: a result whose Statements are as an LRS of the version reads them. */
function readResult(
  json: unknown,
  version: XapiVersion,
): { readonly statements: readonly Statement[]; readonly more: string } {
  const result = parseWith(resultSchema, json, "The page");
  const statements = result.statements.map((entry, index) => {
    try {
      return readAnswered(entry, version);
    } catch (error) {
      if (!(error instanceof DataError)) throw error;
      throw new DataError(`The page has an invalid Statement at statements[${index}]. ${error.message}`, {
        cause: error,
      });
    }
  });
  return { statements, more: result.more ?? "" };
}

/** Reads one answer to a query as a page: JSON, or a multipart message with the data of the Attachments. */
function readPage(response: ServiceResponse, settings: Settings): StatementPage {
  const consistentThrough = response.headers[CONSISTENT_THROUGH];
  if (consistentThrough === undefined || consistentThrough === "") {
    throw new DataError("The answer has no X-Experience-API-Consistent-Through header, which the standard requires.");
  }
  const { json, attachments } = readBody(response, settings);
  const { statements, more } = readResult(json, settings.version);
  return { statements, attachments, consistentThrough, ...(more === "" ? {} : { more }) };
}

/** Resolves the address of the next page, which must be on the origin of the LRS so that a credential never leaves it. */
function nextUrl(settings: Settings, current: string, more: string, followed: ReadonlySet<string>): string {
  let next: URL;
  try {
    next = new URL(more, current);
  } catch (error) {
    throw new DataError(`The address of the next page is not an address: ${JSON.stringify(more)}.`, { cause: error });
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

/** What the requests of an iteration carry. */
interface PageRequest {
  /** The headers of each request. */
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal | undefined;
}

/** The iteration of a query: one request for each page, until the LRS has no more. */
async function* pagesOf(settings: Settings, first: string, request: PageRequest): AsyncGenerator<StatementPage> {
  const { headers, signal } = request;
  const followed = new Set<string>();
  for (let url: string | undefined = first; url !== undefined; ) {
    followed.add(url);
    const response = await send(settings, signal, url, { method: "GET", headers }, [200]);
    const page: StatementPage = readAnswer(whatOf(url), STANDARD, () => readPage(response, settings));
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
  const { languages, signal } = readOptions(readOptionsSchema, options);
  const { parameters, attachments } = readQuery(query);
  const headers = { accept: attachments ? ACCEPT_WITH_DATA : "application/json", ...languageHeader(languages) };
  return pagesOf(settings, urlOf(settings, "statements", parameters), { headers, signal });
}

/**
 * Goes on with a query from the address of a page, which a host kept. The iteration starts with that page. The address says
 * whether the answer holds the data of Attachments, so the request takes either form.
 */
export function moreStatements(settings: Settings, more: string, options: unknown): AsyncIterable<StatementPage> {
  const { languages, signal } = readOptions(readOptionsSchema, options);
  checkString(more, "The address of the page");
  const first = nextUrl(settings, settings.root, more, new Set());
  return pagesOf(settings, first, { headers: { accept: ACCEPT_WITH_DATA, ...languageHeader(languages) }, signal });
}
