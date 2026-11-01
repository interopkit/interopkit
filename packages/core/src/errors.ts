/** The base class of every error that the interopkit packages throw. */
export class InteropkitError extends Error {
  /** Error class name. */
  override name = "InteropkitError";
}

/** The error for invalid input: an argument of the wrong type or out of range, or data that breaks the shape it must have. */
export class DataError extends InteropkitError {
  /** Error class name. */
  override name = "DataError";
}

/** What a `ServiceError` may carry besides its status and body. */
export interface ServiceErrorOptions {
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
   * @param options - The headers of the response.
   */
  constructor(message: string, status: number, body: string, options: ServiceErrorOptions = {}) {
    super(message);
    this.status = status;
    this.body = body;
    this.headers = options.headers ?? {};
  }
}
