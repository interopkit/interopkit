import * as v from "valibot";
import { readRetryAfterSeconds } from "./answer-headers.js";
import { checkPositiveInteger, checkRecord, parseJsonText, parseWith, type Schema, strictRecord } from "./checks.js";
import { DataError, LimitError, ServiceError } from "./errors.js";
import { hasMoreTokensThan, MAX_JSON_DEPTH, MAX_JSON_TOKENS } from "./json.js";
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
  return parseJsonText(
    text,
    { maxDepth, maxTokens },
    {
      depth: `${what} answered with JSON that nests more than ${maxDepth} levels.`,
      tokens: `${what} answered with a body of more than ${maxTokens} tokens of JSON, above the limit of the option maxTokens.`,
      syntax: () => `${what} answered with a body that is not JSON.`,
    },
  );
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

/** The outcomes of a request as a whole that the services of 1EdTech name in an `imsx_StatusInfo`. */
export const STATUS_CODES_MAJOR = ["failure", "processing", "success", "unsupported"] as const;

/** How serious an outcome is, in the words of the services of 1EdTech. */
export const STATUS_SEVERITIES = ["error", "status", "warning"] as const;

/**
 * One detail of a status: the system that gave it, and its code.
 *
 * @typeParam TMinor - The codes of the service, such as the union of its `STATUS_CODES_MINOR`.
 */
export interface StatusCodeMinorField<TMinor extends string = string> {
  /** The identity of the system that produced the code, such as `TargetEndSystem`. */
  readonly imsx_codeMinorFieldName: string;
  /** The code, from the vocabulary of the service, such as `server_busy`. */
  readonly imsx_codeMinorFieldValue: TMinor;
}

/**
 * The details of a status: at least one.
 *
 * @typeParam TMinor - The codes of the service.
 */
export interface StatusCodeMinor<TMinor extends string = string> {
  /** The details, each with the system that gave it and its code. */
  readonly imsx_codeMinorField: readonly StatusCodeMinorField<TMinor>[];
}

/**
 * The status that a service of 1EdTech returns with an answer that is not a success: the `imsx_StatusInfo` of its REST binding.
 *
 * @remarks
 * CASE, Open Badges and CLR share it. The codes of the details are those of each service, so they are text unless a package
 * of a service types them as its vocabulary with `TMinor`.
 *
 * @typeParam TMinor - The codes of the service, such as the union of its `STATUS_CODES_MINOR`.
 */
export interface StatusInfo<TMinor extends string = string> {
  /** The outcome of the request as a whole. */
  readonly imsx_codeMajor: (typeof STATUS_CODES_MAJOR)[number];
  /** How serious the outcome is. */
  readonly imsx_severity: (typeof STATUS_SEVERITIES)[number];
  /** A description of the outcome, for people. */
  readonly imsx_description?: string;
  /** The details of the outcome, at least one. */
  readonly imsx_codeMinor?: StatusCodeMinor<TMinor>;
}

/** What a service of 1EdTech said when it refused a request: its `imsx_StatusInfo`, and how long it asks a client to wait. */
export interface StatusDetail {
  /**
   * The `imsx_StatusInfo` in the body of the answer.
   *
   * @defaultValue none: the body is not JSON, or not a status
   */
  readonly info?: StatusInfo;
  /**
   * The seconds that `Retry-After` asks the client to wait.
   *
   * @defaultValue none: the header is absent, or gives a date
   */
  readonly retryAfterSeconds?: number;
}

const statusInfoSchema: Schema<StatusInfo> = strictRecord({
  imsx_codeMajor: v.picklist(STATUS_CODES_MAJOR),
  imsx_severity: v.picklist(STATUS_SEVERITIES),
  imsx_description: v.optional(v.string()),
  imsx_codeMinor: v.optional(
    strictRecord({
      imsx_codeMinorField: v.pipe(
        v.array(strictRecord({ imsx_codeMinorFieldName: v.string(), imsx_codeMinorFieldValue: v.string() })),
        v.minLength(1),
      ),
    }),
  ),
});

/**
 * Reads what a service of 1EdTech said in the answer that made a call fail: its `imsx_StatusInfo`, if the body is one, and how
 * long it asks the client to wait.
 *
 * @remarks
 * The REST bindings of CASE, Open Badges and CLR answer an error with an `imsx_StatusInfo` that names the cause in
 * `imsx_codeMinor`, such as `invalid_filter_field` or `server_busy`. A body that is not JSON, or not a status, such as the page of
 * a proxy, gives no `info`: it is an answer without detail and not a fault of the caller. A body of more than 1,000,000 tokens of
 * JSON is no status and is not parsed. `Retry-After` is read when it is a number of seconds; the form that gives a date needs a
 * clock, so the header stays in `error.headers["retry-after"]` for a caller that wants it. The client retries nothing itself:
 * without a `Retry-After`, Open Badges recommends two more attempts 30 minutes apart, and then telling the user.
 *
 * @param error - The error that a call of the client threw.
 * @returns The status and the delay, each left out when the answer does not give it.
 * @throws `DataError` when the argument is not a `ServiceError`.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#retry-behavior | Open Badges 3.0, Retry Behavior}
 * @see {@link https://www.imsglobal.org/spec/case/v1p1 | CASE Service 1.1, REST binding 2.4}
 */
export function readStatusInfo(error: ServiceError): StatusDetail {
  if (!(error instanceof ServiceError)) throw new DataError("The error must be a ServiceError.");
  const detail: { info?: StatusInfo; retryAfterSeconds?: number } = {};
  // A body of more tokens than a status can have is not one, and is not parsed.
  if (!hasMoreTokensThan(error.body, MAX_JSON_TOKENS)) {
    try {
      detail.info = parseWith(statusInfoSchema, JSON.parse(error.body), "The status");
    } catch {
      // A body that is not JSON, or not a status, is an answer without detail and not a fault of the caller.
    }
  }
  const seconds = readRetryAfterSeconds(error.headers);
  if (seconds !== undefined) detail.retryAfterSeconds = seconds;
  return detail;
}
