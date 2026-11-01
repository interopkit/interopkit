/** The milliseconds in a second: JavaScript times are in milliseconds, and the claims of a token are in seconds. */
export const MILLISECONDS = 1000;

/** The whole seconds of a time in milliseconds, the unit of `iat`, `exp` and `nbf`. */
export function toSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / MILLISECONDS);
}
