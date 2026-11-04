import { type CallOptions, DataError, requestWithCredential, type ServiceResponse } from "@interopkit/core";
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

/** Asks the host for the access token of a request, and writes the value of its `Authorization` header. */
async function bearer(settings: Settings, options?: CallOptions): Promise<string> {
  const token = await settings.token(options);
  if (typeof token !== "string" || !TOKEN.test(token)) {
    throw new DataError(
      "The option token must return an access token of printable characters without a space, such as the one the authorization server issued.",
    );
  }
  return `Bearer ${token}`;
}

/** Makes one request with the access token of the host, and returns the answers that the call expects. */
export function send(settings: Settings, call: Call, signal: AbortSignal | undefined): Promise<ServiceResponse> {
  const { fetch, timeoutMs, maxBytes } = settings;
  return requestWithCredential(
    { fetch, timeoutMs, signal: settings.signal, authorization: (options) => bearer(settings, options) },
    `The ${settings.api === "badges" ? "Open Badges" : "CLR"} API at ${call.url}`,
    call.url,
    {
      method: call.method,
      headers:
        call.body === undefined ? { accept: call.accept } : { accept: call.accept, "content-type": call.body.type },
      ...(call.body === undefined ? {} : { body: call.body.text }),
    },
    { maxBytes, expect: call.expect, ...(signal === undefined ? {} : { signal }) },
  );
}
