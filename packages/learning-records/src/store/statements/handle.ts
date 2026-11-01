import type { HttpResponse } from "@interopkit/core/http";
import { jsonResponse } from "@interopkit/core/http";
import type { Context } from "../verdict.js";
import { isRefusal } from "../verdict.js";
import { answerMany, answerOne } from "./answer.js";
import { readBody } from "./body.js";
import { storeStatements } from "./insert.js";
import { readGet, readPost, readPut } from "./parameters.js";
import { prepare } from "./prepare.js";
import { consistentThrough } from "./through.js";

/** Answers a GET or a HEAD: one Statement, or a page of them. */
async function get(context: Context): Promise<HttpResponse> {
  const asked = readGet(context.request);
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
  const headers = { "x-experience-api-consistent-through": through.value };
  if (method === "POST" && (stored.value.created || stored.value.ids.length === 0))
    return jsonResponse(200, stored.value.ids, headers);
  return { status: 204, headers, body: "" };
}

/** Answers a request for the Statements resource (4.1.6.1). */
export function handleStatements(context: Context): Promise<HttpResponse> {
  const { method } = context.request;
  if (method === "PUT" || method === "POST") return write(context, method);
  return get(context);
}
