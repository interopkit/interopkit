import type { HttpResponse } from "@interopkit/core/http";
import type { DocumentTarget, LrsDocument } from "../../model/index.js";
import { type Context, isRefusal } from "../verdict.js";
import { fetchDocument } from "./port.js";

/** The most tries of a write or removal of a document that loses a race against another writer, the first one included. */
const MAX_WRITE_TRIES = 3;

/**
 * Reads a document and runs `attempt` on it, again on the document that won each time the store says it lost a race, and
 * refuses with 409 after the last try.
 *
 * @param change - What the request does to the document, for the message of the 409.
 * @param attempt - Judges the document that was read and changes it: the answer, or `undefined` when the store found the
 * document other than it was read.
 */
export async function retryLostRaces(
  context: Context,
  target: DocumentTarget,
  change: "written" | "removed",
  attempt: (current: LrsDocument | undefined) => Promise<HttpResponse | undefined>,
): Promise<HttpResponse> {
  for (let attempts = 0; attempts < MAX_WRITE_TRIES; attempts += 1) {
    const current = await fetchDocument(context, target);
    if (isRefusal(current)) return context.refuse(current.status, current.message);
    const answer = await attempt(current.value);
    if (answer !== undefined) return answer;
  }
  return context.refuse(
    409,
    `The document was changed by other requests while this one was ${change}: read it again and retry.`,
  );
}
