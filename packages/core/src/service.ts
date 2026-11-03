import type { CallOptions } from "./call-options.js";
import { checkAbortSignal, checkArray, checkFunction, checkPositiveInteger, checkRecord, describe } from "./checks.js";
import { DataError, ServiceError } from "./errors.js";
import { raceAbort } from "./race-abort.js";

/** The most bytes that the answer of a service may have unless the caller says otherwise: a key set or a token response is a few kilobytes. */
export const DEFAULT_MAX_BYTES = 65_536;

/** The time that a call to a service may take when the host sets none, in milliseconds. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** A method of a request to a service. */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "HEAD";

const HTTP_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "HEAD"];

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
    readonly method: HttpMethod;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string | Uint8Array<ArrayBuffer>;
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

/** The request of a call: its method, its headers and, for a method that has one, its body. */
export interface ServiceInit {
  /** The method. A `GET` or `HEAD` request has no body. */
  readonly method: HttpMethod;
  /** The headers, by name. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The body: text is sent as UTF-8. Bytes are a `Uint8Array` over an `ArrayBuffer`, which is what `fetch` accepts.
   *
   * @defaultValue none
   */
  readonly body?: string | Uint8Array<ArrayBuffer>;
}

/** The answer of a service that the call accepted. */
export interface ServiceResponse {
  /** The HTTP status code. */
  readonly status: number;
  /** The headers, by name in lower case. A header that the answer repeats is joined with a comma and a space. */
  readonly headers: Readonly<Record<string, string>>;
  /** The body over an `ArrayBuffer`, which a web `Response` accepts; empty for `HEAD` and for a status that has none. */
  readonly body: Uint8Array<ArrayBuffer>;
}

/** What one request may ask for beyond the `service` it is made through. */
export interface RequestOptions extends CallOptions {
  /**
   * The most bytes of the answer.
   *
   * @defaultValue `DEFAULT_MAX_BYTES`, 65,536
   */
  readonly maxBytes?: number;
  /**
   * The statuses that the call returns as values: any other status is a `ServiceError`. A redirect cannot be listed.
   *
   * @defaultValue 200 to 299
   */
  readonly expect?: readonly number[];
}

/** The bytes of an answer, and whether it ended within the limit. */
interface Answer {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly complete: boolean;
}

/** Ignores the outcome of work that nobody waits for any more. */
function ignore(): void {}

/** Frees the connection of an answer that arrives after the call stopped waiting for it. */
function release(pending: Promise<Response> | undefined): void {
  pending?.then((late) => late.body?.cancel(), ignore).catch(ignore);
}

/** Joins the chunks of a body, which hold `size` bytes together. */
function join(chunks: readonly Uint8Array[], size: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads the body of an answer, up to the limit, and stops reading there. The chunk that crosses the limit is read as far
 * as the limit, so that what an error carries does not depend on how the network split the answer.
 */
async function readBytes(response: Response, maxBytes: number, signal: AbortSignal): Promise<Answer> {
  const reader = response.body?.getReader();
  if (reader === undefined) return { bytes: new Uint8Array(0), complete: true };
  const chunks: Uint8Array[] = [];
  let size = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), { signal });
      if (done) {
        finished = true;
        return { bytes: join(chunks, size), complete: true };
      }
      const room = maxBytes - size;
      size += value.byteLength;
      if (size > maxBytes) {
        chunks.push(value.subarray(0, room));
        return { bytes: join(chunks, maxBytes), complete: false };
      }
      chunks.push(value);
    }
  } finally {
    // Not awaited: the source of a body that has stalled may never finish cancelling, and the call must end.
    if (!finished) reader.cancel().catch(ignore);
  }
}

/**
 * The text that an error carries. The bytes of a character that the limit cuts are not text, so an answer that stopped at
 * the limit is not flushed.
 */
function errorText({ bytes, complete }: Answer): string {
  return new TextDecoder().decode(bytes, { stream: !complete });
}

