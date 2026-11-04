import { readRetryAfterSeconds } from "./answer-headers.js";
import { checkPositiveInteger, checkRecord } from "./checks.js";
import { DataError, LimitError, ServiceError } from "./errors.js";
import { findExceededJsonLimit, hasMoreTokensThan, MAX_JSON_DEPTH, MAX_JSON_TOKENS, nestsDeeperThan } from "./json.js";
import type { ServiceResponse } from "./service.js";

/** Throws on bytes that are not UTF-8, where the default decoder would replace them. */
const DECODER = new TextDecoder("utf-8", { fatal: true });

/** What `readAnswerJson` limits. */
export interface ReadAnswerJsonOptions {
  /**
   * The deepest nesting of arrays and objects: `[]` has depth 1 and `[[]]` has depth 2.
   *
   * @defaultValue 64
   */
  readonly maxDepth?: number;
  /**
   * The most tokens of the answer: each bracket, brace, colon and comma, each string, each number, and each of `true`,
   * `false` and `null`. The memory of a parse grows with the tokens and not with the bytes.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
}

/**
 * Reads the body of an answer of a service as JSON, within limits on its depth and its tokens, for a client that reads what a
 * server it does not control sends.
 *
 * @remarks
 * The body must be UTF-8. The depth and the tokens are counted in one reading of the text before it is parsed, so an answer of
 * ten thousand opening brackets, or of a million empty arrays, is refused without building anything; a text over both limits is
 * refused for its depth. `requestService` has limited the bytes already.
 *
 * @param response - The answer.
 * @param what - Names the service in the sentence of an error, such as `The CASE provider at https://example.org/...`.
 * @param options - The limits.
 * @returns The parsed value.
 * @throws `LimitError`, a `DataError` that names the service, when the body nests deeper or has more tokens than the limits.
 * @throws `DataError` that names the service, when the options are not valid, or the body is not UTF-8 or not JSON.
 */
export function readAnswerJson(response: ServiceResponse, what: string, options: ReadAnswerJsonOptions = {}): unknown {
  checkRecord(options, "The options of readAnswerJson must be an object");
  if (options.maxDepth !== undefined) checkPositiveInteger(options.maxDepth, "The option maxDepth");
  if (options.maxTokens !== undefined) checkPositiveInteger(options.maxTokens, "The option maxTokens");
  const { maxDepth = MAX_JSON_DEPTH, maxTokens = MAX_JSON_TOKENS } = options;
  let text: string;
  try {
    text = DECODER.decode(response.body);
  } catch (error) {
    throw new DataError(`${what} answered with a body that is not UTF-8 text.`, { cause: error });
  }
  // One reading finds the first limit that the text passes. The depth is refused before the tokens, so a text that passes the
  // tokens first is read on for its depth.
  const excess = findExceededJsonLimit(text, maxDepth, maxTokens);
  if (excess === "depth" || (excess === "tokens" && nestsDeeperThan(text, maxDepth))) {
    throw new LimitError(`${what} answered with JSON that nests more than ${maxDepth} levels.`, "maxDepth", maxDepth);
  }
  if (excess === "tokens") {
    throw new LimitError(
      `${what} answered with a body of more than ${maxTokens} tokens of JSON, above the limit of the option maxTokens.`,
      "maxTokens",
      maxTokens,
    );
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DataError(`${what} answered with a body that is not JSON.`, { cause: error });
  }
}

/**
 * Runs a reader on the data of an answer of a service, and says whose answer it was when the data is not valid.
 *
 * @remarks
 * Whatever the reader throws is the fault of the answer that it was given, so any error, and not only a `DataError`, becomes a
 * `DataError` whose sentence names the service, the standard and the reader's reason, and whose `cause` is what the reader
 * threw. A `LimitError` stays one, with its limit and its maximum, so that every limit of a reading is told by one class.
 *
 * @param what - Names the service in the sentence, such as `The CASE provider at https://example.org/...`.
 * @param standard - Names the standard that the data must follow, such as `CASE` or `Open Badges`.
 * @param read - Reads the data, and throws when it is not valid.
 * @returns What the reader returns.
 * @throws `DataError`: `<what> answered with data that is not valid <standard>: <reason>`.
 * @throws `LimitError`, when the reader threw one: `<what> answered with data over a limit: <reason>`.
 */
export function readAnswer<TValue>(what: string, standard: string, read: () => TValue): TValue {
  try {
    return read();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (error instanceof LimitError) {
      throw new LimitError(`${what} answered with data over a limit: ${reason}`, error.limit, error.maximum, {
        cause: error,
      });
    }
    throw new DataError(`${what} answered with data that is not valid ${standard}: ${reason}`, { cause: error });
  }
}

/** What a server said when it refused a request: the status in the body of its answer, and how long it asks a client to wait. */
export interface StatusDetail<TInfo> {
  /**
   * The status in the body of the answer, as the reader of the caller reads it.
   *
   * @defaultValue none: the body is not JSON, or not a status that the reader accepts
   */
  readonly info?: TInfo;
  /**
   * The seconds that `Retry-After` asks the client to wait.
   *
   * @defaultValue none: the header is absent, or gives a date
   */
  readonly retryAfterSeconds?: number;
}

/**
 * Reads what a server said in the answer that made a call fail: the status in its body, such as an `imsx_StatusInfo` of a REST
 * binding of 1EdTech, and how long it asks the client to wait.
 *
 * @remarks
 * A body that is not JSON, or that the reader refuses, such as the page of a proxy, gives no `info`: it is an answer without
 * detail and not a fault of the caller. A body of more than 1,000,000 tokens of JSON is no status and is not parsed.
 * `Retry-After` is read when it is a number of seconds; the form that gives a date needs a clock, so the header stays in
 * `error.headers["retry-after"]` for a caller that wants it.
 *
 * @param error - The error that a call to the service threw.
 * @param readInfo - Reads the parsed body as the status of the service, and throws when it is not one.
 * @returns The status and the delay, each left out when the answer does not give it.
 * @throws `DataError` when the error is not a `ServiceError`.
 */
export function readStatusDetail<TInfo>(error: ServiceError, readInfo: (json: unknown) => TInfo): StatusDetail<TInfo> {
  if (!(error instanceof ServiceError)) throw new DataError("The error must be a ServiceError.");
  const detail: { info?: TInfo; retryAfterSeconds?: number } = {};
  // A body of more tokens than a status can have is not one, and is not parsed.
  if (!hasMoreTokensThan(error.body, MAX_JSON_TOKENS)) {
    try {
      detail.info = readInfo(JSON.parse(error.body));
    } catch {
      // A body that is not JSON, or not a status, is an answer without detail and not a fault of the caller.
    }
  }
  const seconds = readRetryAfterSeconds(error.headers);
  if (seconds !== undefined) detail.retryAfterSeconds = seconds;
  return detail;
}
