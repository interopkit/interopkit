import { buildJsonResponse, type HttpResponse } from "@interopkit/core/http";
import type { DocumentScope, DocumentTarget } from "../../model/index.js";
import { type Context, isRefusal } from "../verdict.js";
import { fetchDocument, listDocuments } from "./port.js";

/** Answers a GET or HEAD for one document: its content, its type, and the ETag and time that come with it (4.1.4). */
export async function readDocument(context: Context, target: DocumentTarget): Promise<HttpResponse> {
  const found = await fetchDocument(context, target);
  if (isRefusal(found)) return context.refuse(found.status, found.message);
  const document = found.value;
  if (document === undefined) return context.refuse(404, "The LRS holds no such document.");
  return {
    status: 200,
    headers: {
      "content-type": document.contentType,
      etag: document.etag,
      "last-modified": new Date(document.updated).toUTCString(),
    },
    body: new Uint8Array(document.body),
  };
}

/** Answers a GET or HEAD for the ids of the documents of a context. */
export async function readIds(
  context: Context,
  scope: DocumentScope,
  since: string | undefined,
): Promise<HttpResponse> {
  const ids = await listDocuments(context, scope, since);
  if (isRefusal(ids)) return context.refuse(ids.status, ids.message);
  return buildJsonResponse(200, ids.value);
}