/**
 * Tells whether an answer is a redirect: a 3xx status, the opaque answer that a browser gives for `"manual"`, or an answer
 * that a `fetch` followed to another address although it was told not to.
 */
function isRedirect(response: Response): boolean {
  return response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400);
}

/** Collects the headers of an answer by name in lower case, in a record with no prototype surprises for a name such as `__proto__`. */
function headersOf(headers: Headers): Readonly<Record<string, string>> {
  const collected = new Map<string, string>();
  for (const [name, value] of headers) {
    const earlier = collected.get(name);
    collected.set(name, earlier === undefined ? value : `${earlier}, ${value}`);
  }
  return Object.fromEntries(collected);
}

/** What a call rejects with when its wait ended: the reason of the caller's abort, else a `ServiceError` of status 0. */
function failure(
  error: unknown,
  what: string,
  service: ServiceCall,
  callers: readonly AbortSignal[],
  deadline: AbortSignal,
) {
  const aborted = callers.find((signal) => signal.aborted);
  if (aborted !== undefined) return aborted.reason;
  if (deadline.aborted) return new ServiceError(`${what} did not answer within ${service.timeoutMs} ms.`, 0, "");
  const reason = error instanceof Error ? error.message : String(error);
  return new ServiceError(`${what} did not answer: ${reason}.`, 0, "");
}

/**
 * Checks the `service` of a call, as a host passes it from JavaScript.
 *
 * @throws `DataError` when `fetch` is not a function, `timeoutMs` is not a positive integer, or `signal` is not an `AbortSignal`.
 */
export function checkServiceCall(service: unknown): asserts service is ServiceCall {
  checkRecord(service, "The options of a call to a service must be an object");
  checkFunction(service.fetch, "The option fetch must be a function");
  checkPositiveInteger(service.timeoutMs, "The option timeoutMs");
  if (service.signal !== undefined) checkAbortSignal(service.signal, "The option signal");
}

/** Checks the request of a call. */
function checkInit(init: ServiceInit): void {
  checkRecord(init, "The request of a call to a service must be an object");
  if (!HTTP_METHODS.includes(init.method)) {
    throw new DataError(
      `The method of the request must be ${HTTP_METHODS.join(", ")}, found ${describe(init.method)}.`,
    );
  }
  checkRecord(init.headers, "The headers of the request must be an object");
  const { body } = init;
  if (body !== undefined && typeof body !== "string" && !(body instanceof Uint8Array)) {
    throw new DataError(`The body of the request must be a string or a Uint8Array, found ${describe(body)}.`);
  }
  if (body !== undefined && (init.method === "GET" || init.method === "HEAD")) {
    throw new DataError(`A ${init.method} request has no body.`);
  }
}

/** Checks what a request asks for: the limit and the statuses it expects. */
function checkRequestOptions(options: RequestOptions): void {
  checkRecord(options, "The options of a request must be an object");
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
  if (options.maxBytes !== undefined) checkPositiveInteger(options.maxBytes, "The option maxBytes");
  if (options.expect === undefined) return;
  checkArray(options.expect, "The option expect must be an array");
  for (const status of options.expect) {
    if (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599) {
      throw new DataError(`The option expect must list HTTP statuses from 100 to 599, found ${describe(status)}.`);
    }
    if (status >= 300 && status < 400) {
      throw new DataError(`The option expect cannot list the redirect ${status}: a call never follows a redirect.`);
    }
  }
}

