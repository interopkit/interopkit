import { callPort, DataError } from "@interopkit/core";
import { isLanguageTag } from "@interopkit/core/checks";
import { buildJsonResponse, type HttpResponse } from "@interopkit/core/http";
import { writeMultipart } from "../../attachments/index.js";
import { convertStatementVersion } from "../../compare/index.js";
import { sameActor } from "../../compare/internal.js";
import { formatStatement } from "../../format/index.js";
import type { ActivityDefinition, Actor, Statement, StatementFormat, StatementResult } from "../../model/index.js";
import { attachmentHeadersOf } from "../../read/internal.js";
import type { StoredStatement } from "../ports.js";
import { activitiesIn } from "../query.js";
import { FAILED } from "../status.js";
import { type Context, isRefusal, refused, type Verdict } from "../verdict.js";
import { CURSOR, type StatementsGet } from "./parameters.js";
import { consistentThrough } from "./through.js";

/** The languages that an `Accept-Language` header names, in the order of preference, without the ranges that weigh 0. */
function languagesOf(header: string | undefined): readonly string[] | undefined {
  if (header === undefined) return undefined;
  const ranges = header.split(",").flatMap((entry, order) => {
    const [range = "", ...parameters] = entry.split(";").map((part) => part.trim());
    if (range !== "*" && !isLanguageTag(range)) return [];
    const weight = parameters.find((parameter) => parameter.startsWith("q="));
    const quality = weight === undefined ? 1 : Number(weight.slice(2));
    return Number.isNaN(quality) || quality <= 0 ? [] : [{ range, quality, order }];
  });
  ranges.sort((a, b) => b.quality - a.quality || a.order - b.order);
  return ranges.length === 0 ? undefined : ranges.map(({ range }) => range);
}

/** Looks up the canonical definitions of the Activities of the Statements, for the format `canonical`. */
async function definitionsOf(
  context: Context,
  statements: readonly Statement[],
): Promise<Verdict<ReadonlyMap<string, ActivityDefinition>>> {
  const { signal } = context.settings;
  const definitions = new Map<string, ActivityDefinition>();
  for (const id of new Set(statements.flatMap(activitiesIn).map((activity) => activity.id))) {
    const asked = await callPort(() => context.settings.activities.get(id, { signal }), { signal });
    if (asked === undefined) return refused(500, FAILED);
    if (asked.value?.definition !== undefined) definitions.set(id, asked.value.definition);
  }
  return { value: definitions };
}

/**
 * Puts the Statements in the form of the route and the format that the request asks for (4.1.6.1): the route of 1.0.3 answers
 * a Statement of 2.0 without what 1.0.3 does not have (4.1.7, 2.5 of the gaps page).
 */
async function inFormat(
  context: Context,
  held: readonly Statement[],
  format: StatementFormat,
): Promise<Verdict<readonly Statement[]>> {
  const statements =
    context.version === "1.0.3" ? held.map((statement) => convertStatementVersion(statement, "1.0.3")) : held;
  if (format === "exact") return { value: statements };
  const languages = languagesOf(context.request.headers["accept-language"]);
  if (format === "ids") {
    return {
      value: statements.map((statement) =>
        formatStatement(statement, "ids", languages === undefined ? {} : { languages }),
      ),
    };
  }
  const definitions = await definitionsOf(context, statements);
  if (isRefusal(definitions)) return definitions;
  const options = { activities: definitions.value, ...(languages === undefined ? {} : { languages }) };
  return { value: statements.map((statement) => formatStatement(statement, "canonical", options)) };
}

/** Writes the headers of an answer: the time the store is consistent through, and the most recent `stored`. */
function headersOf(through: string, stored: readonly StoredStatement[]): Record<string, string> {
  const times = stored.map((each) => Date.parse(each.stored)).filter((time) => !Number.isNaN(time));
  return {
    "x-experience-api-consistent-through": through,
    ...(times.length === 0 ? {} : { "last-modified": new Date(times.reduce((a, b) => Math.max(a, b))).toUTCString() }),
  };
}

/** Builds the answer: JSON, or a multipart message with the data of the Attachments when the request asks for them. */
async function present(
  context: Context,
  document: Statement | StatementResult,
  statements: readonly Statement[],
  attachments: boolean,
  headers: Readonly<Record<string, string>>,
): Promise<HttpResponse> {
  if (!attachments) return buildJsonResponse(200, document, { headers });
  const { signal } = context.settings;
  const hashes = [...new Set(statements.flatMap(attachmentHeadersOf).map(({ sha2 }) => sha2.toLowerCase()))];
  const asked = await callPort(() => context.settings.statements.attachments(hashes, { signal }), { signal });
  if (asked === undefined) return context.refuse(500, FAILED);
  const message = writeMultipart(document, [...asked.value.values()]);
  return { status: 200, headers: { "content-type": message.contentType, ...headers }, body: message.body };
}

