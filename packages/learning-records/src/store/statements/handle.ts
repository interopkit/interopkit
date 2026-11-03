import type { HttpResponse } from "@interopkit/core/http";
import { buildJsonResponse } from "@interopkit/core/http";
import type { Context } from "../verdict.js";
import { isRefusal } from "../verdict.js";
import { answerMany, answerOne } from "./answer.js";
import { readBody } from "./body.js";
import { storeStatements } from "./insert.js";
import { readGet, readPost, readPut } from "./parameters.js";
import { prepare } from "./prepare.js";
import { consistentThrough } from "./through.js";

const CONSISTENT_THROUGH = "x-experience-api-consistent-through";

/** Answers a GET or a HEAD: one Statement, or a page of them. */
async function get(context: Context): Promise<HttpResponse> {
  const asked = readGet(context.request, context.settings.limits, context.version);
  if (isRefusal(asked)) return context.refuse(asked.status, asked.message);
  return asked.value.kind === "one" ? answerOne(context, asked.value) : answerMany(context, asked.value);
}

/** Stores the Statements of a PUT or a POST, and answers 204, or 200 with the ids for a POST that stored something. */
async function write(context: Context, method: "PUT" | "POST"): Promise<HttpResponse> {
  const { request, settings } = context;
  const parameters = method === "PUT" ? readPut(request) : readPost(request);
  if (isRefusal(parameters)) return context.refuse(parameters.status, parameters.message);
  const body = readBody(request, settings.limits);
  if (isRefusal(body)) return context.refuse(body.status, body.message);
  const single = typeof parameters.value === "string" ? { id: parameters.value } : undefined;
  const prepared = await prepare(context, body.value, single);
  if (isRefusal(prepared)) return context.refuse(prepared.status, prepared.message);
  const stored = await storeStatements(context, prepared.value);
  if (isRefusal(stored)) return context.refuse(stored.status, stored.message);
  const through = await consistentThrough(context);
  if (isRefusal(through)) return context.refuse(through.status, through.message);
  const headers = { [CONSISTENT_THROUGH]: through.value };
  if (method === "POST" && (stored.value.created || stored.value.ids.length === 0))
    return buildJsonResponse(200, stored.value.ids, headers);
  return { status: 204, headers, body: "" };
}

/**
 * Adds `X-Experience-API-Consistent-Through` to an answer that lacks it, which is every refusal of the resource: the standard
 * asks for the header on all responses to Statements Resource requests (4.1.6.1), a 400 or a 404 included. An answer that the
 * store cannot give the time for stays as it is.
 */
async function withConsistentThrough(context: Context, response: HttpResponse): Promise<HttpResponse> {
  if (CONSISTENT_THROUGH in response.headers) return response;
  const through = await consistentThrough(context);
  if (isRefusal(through)) return response;
  return { ...response, headers: { ...response.headers, [CONSISTENT_THROUGH]: through.value } };
}

/** Answers a request for the Statements resource (4.1.6.1). */
export async function handleStatements(context: Context): Promise<HttpResponse> {
  const { method } = context.request;
  const response = method === "PUT" || method === "POST" ? await write(context, method) : await get(context);
  return withConsistentThrough(context, response);
}
