import type { HttpResponse } from "@interopkit/core/http";
import { type Context, isRefusal } from "../verdict.js";
import { type DocumentResource, readDocumentsRequest } from "./parameters.js";
import { readDocument, readIds } from "./read.js";
import { deleteDocument, deleteStates } from "./remove.js";
import { writeDocument } from "./write.js";

/** Answers a request for one of the resources that hold documents. */
async function handleDocuments(context: Context, resource: DocumentResource): Promise<HttpResponse> {
  const asked = readDocumentsRequest(context.request, resource, context.settings.limits, context.version);
  if (isRefusal(asked)) return context.refuse(asked.status, asked.message);
  const { method } = context.request;
  const request = asked.value;
  if (request.kind === "all") return deleteStates(context, request.scope);
  if (request.kind === "many") return readIds(context, request.scope, request.since);
  if (method === "PUT" || method === "POST") return writeDocument(context, request.target, method);
  return method === "DELETE" ? deleteDocument(context, request.target) : readDocument(context, request.target);
}

/** Answers a request for the State resource (4.1.6.2). */
export function handleState(context: Context): Promise<HttpResponse> {
  return handleDocuments(context, "state");
}

/** Answers a request for the Agent Profile resource (4.1.6.5). */
export function handleAgentProfile(context: Context): Promise<HttpResponse> {
  return handleDocuments(context, "agent-profile");
}

/** Answers a request for the Activity Profile resource (4.1.6.6). */
export function handleActivityProfile(context: Context): Promise<HttpResponse> {
  return handleDocuments(context, "activity-profile");
}