/**
 * The authority whose Statements alone the request may read, when its credential may read its own and not any (1.0.3
 * Communication 4.2).
 */
function ownAuthority(context: Context): Actor | undefined {
  const { actions, authority } = context.access;
  return actions.includes("statements.read") ? undefined : authority;
}

/** Tells whether a Statement is one that a credential that reads its own Statements may read: its `authority` is the credential's. */
function isOwn(statement: Statement, own: Actor): boolean {
  return statement.authority !== undefined && sameActor(statement.authority, own);
}

/** Answers a request for one Statement: the Statement, or 404 when the LRS has none of that kind. */
export async function answerOne(context: Context, get: Extract<StatementsGet, { kind: "one" }>): Promise<HttpResponse> {
  const { signal } = context.settings;
  const asked = await callPort(() => context.settings.statements.get(get.id, { voided: get.voided, signal }), {
    signal,
  });
  if (asked === undefined) return context.refuse(500, FAILED);
  const held = asked.value;
  const own = ownAuthority(context);
  const hidden = own !== undefined && held !== undefined && !isOwn(held.statement, own);
  if (held === undefined || held.voided !== get.voided || hidden) {
    return context.refuse(404, `The LRS holds no ${get.voided ? "voided " : ""}Statement with the id ${get.id}.`);
  }
  const formatted = await inFormat(context, [held.statement], get.format ?? "exact");
  if (isRefusal(formatted)) return context.refuse(formatted.status, formatted.message);
  const through = await consistentThrough(context);
  if (isRefusal(through)) return context.refuse(through.status, through.message);
  const [statement] = formatted.value;
  return present(
    context,
    statement ?? held.statement,
    formatted.value,
    get.attachments,
    headersOf(through.value, [held]),
  );
}

/** The size of the page that a request asks for (4.1.6.1): the default for none, and the largest for 0 or for more. */
function pageLimit(asked: number | undefined, context: Context): number {
  const { pageSize, maxPageSize } = context.settings.limits;
  if (asked === undefined) return Math.min(pageSize, maxPageSize);
  return asked === 0 || asked > maxPageSize ? maxPageSize : asked;
}

/** Writes the address of the next page: the path of the Statements, the parameters of the request, and the cursor. */
function nextPage(context: Context, carried: readonly (readonly [string, string])[], cursor: string): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of carried) parameters.append(name, value);
  parameters.append(CURSOR, cursor);
  return `${context.settings.basePath}/statements?${parameters}`;
}

/** Answers a query: a page of Statements and the address of the next page. */
export async function answerMany(
  context: Context,
  get: Extract<StatementsGet, { kind: "many" }>,
): Promise<HttpResponse> {
  const { signal } = context.settings;
  const limit = pageLimit(get.query.limit, context);
  const own = ownAuthority(context);
  const page = {
    limit,
    ...(get.cursor === undefined ? {} : { cursor: get.cursor }),
    ...(own === undefined ? {} : { authority: own }),
  };
  const asked = await callPort(() => context.settings.statements.query(get.query, page, { signal }), { signal });
  if (asked === undefined) return context.refuse(500, FAILED);
  if (asked.value === undefined)
    return context.refuse(400, "The cursor of the request is not valid, or it has expired.");
  const { statements, cursor } = asked.value;
  if (statements.length > limit || statements.some(({ voided }) => voided)) {
    throw new DataError(
      `The answer of StatementStore.query must have at most ${limit} Statements and none that was voided, and it has ${statements.length}.`,
    );
  }
  // The store filters by page.authority; a store that does not would give a credential the Statements of others.
  if (own !== undefined && statements.some(({ statement }) => !isOwn(statement, own))) {
    throw new DataError(
      "The answer of StatementStore.query must hold only the Statements of page.authority, and it holds one of another authority.",
    );
  }
  const formatted = await inFormat(
    context,
    statements.map((each) => each.statement),
    get.query.format ?? "exact",
  );
  if (isRefusal(formatted)) return context.refuse(formatted.status, formatted.message);
  const through = await consistentThrough(context);
  if (isRefusal(through)) return context.refuse(through.status, through.message);
  const result: StatementResult = {
    statements: formatted.value,
    ...(cursor === undefined ? {} : { more: nextPage(context, get.carried, cursor) }),
  };
  return present(
    context,
    result,
    formatted.value,
    get.query.attachments === true,
    headersOf(through.value, statements),
  );
}
