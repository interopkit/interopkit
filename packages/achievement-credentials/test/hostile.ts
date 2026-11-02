import { expect, vi } from "vitest";

/** The JSON of an array with 1.2 million tokens, more than the default limit: each `[],` is three, and it is 1.2 MB of text. */
export const HOSTILE = `[${"[],".repeat(400_000)}[]]`;

/** The most characters that a call of a test may hand to `JSON.parse`: a refused text is far longer than this. */
const PARSED_AT_MOST = 100_000;

/**
 * Runs a call and shows that `JSON.parse` was never given a text that long: the call counted the tokens of the hostile text
 * and refused it first, and `JSON.parse` takes about forty times the text of small objects in memory.
 *
 * @returns What the call returns.
 */
export async function neverParsesLarge<TResult>(run: () => Promise<TResult> | TResult): Promise<TResult> {
  const parse = vi.spyOn(JSON, "parse");
  try {
    const result = await run();
    const longest = Math.max(0, ...parse.mock.calls.map(([text]) => String(text).length));
    expect(longest).toBeLessThan(PARSED_AT_MOST);
    return result;
  } finally {
    parse.mockRestore();
  }
}
