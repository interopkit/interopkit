/** The text of a body that a handler built or a `fetch` received. */
export function textOf(body: string | Uint8Array | undefined): string {
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}
