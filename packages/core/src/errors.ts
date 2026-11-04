/**
 * The base class of every error that the interopkit packages throw. Like every error class of the packages, it takes
 * `ErrorOptions` after its message, and an error that reports another carries it as its `cause`.
 */
export class InteropkitError extends Error {
  /** Error class name. */
  override name = "InteropkitError";
}

/** The error for invalid input: an argument of the wrong type or out of range, or data that breaks the shape it must have. */
export class DataError extends InteropkitError {
  /** Error class name. */
  override name = "DataError";
}

/**
 * The error for untrusted input over a limit of a reader or a handler: a text, a body, a message or a package with more bytes,
 * tokens, levels, parts or entries than the limit allows. A host answers 413 from it, whichever reader threw it.
 */
export class LimitError extends DataError {
  /** Error class name. */
  override name = "LimitError";
  /** The name of the limit that the input went over: the option that sets it, such as `maxBytes`, or a fixed limit that the guide names. */
  readonly limit: string;
  /** The value of the limit, in the unit of its name: bytes, tokens, levels, parts, entries or characters. */
  readonly maximum: number;

  /**
   * @param message - Says which input went over which limit.
   * @param limit - The name of the limit.
   * @param maximum - The value of the limit.
   * @param options - The `cause`: the error that this one reports.
   */
  constructor(message: string, limit: string, maximum: number, options?: ErrorOptions) {
    super(message, options);
    this.limit = limit;
    this.maximum = maximum;
  }
}

/** What a `ServiceError` may carry besides its status and body: the headers of the answer, and the `cause` of a wrapped error. */
export interface ServiceErrorOptions extends ErrorOptions {
  /**
   * The headers of the response by name in lower case, such as `retry-after`.
   *
   * @defaultValue none: the call got no answer
   */
  readonly headers?: Readonly<Record<string, string>>;
}

/** The error for a call to a service that fails: an HTTP service that did not answer, or answered with an error. */
export class ServiceError extends InteropkitError {
  /** Error class name. */
  override name = "ServiceError";
  /** The HTTP status of the failed call, and `0` when the call got no answer. */
  readonly status: number;
  /** The body of the response, up to the most bytes a call reads, or the empty string when the call had none. */
  readonly body: string;
  /** The headers of the response by name in lower case, and none when the call got no answer. */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * @param message - Says which call failed.
   * @param status - The HTTP status of the failed call.
   * @param body - The body of the response.
   * @param options - The headers of the response, and the `cause`: the error that this one reports.
   */
  constructor(message: string, status: number, body: string, options: ServiceErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.status = status;
    this.body = body;
    this.headers = options.headers ?? {};
  }
}
