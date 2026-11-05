import { DataError, requestService, ServiceError } from "@interopkit/core";
import { checkRemoteUrl, isRecord, parseJsonText } from "@interopkit/core/checks";
import { jsonRefusals } from "../json-text.js";
import { fetchOf } from "../option-checks.js";
import type { Context } from "./context.js";

/** The status that a host answers for a hosted assertion that its issuer revoked (Open Badges 2.0, Revoking Hosted Assertions). */
const GONE = 410;

/** What fetching a document of Open Badges 2.0 gave. */
export type FetchedV2 =
  | {
      /** The document, as parsed JSON. */
      readonly document: Readonly<Record<string, unknown>>;
    }
  | {
      /** The host answered 410 Gone: a hosted assertion that its issuer revoked. */
      readonly gone: true;
    }
  | {
      /** Why the document could not be had: the address is not HTTPS or names no public host, or it is not JSON. */
      readonly failed: string;
    }
  | {
      /** Why the host did not answer the document: a refusal, a fault of the network, a deadline, too many bytes. */
      readonly unavailable: string;
    };

/** Tells whether text is an absolute HTTPS address, the only kind that a verifier of Open Badges 2.0 fetches. */
export function isHttpsAddress(text: unknown): text is string {
  return typeof text === "string" && text.startsWith("https://") && URL.canParse(text);
}

/**
 * Fetches a document that an Open Badges 2.0 badge names: its hosted assertion, its BadgeClass, its issuer, a key or a revocation
 * list, through the host's `fetch`.
 *
 * @remarks
 * The address must be HTTPS and name its host by a public name (`checkRemoteUrl`): not an IP address, a single label or a name
 * of a private network. The request follows no redirect, ends at `timeoutMs` and reads at most `maxBytes`; the tokens and
 * the levels of the text are counted before it is parsed. A status of 410 is a value, which a hosted assertion answers when it
 * is revoked. Each fetch is one of the few that a badge causes: the assertion, its BadgeClass, its issuer, its key and the
 * revocation list. Where the host's `fetch` may reach is the host's: one for addresses that counterparties choose refuses
 * loopback, private and link-local addresses, checked on the address that the connection resolves to.
 *
 * @param url - The address.
 * @param what - Names the document in the sentences, such as `The BadgeClass`.
 * @param context - What the call shares.
 */
export async function fetchDocumentV2(url: unknown, what: string, context: Context): Promise<FetchedV2> {
  try {
    checkRemoteUrl(url, `The address of ${what.charAt(0).toLowerCase()}${what.slice(1)}`);
  } catch (error) {
    // checkRemoteUrl throws only a DataError, whose message says what keeps the address from being fetched.
    return { failed: (error as DataError).message };
  }
  const { settings } = context;
  let body: Uint8Array;
  try {
    const answer = await requestService(
      {
        fetch: fetchOf(settings),
        timeoutMs: settings.timeoutMs,
        ...(settings.signal === undefined ? {} : { signal: settings.signal }),
      },
      `${what} at ${url}`,
      url,
      { method: "GET", headers: { accept: "application/ld+json, application/json" } },
      { maxBytes: settings.maxBytes, expect: [200, GONE] },
    );
    if (answer.status === GONE) return { gone: true };
    body = answer.body;
  } catch (error) {
    if (error instanceof ServiceError || error instanceof DataError) return { unavailable: error.message };
    throw error;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return { failed: `${what} at ${url} is not UTF-8.` };
  }
  const limits = { maxDepth: settings.maxDepth, maxTokens: settings.maxTokens };
  let value: unknown;
  try {
    value = parseJsonText(text, limits, jsonRefusals(`${what} at ${url}`, limits));
  } catch (error) {
    // `parseJsonText` throws a `DataError` that says which limit the text passes, or why it is not JSON.
    return { failed: (error as DataError).message };
  }
  return isRecord(value) ? { document: value } : { failed: `${what} at ${url} is not a JSON object.` };
}
