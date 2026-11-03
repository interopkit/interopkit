import { checkRecord, checkString } from "@interopkit/core/checks";
import type { HttpRequest } from "@interopkit/core/http";

const SCHEME = /^basic\s+(\S+)$/iu;

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The user and the password of HTTP Basic authentication. */
export interface BasicCredentials {
  /** The user, up to the first colon. */
  readonly user: string;
  /** The password, which may hold colons. */
  readonly password: string;
}

/**
 * Reads the user and the password of HTTP Basic authentication from the `Authorization` header, for a host whose `access`
 * uses it (xAPI 1.0.3 Communication 4.0).
 *
 * @remarks
 * The password may hold colons: the user ends at the first one. The user and the password are UTF-8 (RFC 7617 section 2.1).
 * Nothing is checked against a credential store, and nothing of the header is kept.
 *
 * @param request - The request.
 * @returns The user and the password, or `undefined` when the request has no Basic header or the header is malformed: the
 * scheme is another, the value is not base64, it is not UTF-8 or it has no colon.
 * @throws `DataError` when the request is not an object whose `headers` are an object, or its `authorization` is not a string.
 * @see {@link https://www.rfc-editor.org/rfc/rfc7617 | RFC 7617, the Basic scheme}
 */
export function readBasicAuthorization(request: Pick<HttpRequest, "headers">): BasicCredentials | undefined {
  checkRecord(request, "The request must be an object");
  checkRecord(request.headers, "The headers of the request must be an object");
  const { authorization = "" } = request.headers;
  checkString(authorization, "The header authorization");
  const credentials = SCHEME.exec(authorization)?.[1];
  if (credentials === undefined) return undefined;
  let text: string;
  try {
    const binary = atob(credentials);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    text = decoder.decode(bytes);
  } catch {
    return undefined;
  }
  const colon = text.indexOf(":");
  return colon < 0 ? undefined : { user: text.slice(0, colon), password: text.slice(colon + 1) };
}