/**
 * Makes one request to a service and returns its status, headers and body.
 *
 * @remarks
 * A redirect is an error, because it could lead from HTTPS to another scheme. Every wait is raced against the deadline
 * and the signals of the caller, so a `fetch` that ignores its signal cannot hold the call past `timeoutMs`; the body of
 * an answer that arrives later is cancelled. A status outside `options.expect` is a `ServiceError` that carries the status,
 * the headers and the text of the body, so a caller can answer 404, 409 or 412 as a value by listing it, and read
 * `Retry-After` from the error of a 429.
 *
 * @param service - The `fetch`, the time the call may take and the signal that ends the caller's wait.
 * @param what - Names the service in the error messages, such as `The key set at https://platform.example/jwks`.
 * @param url - The address of the request.
 * @param init - The method, the headers and the body of the request.
 * @param options - The size limit, the statuses to return as values, and a signal that joins `service.signal`.
 * @returns The status, the headers by name in lower case, and the body of the answer.
 * @throws `DataError` when an argument is not valid.
 * @throws `ServiceError` with status `0` when the service did not answer, and with its status when it answered with a
 * redirect or a status that `options.expect` does not list, or with more than `options.maxBytes`.
 * @throws The `reason` of a signal when it aborts, before or during the call.
 */
export async function requestService(
  service: ServiceCall,
  what: string,
  url: string,
  init: ServiceInit,
  options: RequestOptions = {},
): Promise<ServiceResponse> {
  checkServiceCall(service);
  checkInit(init);
  checkRequestOptions(options);
  const callers = [service.signal, options.signal].filter((signal) => signal !== undefined);
  for (const signal of callers) signal.throwIfAborted();
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const deadline = AbortSignal.timeout(service.timeoutMs);
  const signal = AbortSignal.any([...callers, deadline]);
  // A local binding: a bare global `fetch` throws when it is called as a method of another object.
  const call = service.fetch;
  let pending: Promise<Response> | undefined;
  let response: Response | undefined;
  let answer: Answer;
  try {
    pending = Promise.resolve(call(url, { ...init, redirect: "manual", signal }));
    response = await raceAbort(pending, { signal });
    answer = await readBytes(response, maxBytes, signal);
  } catch (error) {
    if (response === undefined) release(pending);
    throw failure(error, what, service, callers, deadline);
  }
  const headers = headersOf(response.headers);
  if (isRedirect(response)) {
    throw new ServiceError(
      `${what} answered with a redirect (${response.status}), which the call does not follow: use the final address.`,
      response.status,
      errorText(answer),
      { headers },
    );
  }
  const expected = options.expect === undefined ? response.ok : options.expect.includes(response.status);
  if (!expected) {
    throw new ServiceError(`${what} answered ${response.status}.`, response.status, errorText(answer), { headers });
  }
  if (!answer.complete) {
    throw new ServiceError(
      `${what} answered with more than ${maxBytes} bytes, the limit of the option maxBytes: raise it to read a larger answer.`,
      response.status,
      errorText(answer),
      { headers },
    );
  }
  return { status: response.status, headers, body: answer.bytes };
}

/**
 * Calls a service and returns the body of its answer as text: `requestService` with UTF-8 decoding.
 *
 * @remarks
 * Bytes that are not UTF-8 become U+FFFD. The answer is a 2xx unless `options.expect` lists other statuses. Everything
 * else is as for `requestService`, with the same limit of 65,536 bytes unless `options.maxBytes` says otherwise.
 *
 * @param service - The `fetch`, the time the call may take and the signal that ends the caller's wait.
 * @param what - Names the service in the error messages, such as `The key set at https://platform.example/jwks`.
 * @param url - The address of the request.
 * @param init - The method, the headers and the body of the request.
 * @param options - The size limit, the statuses to return as values, and a signal that joins `service.signal`.
 * @returns The body of the answer, as text.
 * @throws `DataError` when an argument is not valid.
 * @throws `ServiceError` as `requestService` does.
 * @throws The `reason` of a signal when it aborts, before or during the call.
 */
export async function callService(
  service: ServiceCall,
  what: string,
  url: string,
  init: ServiceInit,
  options?: RequestOptions,
): Promise<string> {
  const { body } = await requestService(service, what, url, init, options);
  return new TextDecoder().decode(body);
}
