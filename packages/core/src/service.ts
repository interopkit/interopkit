import type { CallOptions } from "./call-options.js";
import { checkAbortSignal, checkFunction, checkPositiveInteger, checkRecord } from "./checks.js";
import { ServiceError } from "./errors.js";
import { untilAborted } from "./until-aborted.js";

/** The most bytes that the answer of a service may have: a key set or a token response is a few kilobytes. */
const MAX_RESPONSE_BYTES = 65_536;

/** The time that a call to a service may take when the host sets none, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * The part of the web standard `fetch` that the libraries call. A host passes `fetch`; a test passes a function that
 * records the requests and answers them.
 *
 * @remarks
 * The libraries never follow a redirect, because it could lead from HTTPS to another scheme: `redirect` is `"manual"`,
 * which every runtime accepts, and any 3xx answer is an error. Cloudflare Workers throw on `"error"`.
 *
 * Nothing checks where a request goes. A host whose URLs come from a counterparty passes a `fetch` that refuses loopback,
 * private and link-local addresses, checked on the address that the connection resolves to and not on the host name: a name
 * that is public when it is checked can be private when the connection is made (DNS rebinding).
 */
export type Fetch = (
  url: string,
  init: {
    readonly method: "GET" | "POST";
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly redirect: "manual";
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

/** What a call to a service needs: the `fetch` of the host and the time it may take. `signal` joins the deadline. */
export interface ServiceCall extends CallOptions {
  /** The `fetch` that makes the request. */
  readonly fetch: Fetch;
  /** The most time in milliseconds that the call may take, from the request to the last byte of the answer. */
  readonly timeoutMs: number;
}

/** The text of an answer, and whether it ended within the limit. */
interface Answer {
  readonly text: string;
  readonly complete: boolean;
}

/** Ignores the outcome of work that nobody waits for any more. */
function ignore(): void {}

/** Frees the connection of an answer that arrives after the call stopped waiting for it. */
function release(pending: Promise<Response> | undefined): void {
  pending?.then((late) => late.body?.cancel(), ignore).catch(ignore);
}

/**
 * Reads the body of an answer as text, up to the limit, and stops reading there. The chunk that crosses the limit is read as far
 * as the limit, so that what an error carries does not depend on how the network split the answer.
 */
async function readText(response: Response, signal: AbortSignal): Promise<Answer> {
  const reader = response.body?.getReader();
  if (reader === undefined) return { text: "", complete: true };
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await untilAborted(reader.read(), signal);
      if (done) {
        finished = true;
        return { text: text + decoder.decode(), complete: true };
      }
      const room = MAX_RESPONSE_BYTES - bytes;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        // Not flushed: the bytes of a character that the limit cuts are not text.
        return { text: text + decoder.decode(value.subarray(0, room), { stream: true }), complete: false };
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    // Not awaited: the source of a body that has stalled may never finish cancelling, and the call must end.
    if (!finished) reader.cancel().catch(ignore);
  }
}

/**
 * Tells whether an answer is a redirect: a 3xx status, the opaque answer that a browser gives for `"manual"`, or an answer
 * that a `fetch` followed to another address although it was told not to.
 */
function isRedirect(response: Response): boolean {
  return response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

/** What a call rejects with when its wait ended: the reason of the caller's abort, else a `ServiceError` of status 0. */
function failure(error: unknown, what: string, service: ServiceCall, deadline: AbortSignal): unknown {
  if (service.signal?.aborted) return service.signal.reason;
  if (deadline.aborted) return new ServiceError(`${what} did not answer within ${service.timeoutMs} ms.`, 0, "");
  const reason = error instanceof Error ? error.message : String(error);
  return new ServiceError(`${what} did not answer: ${reason}.`, 0, "");
}

/**
 * Calls a service and returns the body of its successful answer.
 *
 * @remarks
 * A redirect is an error, because it could lead from HTTPS to another scheme. Every wait is raced against the deadline
 * and the signal of the caller, so a `fetch` that ignores its signal cannot hold the call past `timeoutMs`; the body of
 * an answer that arrives later is cancelled. The answer has a size limit of 65,536 bytes.
 *
 * @param service - The `fetch`, the time the call may take and the signal that ends the caller's wait.
 * @param what - Names the service in the error messages, such as `The key set at https://platform.example/jwks`.
 * @param url - The address of the request.
 * @param init - The method, the headers and the body of the request.
 * @returns The body of the answer, as text.
 * @throws `DataError` when `service` is not valid.
 * @throws `ServiceError` with status `0` when the service did not answer, and with its status when it answered with a
 * redirect or an error, or with more than the limit.
 * @throws The `reason` of `service.signal` when it aborts, before or during the call.
 */
export async function callService(
  service: ServiceCall,
  what: string,
  url: string,
  init: { readonly method: "GET" | "POST"; readonly headers: Readonly<Record<string, string>>; readonly body?: string },
): Promise<string> {
  checkRecord(service, "The options of a call to a service must be an object");
  checkFunction(service.fetch, "The option fetch must be a function");
  checkPositiveInteger(service.timeoutMs, "The option timeoutMs");
  if (service.signal !== undefined) checkAbortSignal(service.signal, "The option signal");
  service.signal?.throwIfAborted();
  const deadline = AbortSignal.timeout(service.timeoutMs);
  const signal = service.signal === undefined ? deadline : AbortSignal.any([service.signal, deadline]);
  // A local binding: a bare global `fetch` throws when it is called as a method of another object.
  const call = service.fetch;
  let pending: Promise<Response> | undefined;
  let response: Response | undefined;
  let answer: Answer;
  try {
    pending = Promise.resolve(call(url, { ...init, redirect: "manual", signal }));
    response = await untilAborted(pending, signal);
    answer = await readText(response, signal);
  } catch (error) {
    if (response === undefined) release(pending);
    throw failure(error, what, service, deadline);
  }
  if (isRedirect(response)) {
    throw new ServiceError(
      `${what} answered with a redirect (${response.status}), which the call does not follow: use the final address.`,
      response.status,
      answer.text,
    );
  }
  if (!response.ok) throw new ServiceError(`${what} answered ${response.status}.`, response.status, answer.text);
  if (!answer.complete) {
    throw new ServiceError(
      `${what} answered with more than ${MAX_RESPONSE_BYTES} bytes.`,
      response.status,
      answer.text,
    );
  }
  return answer.text;
}
