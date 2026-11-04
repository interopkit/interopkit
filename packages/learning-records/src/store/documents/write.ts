import { DataError, readClock } from "@interopkit/core";
import type { HttpResponse } from "@interopkit/core/http";
import type { DocumentTarget, LrsDocument, LrsDocumentInput } from "../../model/index.js";
import { isMediaType, mediaTypeOf } from "../../model/internal.js";
import { attempt, type Context, isRefusal, refused, type Verdict } from "../verdict.js";
import { etagOf } from "./etag.js";
import { merge, readObject } from "./merge.js";
import { storeDocument } from "./port.js";
import { type BarePut, judge, type Preconditions, readPreconditions } from "./preconditions.js";
import { retryLostRaces } from "./races.js";

const JSON_TYPE = "application/json";

/** Reads the type of the body of a PUT or POST, which the request must name (4.1.6.2). */
function readContentType(context: Context): Verdict<string> {
  return attempt(() => {
    const type = context.request.headers["content-type"]?.trim();
    if (type === undefined || type === "")
      throw new DataError("A PUT or POST of a document needs a Content-Type header.");
    if (!isMediaType(type)) {
      throw new DataError(
        `The Content-Type must be an Internet media type, such as application/json, found ${JSON.stringify(type)}.`,
      );
    }
    return type;
  });
}

/** Refuses a document over the limit with 413. */
function tooLarge(context: Context, size: number): Verdict<undefined> {
  const { maxDocumentBytes } = context.settings.limits;
  if (size > maxDocumentBytes) {
    return refused(413, `The document has ${size} bytes, above the limit of ${maxDocumentBytes} bytes.`);
  }
  return { value: undefined };
}

/** Makes the document that a PUT stores: the body as it came. */
function replacement(context: Context, contentType: string): LrsDocumentInput {
  return { contentType, body: context.request.body };
}

/**
 * Makes the document that a POST stores: the body where no document exists, and otherwise the properties of the body laid
 * over the properties of the document, both JSON objects (4.1.6.2).
 */
function merged(context: Context, contentType: string, current: LrsDocument | undefined): Verdict<LrsDocumentInput> {
  const { body } = context.request;
  const { limits } = context.settings;
  const posted = mediaTypeOf(contentType) === JSON_TYPE;
  const read = attempt(() => {
    if (current === undefined) {
      if (posted) readObject(body, "The body of a POST with the type application/json", limits);
      return { contentType, body };
    }
    if (!posted || mediaTypeOf(current.contentType) !== JSON_TYPE) {
      throw new DataError(
        "A POST merges JSON objects: the body and the document that exists must both be application/json.",
      );
    }
    const sum = merge(
      readObject(current.body, "The document that exists", limits),
      readObject(body, "The body of the POST", limits),
    );
    return { contentType: JSON_TYPE, body: sum };
  });
  if (isRefusal(read)) return read;
  const size = tooLarge(context, read.value.body.byteLength);
  return isRefusal(size) ? size : read;
}

/**
 * Says what the route does with a PUT without a precondition: xAPI 1.0.3 lets State go without concurrency headers, since
 * conflicts of State are unlikely, and asks one of a PUT of a profile (1.0.3 Communication 3.1).
 */
function barePutOf(context: Context, target: DocumentTarget): BarePut {
  if (context.version === "2.0.0") return "create";
  return target.resource === "state" ? "replace" : "refuse";
}

/**
 * Changes a document under the preconditions of the request, and answers 204. The document the store holds is read, judged
 * against `If-Match` or `If-None-Match` (412 or 409), made into the new one, and written only if it is still the one that was
 * read. A write that loses a race to another writer is made again on the document that won, as the preconditions allow, and
 * is refused with 409 after three tries.
 */
async function change(
  context: Context,
  target: DocumentTarget,
  preconditions: Preconditions,
  method: "PUT" | "POST",
  make: (current: LrsDocument | undefined) => Verdict<LrsDocumentInput>,
): Promise<HttpResponse> {
  const { clock } = context.settings;
  const barePut = barePutOf(context, target);
  return retryLostRaces(context, target, "written", async (current) => {
    const condition = judge(preconditions, current, method, barePut);
    if (isRefusal(condition)) return context.refuse(condition.status, condition.message);
    const made = make(current);
    if (isRefusal(made)) return context.refuse(made.status, made.message);
    const document = {
      ...made.value,
      etag: etagOf(made.value.body),
      updated: new Date(readClock(clock)).toISOString(),
    };
    const outcome = await storeDocument(context, target, document, condition.value);
    if (isRefusal(outcome)) return context.refuse(outcome.status, outcome.message);
    if (outcome.value === "written") return { status: 204, headers: { etag: document.etag }, body: "" };
    if ("unconditional" in condition.value) {
      throw new DataError(
        `The answer of DocumentStore.write must be "written" for an unconditional write, found "${outcome.value}".`,
      );
    }
    return undefined;
  });
}

/** Answers a PUT or POST for one document (4.1.6.2, 4.1.6.5, 4.1.6.6). */
export async function writeDocument(
  context: Context,
  target: DocumentTarget,
  method: "PUT" | "POST",
): Promise<HttpResponse> {
  const contentType = readContentType(context);
  if (isRefusal(contentType)) return context.refuse(contentType.status, contentType.message);
  const size = tooLarge(context, context.request.body.byteLength);
  if (isRefusal(size)) return context.refuse(size.status, size.message);
  const preconditions = readPreconditions(context.request);
  const make =
    method === "PUT"
      ? () => ({ value: replacement(context, contentType.value) })
      : (current: LrsDocument | undefined) => merged(context, contentType.value, current);
  return change(context, target, preconditions, method, make);
}
