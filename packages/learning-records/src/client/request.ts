import { DataError, type HttpMethod, requestWithCredential, type ServiceResponse } from "@interopkit/core";
import { readStatementJson } from "../read/index.js";
import type { Settings } from "./config.js";

/** Characters that a header value must not hold: they would end the header and start another. */
const HEADER_BREAK = /[\r\n\0]/u;

/** The request of one call: its method, its headers and its body. */
export interface Request {
  readonly method: HttpMethod;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array<ArrayBuffer>;
}

/** Checks a value that goes into a header, such as a credential or an entity tag. */
export function isHeaderValue(value: string): boolean {
  return value !== "" && !HEADER_BREAK.test(value);
}

/** Writes the address of a resource of the LRS: the path below the endpoint, and the parameters of the query. */
export function urlOf(settings: Settings, path: string, parameters?: URLSearchParams): string {
  const query = parameters?.toString() ?? "";
  return `${settings.root}${path}${query === "" ? "" : `?${query}`}`;
}

/** Names the LRS in the messages about one of its answers. */
export function whatOf(url: string): string {
  return `The LRS at ${url}`;
}

/** The name of the standard in a sentence about an answer that does not follow it. */
export const STANDARD = "xAPI";

/**
 * Makes one request with the version header and the credential of the host, and returns the answers that `expect` lists.
 * Every other status is a `ServiceError` with its status, headers and body.
 */
export function send(
  settings: Settings,
  signal: AbortSignal | undefined,
  url: string,
  request: Request,
  expect: readonly number[],
): Promise<ServiceResponse> {
  const { fetch, timeoutMs, maxBytes, authorization } = settings;
  return requestWithCredential(
    { fetch, timeoutMs, signal: settings.signal, ...(authorization === undefined ? {} : { authorization }) },
    whatOf(url),
    url,
    {
      method: request.method,
      headers: { accept: "application/json", "x-experience-api-version": settings.version, ...request.headers },
      ...(request.body === undefined ? {} : { body: request.body }),
    },
    { maxBytes, expect, ...(signal === undefined ? {} : { signal }) },
  );
}

/** Reads the body of an answer as JSON, without a property given twice. */
export function jsonOf(response: ServiceResponse, settings: Settings): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(response.body);
  } catch (error) {
    throw new DataError("The body is not valid UTF-8 text, which JSON must be.", { cause: error });
  }
  return readStatementJson(text, { maxBytes: settings.maxBytes, maxTokens: settings.maxTokens });
}
