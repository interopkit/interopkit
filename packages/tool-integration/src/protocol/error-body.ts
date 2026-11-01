/** Builds the body of an error answer of OAuth 2.0 (RFC 6749 section 5.2) and of the services: an `error` code and a description. */
export function errorBody(error: string, description: string): Record<string, string> {
  return Object.fromEntries([
    ["error", error],
    ["error_description", description],
  ]);
}
