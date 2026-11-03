import { DataError, raceAbort, requestService, type ServiceResponse } from "@interopkit/core";
import { checkAbortSignal, checkRecord } from "@interopkit/core/checks";
import type { Settings } from "./config.js";

/** An access token as RFC 6750 and the servers write it: printable characters other than a space, so that it cannot end the header. */
const TOKEN = /^[\x21-\x7e]+$/u;

/** The body of a request and its `Content-Type`. */
export interface Body {
  readonly text: string;
  readonly type: string;
}

/** One request of the client. */
export interface Call {
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  /** The `Accept` header. */
  readonly accept: string;
  /** The body, for a request that has one. */
  readonly body?: Body;
  /** The statuses that come back as values; any other is a `ServiceError`. */
  readonly expect: readonly number[];
}

/** Checks the options of one call and returns the signal that ends it. */
export function signalOf(options: unknown): AbortSignal | undefined {
  if (options === undefined) return undefined;
  checkRecord(options, "The options of a call must be an object");
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
  return options.signal;
}

/** Asks the host for the access token of a request, and checks that it can be a header. */
async function bearer(settings: Settings, signals: AbortSignal[]): Promise<string> {
  const either = signals.length === 0 ? undefined : AbortSignal.any(signals);
  // The host's function gets the signal and should stop, but the wait of the caller ends when it aborts whether the function does or not.
  const token = await raceAbort(
    Promise.resolve(settings.token(either === undefined ? undefined : { signal: either })),
    either,
  );
  if (typeof token !== "string" || !TOKEN.test(token)) {
    throw new DataError(
      "The option token must return an access token of printable characters without a space, such as the one the authorization server issued.",
    );
  }
  return `Bearer ${token}`;
}

/** Makes one request with the access token of the host, and returns the answers that the call expects. */
export async function send(settings: Settings, call: Call, signal: AbortSignal | undefined): Promise<ServiceResponse> {
  const waiting = [settings.signal, signal].filter((each) => each !== undefined);
  const authorization = await bearer(settings, waiting);
  const { fetch, timeoutMs, maxBytes } = settings;
  return requestService(
    { fetch, timeoutMs, signal: settings.signal },
    `The ${settings.api === "badges" ? "Open Badges" : "CLR"} API at ${call.url}`,
    call.url,
    {
      method: call.method,
      headers:
        call.body === undefined
          ? { accept: call.accept, authorization }
          : { accept: call.accept, authorization, "content-type": call.body.type },
      ...(call.body === undefined ? {} : { body: call.body.text }),
    },
    { maxBytes, expect: call.expect, ...(signal === undefined ? {} : { signal }) },
  );
}
