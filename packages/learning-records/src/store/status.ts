import { buildJsonResponse, type HttpResponse } from "@interopkit/core/http";
import { negotiate } from "./negotiate.js";

/** Builds the answer of a refused request. */
export type Refuse = (status: number, message: string, headers?: Readonly<Record<string, string>>) => HttpResponse;

const JSON_TYPE = "application/json";
const TEXT_TYPE = "text/plain";
const HTML_TYPE = "text/html";

/** Writes text so that it is text in HTML. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/gu, (character) => `&#${character.charCodeAt(0)};`);
}

/**
 * Makes the function that builds the answer of a refused request in the media type that the `Accept` header prefers among plain
 * text, JSON and HTML, plain text when it prefers none or prefers them alike (4.1.5). The message is a sentence that says what is wrong.
 */
export function refusalWriter(accept: string | undefined): Refuse {
  const type = negotiate(accept, [TEXT_TYPE, JSON_TYPE, HTML_TYPE]);
  return (status, message, headers = {}) => {
    if (type === JSON_TYPE) return buildJsonResponse(status, { message }, { headers });
    if (type === TEXT_TYPE) {
      return { status, headers: { "content-type": "text/plain;charset=UTF-8", ...headers }, body: message };
    }
    return {
      status,
      headers: { "content-type": "text/html;charset=UTF-8", ...headers },
      body: `<!doctype html><title>${status}</title><p>${escapeHtml(message)}</p>`,
    };
  };
}

/** The answer for a port that failed: 500, with nothing of the failure in it. */
export const FAILED = "The LRS could not answer the request.";
